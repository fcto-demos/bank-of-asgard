#!/usr/bin/env bash
# stop-demo.sh — Stop all Bank of Asgard demo processes
# Usage: ./scripts/stop-demo.sh [--quiet]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT/.demo.pids"

# ── Ports (edit here if you change a service port) ────────────────────────────
PORT_FRONTEND=5173
PORT_SERVER=3002
PORT_API=8010
PORT_AGENT=8011
PORT_MCP=8012

QUIET=false
[[ "${1:-}" == "--quiet" ]] && QUIET=true

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { $QUIET || echo -e "  ${GREEN}✔${NC}  $1"; }
warn() { $QUIET || echo -e "  ${YELLOW}⚠${NC}  $1"; }

$QUIET || echo -e "\n${BOLD}Bank of Asgard — stopping demo${NC}"
$QUIET || echo    "────────────────────────────────────────"

if [[ ! -f "$PID_FILE" ]]; then
    warn "No .demo.pids file found — nothing to stop."
    exit 0
fi

stop_process() {
    local name="$1" pid="$2"
    if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        # Give it 5s to exit gracefully, then force-kill
        local waited=0
        while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 5 ]]; do
            sleep 1
            ((waited++)) || true
        done
        if kill -0 "$pid" 2>/dev/null; then
            kill -KILL "$pid" 2>/dev/null || true
        fi
        ok "Stopped $name (pid $pid)"
    else
        warn "$name (pid $pid) was not running"
    fi
}

while IFS=: read -r name pid; do
    [[ -z "$pid" ]] && continue
    stop_process "$name" "$pid"
done < "$PID_FILE"

rm -f "$PID_FILE" "$ROOT/.demo.context"

# ── Port sweep — catch any orphaned children the PID kill missed ──────────────
for port in $PORT_API $PORT_AGENT $PORT_MCP $PORT_SERVER $PORT_FRONTEND; do
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        kill -KILL $pid 2>/dev/null || true
        $QUIET || warn "Force-killed orphaned process on port $port (pid $pid)"
    fi
done

$QUIET || echo ""
$QUIET || echo -e "${GREEN}${BOLD}All services stopped.${NC}"
$QUIET || echo -e "Logs preserved in ${BOLD}.demo-logs/${NC} — delete manually if no longer needed."
$QUIET || echo ""
