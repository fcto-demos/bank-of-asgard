"""Control-plane client for gateway-setup/: settings, the AI Workspace Platform API
(login, list, upsert, deploy) and direct probes against the gateways themselves.
Import, don't execute — see provision.py and teardown.py.

Ported from aigw-guardrails-demo/scripts/python/platform_api.py (same BFF login and
proxy path, same deploy/probe logic), minus everything specific to that demo's own
compose stacks. Standard library only, so nothing needs installing to run it.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
ENV_FILE = HERE / "gateway.env"
ENV_EXAMPLE = HERE / "gateway.env.example"
OUT_DIR = HERE / "out"

# Every resource the installer creates carries this in its description, so teardown.py
# can tell its own resources from anything else living in the same project.
MANAGED_MARKER = "[managed-by: bank-of-asgard gateway-setup]"


def read_env_file(path: Path) -> dict[str, str]:
    """Flat KEY=VALUE file. Parsed by hand (no shell `source`), so `$` in values is
    taken literally — a secret containing `$` survives intact. An unquoted value ends at
    ` #` (an inline comment); quote a value that itself contains ` #`."""
    conf = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value[:1] in ("\"", "'") and value.count(value[0]) >= 2:
            value = value[1:value.index(value[0], 1)]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        conf[key.strip()] = value
    return conf


def _load_settings() -> dict[str, str]:
    if not ENV_FILE.exists():
        ENV_FILE.write_text(ENV_EXAMPLE.read_text())
        print(f"created {ENV_FILE.relative_to(ROOT)} from {ENV_EXAMPLE.name} — fill it in "
              f"(./gateway-setup/provision.py --list-targets helps find the ids)")
    return read_env_file(ENV_FILE)


_SETTINGS = _load_settings()


def setting(name: str, default: str = "") -> str:
    """A setting from the environment, else gateway.env, else `default`."""
    return os.environ.get(name) or _SETTINGS.get(name) or default


def setting_list(name: str) -> list[str]:
    return [item.strip() for item in setting(name).split(",") if item.strip()]


def setting_bool(name: str, default: bool) -> bool:
    value = setting(name)
    return default if not value else value.lower() in ("1", "true", "yes", "on")


AIW = setting("AIW_URL", "https://localhost:9643").rstrip("/")
ADMIN_USERNAME = setting("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = setting("ADMIN_PASSWORD")


# =============================================================================
# HTTP
# =============================================================================
# Local AI Workspace / gateway installs usually serve self-signed certificates: point
# TLS_CA_FILE at their CA (or the certificates themselves, comma-separated) to trust them
# on top of the system CAs. TLS_VERIFY=false turns verification off altogether — a last
# resort for throwaway local setups only, since the admin password travels over this
# connection.
_ctx = ssl.create_default_context()
for _ca_file in setting_list("TLS_CA_FILE"):
    _ca_path = Path(_ca_file).expanduser()
    _ctx.load_verify_locations(cafile=_ca_path if _ca_path.is_absolute() else ROOT / _ca_path)  # relative = repo root
if not setting_bool("TLS_VERIFY", True):
    print("WARNING: TLS_VERIFY=false — certificates are not verified (local setups only)")
    _ctx.check_hostname = False
    _ctx.verify_mode = ssl.CERT_NONE
_opener = urllib.request.build_opener(
    urllib.request.HTTPSHandler(context=_ctx),
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
)


def request(method: str, url: str, data: Any = None, headers: dict[str, str] | None = None,
            timeout: float = 30) -> tuple[int, Any]:
    """One HTTP call. Returns (status, parsed JSON body or {"raw": text}). Status 0 means
    no HTTP answer at all (connection refused, TLS failure, timeout)."""
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)  # noqa: S310 — URLs come from our own settings
    req.add_header("X-Requested-By", "ai-workspace")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with _opener.open(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, _parse(raw)
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read())
    except (urllib.error.URLError, ConnectionError, TimeoutError, ssl.SSLError, ValueError) as e:
        # ValueError: a malformed URL, e.g. a gateway with no endpoint recorded.
        return 0, {"status": "error", "code": "TRANSIENT_NETWORK_ERROR", "message": str(e)}


def _parse(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw.decode(errors="replace")}


def api(method: str, path: str, data: Any = None) -> tuple[int, Any]:
    """Platform API call through the AI Workspace BFF (requires login() first)."""
    return request(method, f"{AIW}/ai-workspace/proxy/api/v0.9{path}", data)


def login(attempts: int = 3) -> None:
    if not ADMIN_PASSWORD:
        sys.exit("ADMIN_PASSWORD is not set — export it, or set it in gateway-setup/gateway.env")
    for attempt in range(1, attempts + 1):
        status, resp = request("POST", f"{AIW}/ai-workspace/api/login",
                               {"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
        if status == 200:
            return
        if status == 0 and attempt < attempts:
            time.sleep(2)
            continue
        hint = (" — TLS failed; set TLS_CA_FILE to the AI Workspace's CA certificate"
                if status == 0 and "CERTIFICATE" in str(resp).upper() else "")
        sys.exit(f"login to {AIW} as {ADMIN_USERNAME!r} failed: {status} {resp}{hint}")


def items(resp: Any) -> list:
    """The records of a list response, whatever its wrapper is called."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        return resp.get("list") or resp.get("items") or []
    return []


def exists(resource: str, rid: str) -> bool:
    return api("GET", f"/{resource}/{rid}")[0] == 200


