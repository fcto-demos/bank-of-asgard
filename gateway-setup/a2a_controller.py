"""The `a2a` part of gateway-setup: the Savings Goals Agent's A2A agent proxy, created
directly on a standalone gateway through its controller REST API (the management API,
<A2A_CONTROLLER_URL>/api/management/v1, HTTP Basic auth). AI Workspace isn't involved —
it can't manage A2A gateways yet. Import, don't execute — see provision.py and teardown.py.

The proxy is a gateway `Agent` resource. Its card is served in passthrough mode: the
gateway fetches the agent's own card on each request and rewrites its URLs to the
gateway's, so a caller that reads the card sends its messages through the proxy too.
"""
from __future__ import annotations

import base64
import re
import sys
import time
from typing import Any

import platform_api as pa
from platform_api import MANAGED_MARKER, secret, setting

PREFIX = setting("RESOURCE_PREFIX", "boa")
UPSTREAM_HOST = setting("UPSTREAM_HOST", "host.docker.internal")

# The controller's REST API (the A2A gateway's container port 9090, or whichever host port
# it is published on), and the HTTPS ingress the agents send A2A traffic to.
CONTROLLER_URL = setting("A2A_CONTROLLER_URL").rstrip("/")
CONTROLLER_USERNAME = setting("A2A_CONTROLLER_USERNAME", "admin")
CONTROLLER_PASSWORD = secret("A2A_CONTROLLER_PASSWORD")  # environment only, never a file
GATEWAY_URL = setting("A2A_GATEWAY_URL").rstrip("/")

UPSTREAM = setting("SAVINGS_A2A_UPSTREAM", f"http://{UPSTREAM_HOST}:8013")
AUTH = setting("A2A_AUTH", "passthrough").lower()
# The Coordinator waits 90 s for the Savings Agent (its v2 demo mode runs several LLM
# rounds per request); the proxy must not give up first.
TIMEOUT = setting("A2A_TIMEOUT", "90s")

AGENT = {"name": f"{PREFIX}-savings-agent", "context": f"/{PREFIX}-savings",
         "displayName": "Bank of Asgard - Savings Goals Agent", "version": "v1.0"}
# The gateway strips only the context and forwards the rest of the path, so each binding's
# pathPrefix must be the path savings-goals-agent serves it on (a2a_server.py: JSON-RPC at
# /, HTTP+JSON under /v1).
TRANSPORTS = [{"protocolBinding": "JSONRPC", "pathPrefix": "/"},
              {"protocolBinding": "HTTP+JSON", "pathPrefix": "/v1"}]
# An Agent has no description field, so the marker that tells teardown.py the resource is
# ours goes into an annotation instead.
MANAGED_ANNOTATION = "bank-of-asgard.gateway-setup/managed-by"


def enabled() -> bool:
    """The a2a part runs by default only when the controller is configured."""
    return bool(CONTROLLER_URL)


def settings_errors() -> list[str]:
    errors = []
    if not CONTROLLER_URL:
        errors.append("A2A_CONTROLLER_URL is not set — the A2A gateway's controller REST API, "
                      "e.g. http://localhost:9090 — or leave 'a2a' out of --only")
    if not CONTROLLER_PASSWORD:
        errors.append("A2A_CONTROLLER_PASSWORD is not set — the controller admin password the A2A "
                      "gateway's scripts/setup.sh printed; export it in your shell (never stored in a file)")
    if not GATEWAY_URL:
        errors.append("A2A_GATEWAY_URL is not set — the A2A gateway's HTTPS ingress as the agents "
                      "reach it, e.g. https://gateway.example.com:8443")
    if AUTH not in ("passthrough", "jwt-auth"):
        errors.append(f"A2A_AUTH={AUTH!r} — use 'passthrough' or 'jwt-auth'")
    if not re.fullmatch(r"\d+(\.\d+)?(ms|s|m|h)", TIMEOUT):
        errors.append(f"A2A_TIMEOUT={TIMEOUT!r} — a duration such as 90s or 2m")
    return errors


# =============================================================================
# Controller REST API
# =============================================================================
def controller(method: str, path: str, data: Any = None) -> tuple[int, Any]:
    credentials = base64.b64encode(f"{CONTROLLER_USERNAME}:{CONTROLLER_PASSWORD}".encode()).decode()
    return pa.request(method, f"{CONTROLLER_URL}/api/management/v1{path}", data,
                      {"Authorization": f"Basic {credentials}", "Accept": "application/json"})


def _agents() -> tuple[int, Any, list[dict]]:
    status, resp = controller("GET", "/agents")
    agents = resp.get("agents") if isinstance(resp, dict) else None
    return status, resp, [a for a in agents or [] if isinstance(a, dict)]


def _ours(agents: list[dict]) -> dict | None:
    return next((a for a in agents if (a.get("metadata") or {}).get("name") == AGENT["name"]), None)


def _agent_id(agent: dict) -> str:
    """The id the /agents/{id} routes take: the server's public id, else the handle."""
    return (agent.get("status") or {}).get("id") or agent["metadata"]["name"]


def _managed(agent: dict) -> bool:
    """Created by gateway-setup? Our annotation says so. A controller that doesn't echo
    annotations back at all can't tell us, so an agent carrying our handle *and* display
    name counts as ours then — otherwise a re-run would refuse to update its own agent."""
    metadata = agent.get("metadata") or {}
    annotations = metadata.get("annotations")
    if annotations:
        return annotations.get(MANAGED_ANNOTATION) == MANAGED_MARKER
    return (agent.get("spec") or {}).get("displayName") == AGENT["displayName"]


