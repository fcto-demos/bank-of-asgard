#!/usr/bin/env python3
"""Server for the Bank of Asgard slides: static files plus /api/agent and /api/session.

/api/agent?name=<agent>&monitor=past|future returns that agent's real sheet,
queried from Agent Manager with amctl on every request (agent_info.py), with no
fallback copy. /api/session leaves the amctl session refreshed.
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import agent_info


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route, _, query = self.path.partition("?")
        if route in ("/api/agent", "/api/session"):
            params = parse_qs(query)
            data = (agent_info.check_session() if route == "/api/session" else
                    agent_info.payload((params.get("name") or [""])[0], (params.get("monitor") or ["past"])[0]))
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
