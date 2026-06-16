#!/usr/bin/env bash
# restart.sh — stop and restart a single Bank of Asgard service
# Usage: ./demo_scripts/restart.sh <service>
# Services: transactions-api | agent | mcp | server | frontend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT/.demo.pids"
CONTEXT_FILE="$ROOT/.demo.context"
LOG_DIR="$ROOT/.demo-logs"

PORT_API=8010
PORT_AGENT=8011
PORT_MCP=8012
PORT_SERVER=3002
PORT_FRONTEND=5173

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${BLUE}→${NC}  $1"; }
ok()      { echo -e "  ${GREEN}✔${NC}  $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; }
section() { echo -e "\n${BOLD}${BLUE}▸ $1${NC}"; }
die()     { echo -e "\n${RED}${BOLD}Error: $1${NC}" >&2; exit 1; }

SERVICE="${1:-}"

show_help() {
    echo ""
    echo -e "${BOLD}Usage:${NC} ./demo_scripts/restart.sh <service>"
    echo ""
    echo -e "  ${BOLD}service${NC}   transactions-api | agent | mcp | server | frontend"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  ./demo_scripts/restart.sh agent"
    echo "  ./demo_scripts/restart.sh mcp"
    echo "  ./demo_scripts/restart.sh transactions-api"
    echo ""
}

[[ -z "$SERVICE" || "$SERVICE" == "--help" ]] && { show_help; exit 0; }
[[ -f "$PID_FILE" ]]    || die "No demo instance running (.demo.pids not found). Start with ./demo_scripts/start-demo.sh"
[[ -f "$CONTEXT_FILE" ]] || die ".demo.context not found — was the demo started with start-demo.sh?"

# Load startup context (AGENT, AGENT_ARG, USE_AMP)
# shellcheck source=/dev/null
source "$CONTEXT_FILE"

ENV_PROFILE="${ENV_PROFILE:-unknown}"
echo -e "\n${BOLD}Bank of Asgard — restart $SERVICE${NC}  ${YELLOW}[env: $ENV_PROFILE]${NC}"
echo    "────────────────────────────────────────"

# ── Stop a named service by its PID file entry ────────────────────────────────
stop_service() {
    local name="$1"
    local pid
    pid=$(grep "^$name:" "$PID_FILE" 2>/dev/null | cut -d: -f2 || true)

    if [[ -z "$pid" ]]; then
        warn "$name not found in .demo.pids — skipping stop"
        return 0
    fi

    if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        local waited=0
        while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 5 ]]; do
            sleep 1; ((waited++)) || true
        done
        kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
        ok "Stopped $name (pid $pid)"
    else
        warn "$name (pid $pid) was not running"
    fi

    local tmp
    tmp=$(mktemp)
    { grep -v "^$name:" "$PID_FILE" || true; } > "$tmp"
    mv "$tmp" "$PID_FILE"
}

# ── Register the new PID back into the PID file ───────────────────────────────
register_pid() {
    echo "$1:$2" >> "$PID_FILE"
}

# ── Kill any process on a port and wait until it is actually free ─────────────
free_port() {
    local port="$1" timeout="${2:-15}"
    local pid elapsed=0

    # Kill anything still bound to the port
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    if [[ -n "$pid" ]]; then
        warn "Port $port still held by pid $pid — force-killing"
        kill -KILL $pid 2>/dev/null || true
    fi

    # Wait until the port is confirmed free
    info "Waiting for port $port to be released..."
    while [[ $elapsed -lt $timeout ]]; do
        if ! lsof -ti ":$port" &>/dev/null; then
            ok "Port $port is free"
            return 0
        fi
        sleep 1; ((elapsed++)) || true
    done
    die "Port $port still in use after ${timeout}s — cannot restart"
}

# ── Verify the background process is still alive a moment after launch ────────
check_launched() {
    local pid="$1" service="$2"
    sleep 2
    if ! kill -0 "$pid" 2>/dev/null; then
        die "$service process (pid $pid) exited immediately — check the log above"
    fi
}

# ── Health check helpers ──────────────────────────────────────────────────────
wait_for_port() {
    local port="$1" service="$2" timeout="${3:-60}"
    local elapsed=0
    info "Waiting for $service..."
    while [[ $elapsed -lt $timeout ]]; do
        if (echo >/dev/tcp/localhost/$port) 2>/dev/null; then
            ok "$service is up"
            return 0
        fi
        sleep 2; elapsed=$((elapsed + 2))
    done
    die "$service did not start within ${timeout}s — check $LOG_DIR/mcp.log"
}

wait_for_http() {
    local url="$1" service="$2" timeout="${3:-60}"
    local elapsed=0
    info "Waiting for $service..."
    while [[ $elapsed -lt $timeout ]]; do
        if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
            ok "$service is up"
            return 0
        fi
        sleep 2; elapsed=$((elapsed + 2))
    done
    die "$service did not start within ${timeout}s — check $LOG_DIR/$service.log"
}