def _controller_blocker(status: int, resp: Any) -> str | None:
    if status == 0:
        return (f"cannot reach the A2A gateway's controller at {CONTROLLER_URL} — is it running "
                f"(docker compose up -d in its folder)?")
    if status in (401, 403):
        return ("the A2A gateway's controller rejected A2A_CONTROLLER_USERNAME / A2A_CONTROLLER_PASSWORD "
                "(the admin credentials its scripts/setup.sh printed)")
    if status != 200:
        return f"could not list the A2A gateway's agents: {status} {resp}"
    return None


def payload(jwt_policy: dict | None) -> dict:
    return {
        "apiVersion": "gateway.api-platform.wso2.com/v1",
        "kind": "Agent",
        "metadata": {"name": AGENT["name"], "annotations": {MANAGED_ANNOTATION: MANAGED_MARKER}},
        "spec": {
            "displayName": AGENT["displayName"],
            "version": AGENT["version"],
            "context": AGENT["context"],
            "upstream": {"url": UPSTREAM},
            "resilience": {"timeout": TIMEOUT},
            "deploymentState": "deployed",
            "a2a": {
                "protocolVersion": "1.0",
                "operationConfigs": {
                    "transports": TRANSPORTS,
                    "policies": [jwt_policy] if AUTH == "jwt-auth" and jwt_policy else [],
                },
            },
        },
    }


# =============================================================================
# --check, install, verify, teardown
# =============================================================================
def check(force: bool) -> int:
    """Pre-flight: controller reachable with these credentials, and the agent's handle and
    context free (or already ours). Returns the number of blockers."""
    print(f"  a2a        controller {CONTROLLER_URL}, traffic {GATEWAY_URL}, upstream {UPSTREAM} "
          f"(auth: {AUTH}, timeout {TIMEOUT})")
    status, resp, agents = _agents()
    blocker = _controller_blocker(status, resp)
    if blocker:
        print(f"  BLOCKER    {blocker}")
        return 1
    problems = 0
    mine = _ours(agents)
    if mine is None:
        print(f"  create     agent          {AGENT['name']:<30} {AGENT['context']}")
    elif _managed(mine):
        print(f"  update     agent          {AGENT['name']:<30} {AGENT['context']}")
    else:
        label = "OVERWRITE" if force else "BLOCKER"
        print(f"  {label:<10} agent          {AGENT['name']:<30} exists, not created by gateway-setup"
              f"{'' if force else ' — change RESOURCE_PREFIX, or pass --force'}")
        problems += 0 if force else 1
    for other in agents:
        if other is not mine and (other.get("spec") or {}).get("context") == AGENT["context"]:
            print(f"  BLOCKER    context {AGENT['context']} already belongs to agent "
                  f"{(other.get('metadata') or {}).get('name')!r} — change RESOURCE_PREFIX")
            problems += 1
    if GATEWAY_URL and pa.request("GET", GATEWAY_URL)[0] == 0:
        print(f"  WARNING    no answer from A2A_GATEWAY_URL={GATEWAY_URL} from this machine")
    return problems


def card_probe() -> tuple[str, int, Any]:
    """The Agent Card through the gateway. In passthrough mode it is fetched from the agent
    on every request, so a 200 proves the gateway reached the Savings Goals Agent."""
    return pa.probe("GET", f"{GATEWAY_URL}{AGENT['context']}/.well-known/agent-card.json")


def install(state: dict, jwt_policy: dict | None) -> None:
    print(f"### A2A agent proxy {AGENT['name']} ({AGENT['context']}) on {CONTROLLER_URL} -> {UPSTREAM}")
    status, resp, agents = _agents()
    blocker = _controller_blocker(status, resp)
    if blocker:
        sys.exit(f"  {blocker}")
    mine = _ours(agents)
    body = payload(jwt_policy)
    if mine:
        status, resp = controller("PUT", f"/agents/{_agent_id(mine)}", body)
        verb = "updated"
    else:
        status, resp = controller("POST", "/agents", body)
        verb = "created"
    if status not in (200, 201):
        sys.exit(f"  agent proxy {verb[:-1]} failed: {status} {resp}")
    print(f"  agent proxy {verb}")
    # The controller acknowledges before the router has the routes: wait for them.
    verdict, status = "no-route", 0
    for _ in range(30):
        verdict, status, _ = card_probe()
        if verdict not in ("no-route", "transient"):
            break
        time.sleep(2)
    print(f"  route {GATEWAY_URL}{AGENT['context']}: {verdict} ({status})")
    state["a2a"] = {"url": f"{GATEWAY_URL}{AGENT['context']}"}


def remove(force: bool, dry_run: bool) -> bool:
    """teardown.py: delete the agent proxy if gateway-setup created it."""
    if not enabled():
        print("  skipped    agent proxy — A2A_CONTROLLER_URL is not set")
        return True
    status, resp, agents = _agents()
    blocker = _controller_blocker(status, resp)
    if blocker:
        print(f"  WARNING    {blocker}")
        return False
    mine = _ours(agents)
    if mine is None:
        print(f"  absent     agent          {AGENT['name']}")
        return True
    if not _managed(mine) and not force:
        print(f"  kept       agent          {AGENT['name']} — not created by gateway-setup (--force to remove anyway)")
        return True
    if dry_run:
        print(f"  would delete agent {AGENT['name']}")
        return True
    status, resp = controller("DELETE", f"/agents/{_agent_id(mine)}")
    if status in (200, 202, 204):
        print(f"  deleted    agent          {AGENT['name']}")
        return True
    print(f"  WARNING    could not delete agent {AGENT['name']}: {status} {resp}")
    return False
