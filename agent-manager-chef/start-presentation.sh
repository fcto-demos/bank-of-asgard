#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${1:-8027}"
URL="http://127.0.0.1:${PORT}/inside-our-agents.html"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'Error: Python 3 is needed to start the presentation.\n' >&2
  exit 1
fi

cd "$SCRIPT_DIR"

# Before starting, check the amctl session (the slide reads Agent Manager through it).
# If it has expired, run `amctl login` and carry on; if Agent Manager does not
# answer, warn and start anyway: the slide shows the error in each column.
AMCTL="${AMCTL:-$(command -v amctl || true)}"
export AMCTL
ensure_amctl_session() {
  if [[ -z "$AMCTL" || ! -x "$AMCTL" ]]; then
    printf 'Warning: amctl not found; the slide will show an error per agent.\n'
    return 0
  fi
  local err
  if err=$("$AMCTL" api "/orgs/default/projects/${AM_PROJECT:-default}" 2>&1 >/dev/null); then
    printf 'Agent Manager session: OK.\n'
    return 0
  fi
  if grep -qiE 'amctl login|invalid_grant|unauthori|refresh token' <<<"$err"; then
    printf 'The Agent Manager session has expired: running amctl login…\n'
    "$AMCTL" login --name default \
      || printf 'Warning: login did not complete; the slide will show an error per agent.\n'
  else
    printf 'Warning: Agent Manager is not answering (%s).\n' "${err:0:160}"
  fi
}
ensure_amctl_session

# If the port is held by an old presentation server, stop it; if by anything else, bail out.
pids=$(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
for pid in $pids; do
  cmd=$(ps -o command= -p "$pid" 2>/dev/null || true)
  if [[ "$cmd" == *serve.py* ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 0.5
  else
    printf 'Error: port %s is used by another program (pid %s: %s).\n' "$PORT" "$pid" "${cmd:0:80}" >&2
    exit 1
  fi
done

printf 'Presentation at: %s\n' "$URL"
printf 'Press Ctrl+C to stop the server.\n'
(sleep 1; open "$URL") &
exec python3 serve.py "$PORT"