# ── Per-service restart ───────────────────────────────────────────────────────
case "$SERVICE" in

    transactions-api)
        section "Restarting transactions-api (port $PORT_API)"
        stop_service "transactions-api"
        free_port $PORT_API
        TXAPI_PY="$ROOT/transactions-api/venv/bin/python"
        [[ -f "$TXAPI_PY" ]] || die "transactions-api venv not found"
        (cd "$ROOT/transactions-api" && "$TXAPI_PY" -m uvicorn app.main:app --port "$PORT_API" \
            > "$LOG_DIR/transactions-api.log" 2>&1) &
        register_pid "transactions-api" "$!"
        check_launched "$!" "transactions-api"
        wait_for_http "http://localhost:$PORT_API/health" "transactions-api"
        LOG_FILE="$LOG_DIR/transactions-api.log"
        ;;

    agent)
        # Read startup context so we restart with the exact same framework + AMP setting
        [[ -n "$AGENT" ]]    || die "AGENT not set in .demo.context — re-run start-demo.sh"
        [[ -n "$USE_AMP" ]]  || die "USE_AMP not set in .demo.context — re-run start-demo.sh"
        AMP_LABEL=$( [[ "$USE_AMP" == "true" ]] && echo "AMP enabled" || echo "AMP disabled" )
        section "Restarting $AGENT_ARG (port $PORT_AGENT)"
        ok "Framework: $AGENT_ARG  |  $AMP_LABEL"
        stop_service "agent"
        free_port $PORT_AGENT
        AGENT_DIR="$ROOT/transactions-agent"
        AGENT_ENV="$ROOT/transactions-agent/.env"
        UVICORN="$AGENT_DIR/$AGENT/venv/bin/uvicorn"
        AMP_INSTRUMENT="$AGENT_DIR/$AGENT/venv/bin/amp-instrument"
        [[ -f "$UVICORN" ]]   || die "venv not found for $AGENT — check $AGENT_DIR/$AGENT/venv/"
        [[ -f "$AGENT_ENV" ]] || die "transactions-agent/.env not found"
        if [[ "$USE_AMP" == "true" ]]; then
            [[ -f "$AMP_INSTRUMENT" ]] || die "amp-instrument not found in $AGENT venv"
            _amp_var() { grep -E "^$1=" "$AGENT_ENV" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"; }
            AMP_OTEL_ENDPOINT=$(_amp_var AMP_OTEL_ENDPOINT)
            AMP_AGENT_API_KEY=$(_amp_var AMP_AGENT_API_KEY)
            (export AMP_OTEL_ENDPOINT AMP_AGENT_API_KEY; cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" \
                "$AMP_INSTRUMENT" "$UVICORN" service:app \
                --app-dir "$AGENT" --port "$PORT_AGENT" \
                > "$LOG_DIR/agent.log" 2>&1) &
        else
            (set +u; set -a; source "$AGENT_ENV"; set +a; set -u; cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" \
                "$UVICORN" service:app \
                --app-dir "$AGENT" --port "$PORT_AGENT" \
                > "$LOG_DIR/agent.log" 2>&1) &
        fi
        register_pid "agent" "$!"
        check_launched "$!" "agent"
        wait_for_http "http://localhost:$PORT_AGENT/openapi.json" "$AGENT"
        LOG_FILE="$LOG_DIR/agent.log"
        ;;

    mcp)
        section "Restarting agencies-mcp-server (port $PORT_MCP)"
        stop_service "mcp"
        free_port $PORT_MCP
        MCP_PY="$ROOT/agencies-mcp-server/venv/bin/python"
        MCP_ENV="$ROOT/agencies-mcp-server/.env"
        [[ -f "$MCP_PY" ]]  || die "agencies-mcp-server venv not found"
        [[ -f "$MCP_ENV" ]] || die "agencies-mcp-server/.env not found"
        (set +u; set -a; source "$MCP_ENV"; set +a; set -u; cd "$ROOT/agencies-mcp-server" && "$MCP_PY" server.py \
            > "$LOG_DIR/mcp.log" 2>&1) &
        register_pid "mcp" "$!"
        check_launched "$!" "agencies-mcp-server"
        wait_for_port $PORT_MCP "agencies-mcp-server"
        LOG_FILE="$LOG_DIR/mcp.log"
        ;;

    server)
        section "Restarting server (port $PORT_SERVER)"
        stop_service "server"
        free_port $PORT_SERVER
        (cd "$ROOT/server" && node server.js \
            > "$LOG_DIR/server.log" 2>&1) &
        register_pid "server" "$!"
        check_launched "$!" "server"
        wait_for_http "http://localhost:$PORT_SERVER/health" "server"
        LOG_FILE="$LOG_DIR/server.log"
        ;;

    frontend)
        section "Restarting frontend (port $PORT_FRONTEND)"
        stop_service "frontend"
        free_port $PORT_FRONTEND
        (cd "$ROOT/app" && npm run start \
            > "$LOG_DIR/frontend.log" 2>&1) &
        register_pid "frontend" "$!"
        check_launched "$!" "frontend"
        wait_for_http "http://localhost:$PORT_FRONTEND" "frontend" 90
        LOG_FILE="$LOG_DIR/frontend.log"
        ;;

    *)
        die "Unknown service '$SERVICE'. Choose: transactions-api, agent, mcp, server, frontend"
        ;;
esac

echo ""
echo "────────────────────────────────────────"
echo -e "${GREEN}${BOLD}$SERVICE restarted.${NC}"
echo -e "  Log: ${BLUE}$LOG_FILE${NC}"
echo ""