def upsert(resource: str, payload: dict, label: str) -> str:
    """PUT over an existing id, POST a new one. Returns "created" or "updated"."""
    status, _ = api("GET", f"/{resource}/{payload['id']}")
    if status == 200:
        status, resp = api("PUT", f"/{resource}/{payload['id']}", payload)
        verb = "updated"
    else:
        status, resp = api("POST", f"/{resource}", payload)
        verb = "created"
    if status not in (200, 201):
        sys.exit(f"  {label} {verb} failed: {status} {resp}")
    print(f"  {label} {verb}")
    return verb


# =============================================================================
# Gateways
# =============================================================================
def get_gateway(gateway_id: str) -> dict | None:
    status, resp = api("GET", f"/gateways/{gateway_id}")
    return resp if status == 200 and isinstance(resp, dict) else None


def base_url(endpoint: str) -> str:
    """scheme://host[:port] from a gateway endpoint as the control plane records it
    ("localhost:8443", "https://gw.example.com:8443/api/v1", ...)."""
    if "://" not in endpoint:
        endpoint = f"https://{endpoint}"
    parsed = urlparse(endpoint)
    return f"{parsed.scheme}://{parsed.netloc}"


def gateway_base_url(gateway: dict) -> str:
    endpoints = [e for e in gateway.get("endpoints") or [] if not str(e).startswith("ws")]
    return base_url(endpoints[0]) if endpoints else ""


def gateway_policies(gateway_id: str) -> dict[str, str] | None:
    """name -> version of every policy in the gateway's image (its manifest), or None
    when the control plane does not expose the manifest."""
    status, resp = api("GET", f"/gateways/{gateway_id}/manifest")
    if status != 200 or not isinstance(resp, dict):
        return None
    return {p.get("name"): p.get("version", "") for p in resp.get("policies") or [] if p.get("name")}


# =============================================================================
# Probes — straight at a gateway, not the control plane
# =============================================================================
def gateway_verdict(status: int, body: Any) -> str:
    """Who produced a probe's answer:
      "transient"            no HTTP answer at all (status 0)
      "no-route"             the gateway has no route for this context: not deployed
      "key-rejected"         the gateway's api-key-auth refused the key (or none was sent)
      "upstream-unreachable" the route exists but the gateway cannot reach the backend
      "live"                 the gateway matched the route and let the request through
    The two gateway bodies are its own fixed replies (confirmed in aigw-guardrails-demo):
    {"error":"Not Found"} and {"error":"Unauthorized","message":"Valid API key required"}.
    A backend's own 401/404 has a different body, so it still reads as "live"."""
    if status == 0:
        return "transient"
    error = body.get("error") if isinstance(body, dict) else None
    if status == 404 and error == "Not Found":
        return "no-route"
    # Right after a deployment, Envoy can have the route before the policy engine has
    # its chain: a bare {"error":"Internal Server Error"} ("Policy chain not found for
    # route" in the runtime log). Not ready yet. A policy failure carries an error_id.
    if status == 500 and error == "Internal Server Error" and "error_id" not in body:
        return "no-route"
    if status == 401 and error == "Unauthorized" and isinstance(body, dict) and "API key" in str(body.get("message")):
        return "key-rejected"
    if status in (502, 503, 504):
        return "upstream-unreachable"
    return "live"


def probe(method: str, url: str, data: Any = None, headers: dict[str, str] | None = None) -> tuple[str, int, Any]:
    status, body = request(method, url, data, headers, timeout=20)
    return gateway_verdict(status, body), status, body


def deploy(resource: str, resource_id: str, gateway_id: str,
           route_is_live: Callable[[], bool], attempts: int = 3) -> None:
    """Deploys one resource to one gateway and waits for it. Deployment is asynchronous
    (DEPLOYING -> DEPLOYED/FAILED), so this polls for a terminal status; a status record
    stuck on DEPLOYING while the route already answers counts as deployed (seen after a
    gateway-controller reconnect in aigw-guardrails-demo)."""
    resp: Any = None
    for attempt in range(1, attempts + 1):
        status, resp = api("POST", f"/{resource}/{resource_id}/deployments",
                           {"name": f"{gateway_id}", "base": "current", "gatewayId": gateway_id})
        if status not in (200, 201):
            sys.exit(f"  deploy to {gateway_id} failed: {status} {resp}")
        dep_id = resp.get("deploymentId") or resp.get("id")
        for _ in range(30):
            time.sleep(2)
            _, resp = api("GET", f"/{resource}/{resource_id}/deployments/{dep_id}")
            if not isinstance(resp, dict) or resp.get("status") in ("DEPLOYED", "FAILED"):
                break
            if route_is_live():
                print(f"  {gateway_id}: route answers (status record still DEPLOYING) — proceeding")
                return
        state = resp.get("status") if isinstance(resp, dict) else resp
        if state == "DEPLOYED":
            print(f"  {gateway_id}: deployed")
            return
        if route_is_live():
            print(f"  {gateway_id}: route answers (status record {state}) — proceeding")
            return
        if attempt < attempts:
            reason = resp.get("statusReason") if isinstance(resp, dict) else ""
            print(f"  {gateway_id}: deployment {state} ({reason}) — retrying ({attempt}/{attempts})")
    sys.exit(f"  {resource_id} never reached DEPLOYED on {gateway_id} and its route isn't live: {resp}")
