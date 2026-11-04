#!/usr/bin/env python3
"""Server for the Bank of Asgard slides: static files plus /api/agent, /api/session
and /api/token-audit.

/api/agent?name=<agent>&monitor=past|future returns that agent's real sheet,
queried from Agent Manager with amctl on every request (agent_info.py), with no
fallback copy. /api/session leaves the amctl session refreshed. /api/token-audit
returns the demo's token audit trail (.demo-logs/token-audit.jsonl), oldest first,
for token-flow.html.
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import agent_info

AUDIT_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".demo-logs", "token-audit.jsonl")
# Only the newest part of the log is read, as the app server's /token-audit does.
AUDIT_TAIL_BYTES = 5 * 1024 * 1024


def token_audit():
    try:
        with open(AUDIT_LOG, "rb") as f:
            start = max(0, f.seek(0, os.SEEK_END) - AUDIT_TAIL_BYTES)
            f.seek(start)
            lines = f.read().decode("utf-8", "replace").splitlines()
    except FileNotFoundError:
        return []
    events = []
    # A tail read starts mid-line: drop that first partial line.
    for line in lines[1 if start else 0:]:
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    events.sort(key=lambda e: e.get("epoch", 0))
    return events


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route, _, query = self.path.partition("?")
        if route in ("/api/agent", "/api/session", "/api/token-audit"):
            params = parse_qs(query)
            if route == "/api/token-audit":
                data = token_audit()
            elif route == "/api/session":
                data = agent_info.check_session()
            else:
                data = agent_info.payload((params.get("name") or [""])[0], (params.get("monitor") or ["past"])[0])
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8027
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
