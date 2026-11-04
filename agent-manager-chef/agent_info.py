#!/usr/bin/env python3
"""An agent's real sheet in Agent Manager, for the "Inside our agents" slide.

Read with `amctl` (read-only, in parallel: identity, deployment, resources, model
and monitor) and returned as [key, value] rows, as each column's CLI paints them,
plus the host and LLM provider shown in the slide header. Queried on every
request: nothing is cached.

    python3 agent_info.py savingsagent          # prints the sheet as JSON
    python3 agent_info.py savingsagent future   # with its future-traces monitor
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

AMCTL = os.environ.get("AMCTL", "amctl")
PROJECT = os.environ.get("AM_PROJECT", "default")
ENVIRONMENT = os.environ.get("AM_ENVIRONMENT", "default")

# The slide's agents. Only these can be queried.
AGENTS = ("transactionagent", "savingsagent", "tax-agent")

# Of an agent's environment variables, only these are ever shown: the rest may
# hold credentials (and not all of those are marked sensitive).
GATEWAY_ENV = "GATEWAY_BASE_URL"


def _once(args: list[str]):
    out = subprocess.run([AMCTL, *args], capture_output=True, text=True, timeout=60)
    text = out.stdout.strip()
    try:
        data = json.loads(text) if text else None
    except ValueError:
        data = None
    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        raise RuntimeError(str(err.get("message") or err.get("code") or err)[:300] if isinstance(err, dict) else str(err)[:300])
    if out.returncode != 0 or data is None:
        raise RuntimeError((out.stderr or text or "no output from amctl").strip()[:300])
    return data.get("data", data) if isinstance(data, dict) else data


def _run(args: list[str]):
    """One amctl call; the Agent Manager API sometimes times out, so it is retried twice."""
    for attempt in range(3):
        try:
            return _once(args)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(0.5)


# amctl refreshes the access token when it expires. If several calls do it at once,
# some lose the race: before the parallel queries, a single call (one at a time)
# leaves the token refreshed.
_warm_lock = threading.Lock()
_warm_at = 0.0


def _warm() -> None:
    global _warm_at
    with _warm_lock:
        if time.monotonic() - _warm_at < 30:
            return
        _run(["api", f"/orgs/default/projects/{PROJECT}"])
        _warm_at = time.monotonic()


def check_session() -> dict:
    try:
        _warm()
        return {"status": "live"}
    except Exception as exc:
        return {"status": "error", "error": str(exc)[:300]}


def _when(ts: str) -> str:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")


def _monitor(r: dict, kind: str):
    """The agent's first monitor of that kind: "past" (a fixed window of past traces)
    or "future" (evaluates new traces as they arrive)."""
    return next((m for m in (r["monitors"] or {}).get("monitors") or [] if m.get("type") == kind), None)


def fetch(agent: str, kind: str) -> dict:
    """{query: response} for one agent. Optional parts come back as None when they fail."""
    _warm()

    def cli(*args: str):
        return _run(["agent", *args, "--project", PROJECT, "--json"])

    def api(path: str):
        return _run(["api", f"/orgs/default/projects/{PROJECT}/agents/{agent}/{path}"])

    def optional(f):
        def call():
            try:
                return f()
            except Exception:  # noqa: BLE001
                return None
        return call

    calls = {
        "agent": lambda: cli("get", agent),
        "status": lambda: cli("status", agent),
        "identities": optional(lambda: api("identities")),
        "resources": optional(lambda: api(f"resource-configs?environment={ENVIRONMENT}")),
        "config": optional(lambda: api(f"configurations?environment={ENVIRONMENT}")),
        "models": optional(lambda: api("model-configs")),
        "monitors": optional(lambda: api("monitors")),
    }
    with ThreadPoolExecutor(len(calls)) as pool:
        futures = {k: pool.submit(f) for k, f in calls.items()}
        r = {k: f.result() for k, f in futures.items()}
    model_cfg = ((r["models"] or {}).get("configs") or [None])[0]
    if model_cfg:
        r["model"] = optional(lambda: api(f"model-configs/{model_cfg['uuid']}"))()
    monitor = _monitor(r, kind)
    if monitor:
        r["scores"] = _monitor_scores(api, monitor)
    return r


# The slide's radar: each evaluator's mean score (0–1) in the monitor's latest run,
# as Agent Manager's UI shows it: a monitor re-run with other settings keeps the
# scores of its earlier runs, and a time window would mix them in. With no run yet,
# a future monitor is read over the last week and a past one from the start of the
# traces it evaluated. If it fails, the sheet still comes out, without a radar.
SCORES_DAYS = 7


def _monitor_scores(api, monitor: dict) -> dict:
    run = (monitor.get("latestRun") or {}).get("id")
    if run:
        try:
            return api(f"monitors/{quote(monitor['name'])}/runs/{run}/scores")
        except Exception:  # noqa: BLE001
            return {}
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=SCORES_DAYS)
    if monitor.get("type") == "past" and monitor.get("traceStart"):
        start = min(start, datetime.fromisoformat(monitor["traceStart"].replace("Z", "+00:00")))
    stamp = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    try:
        return api(f"monitors/{quote(monitor['name'])}/scores?startTime={stamp(start)}&endTime={stamp(end)}")
    except Exception:  # noqa: BLE001
        return {}


def _monitor_row(monitor, kind: str) -> str:
    if not monitor:
        return f"no {kind} monitor"
    head = f"{monitor['displayName']} · {len(monitor.get('evaluators') or [])} evaluators"
    if monitor.get("type") == "past":
        days = sorted({_when(monitor[k])[5:10] for k in ("traceStart", "traceEnd") if monitor.get(k)})
        when = f"traces {' → '.join(days)}" if days else "past traces"
    else:
        when = f"every {monitor['intervalMinutes']} min" if monitor.get("intervalMinutes") else "new traces"
    # Only an inactive monitor says so: the row is too narrow for "active" too.
    status = str(monitor.get("status", "")).lower()
    return f"{head} · {when}" + (f" · {status}" if status and status != "active" else "")


def sheet(r: dict, kind: str) -> dict:
    a = r["agent"]
    external = (a.get("provisioning") or {}).get("type") == "external"
    env = next((e for e in r["status"]["environments"] if e["name"] == ENVIRONMENT), {})
    ident = next((i for i in r["identities"] or [] if i.get("environmentName") == ENVIRONMENT), {})
    values = {v["key"]: v.get("value") for v in ((r["config"] or {}).get("configurations") or {}).get("env") or []
              if not v.get("isSensitive")}
    llm = (((r.get("model") or {}).get("envMappings") or {}).get(ENVIRONMENT) or {}).get("configuration") or {}
    monitor = _monitor(r, kind)
    url = urlparse((env.get("endpoints") or [{}])[0].get("url", ""))

    # External agents run outside Agent Manager: it holds their identity, not their
    # deployment, so "registered" is as live as they get.
    if external:
        active = ident.get("status") == "completed"
        status = f"external · registered {_when(a['createdAt'])}" if a.get("createdAt") else "external"
    else:
        active = env.get("status") == "active"
        status = env.get("status", "—")
        deployed = env.get("lastDeployed") or ""
        if deployed and not deployed.startswith("0001"):  # never deployed: 0001-01-01
            status += f" · deployed {_when(deployed)}"

    repo = (a.get("provisioning") or {}).get("repository") or {}
    pack = (a.get("build") or {}).get("buildpack") or {}
    if repo:
        source = f"{urlparse(repo['url']).path.strip('/').split('/')[-1]}{repo.get('appPath', '')}@{repo.get('branch', '—')}"
        if pack.get("language"):
            source += f" · {pack['language']} {pack.get('languageVersion', '')}".rstrip()
    else:
        source = "hosted outside Agent Manager" if external else "—"

    gateway = urlparse(values.get(GATEWAY_ENV) or "")
    model = (f"{llm['providerName']} · via AI Gateway" if llm.get("providerName")
             else f"via AI Gateway {gateway.path}" if gateway.path else "—")

    res = (r["resources"] or {}).get("resources") or {}
    req, lim = res.get("requests") or {}, res.get("limits") or {}
    replicas = (r["resources"] or {}).get("replicas")
    resources = (f"{replicas} replica{'' if replicas == 1 else 's'} · cpu {req.get('cpu')}/{lim.get('cpu')}"
                 f" · mem {req.get('memory')}/{lim.get('memory')}") if replicas and req else "—"

    # The agent's identity goes first.
    rows = [
        ["agent_id", ident.get("agentId", "—")],
        ["client_id", ident.get("clientId", "—")],
        ["status", status],
        ["endpoint", url.path or "—"],
        ["source", source],
        ["model", model],
        ["resources", resources],
        ["monitor", _monitor_row(monitor, kind)],
    ]
    # The radar's axes are the evaluators of the latest run (or, before any run, the
    # monitor's current ones), in order. An evaluator with no scores yet comes back
    # with score None (n/a on the slide).
    means = {e["evaluatorName"]: (e.get("aggregations") or {}).get("mean")
             for e in (r.get("scores") or {}).get("evaluators") or []}
    evaluators = ((monitor or {}).get("latestRun") or {}).get("evaluators") or (monitor or {}).get("evaluators") or []
    radar = [{"name": e["displayName"], "score": means.get(e["displayName"])} for e in evaluators]
    # Slide header: the gateway host without the environment prefix ("default-default.").
    return {"agent": a["name"], "displayName": a.get("displayName", ""), "description": a.get("description", ""), "active": active,
            "host": url.netloc.split(":")[0].split(".", 1)[-1] if url.netloc else "",
            "llm": llm.get("providerName", ""), "rows": rows, "radar": radar}


def payload(agent: str, kind: str = "past") -> dict:
    if agent not in AGENTS:
        return {"status": "error", "error": f"unknown agent: {agent}"}
    if kind not in ("past", "future"):
        return {"status": "error", "error": f"unknown monitor type: {kind}"}
    start = time.monotonic()
    try:
        data = sheet(fetch(agent, kind), kind)
        return {"status": "live", "taken": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "took": round(time.monotonic() - start, 1), **data}
    except Exception as exc:  # no cluster or no session: the slide shows the error
        return {"status": "error", "error": str(exc)[:300]}


if __name__ == "__main__":
    print(json.dumps(payload(sys.argv[1] if len(sys.argv) > 1 else "savingsagent",
                             sys.argv[2] if len(sys.argv) > 2 else "past"), ensure_ascii=False, indent=1))
