#!/usr/bin/env bash
# start-demo.sh — Bank of Asgard full-stack demo launcher
# Starts: transactions-api → selected agent → agencies-mcp-server → server → frontend
# Logs go to .demo-logs/  PIDs tracked in .demo.pids

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT/.demo-logs"
PID_FILE="$ROOT/.demo.pids"

# ── Ports (edit here if you change a service port) ────────────────────────────
PORT_FRONTEND=5173
PORT_SERVER=3002
PORT_API=8010
PORT_AGENT=8011
PORT_MCP=8012

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "  ${BLUE}→${NC}  $1"; }
ok()      { echo -e "  ${GREEN}✔${NC}  $1"; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; }
fail()    { echo -e "  ${RED}✗${NC}  $1"; }
section() { echo -e "\n${BOLD}${BLUE}▸ $1${NC}"; }
die()     { echo -e "\n${RED}${BOLD}Error: $1${NC}" >&2; exit 1; }

show_help() {
    echo ""
    echo -e "${BOLD}Usage:${NC} ./demo_scripts/start-demo.sh [agent] [options]"
    echo ""
    echo -e "  ${BOLD}agent${NC}     langchain | autogen | strands  (prompted if omitted)"
    echo ""
    echo -e "${BOLD}Options:${NC}"
    echo "  --env=is|asgardeo  Copy .env.<profile> → .env for all services before starting"
    echo "                     (prompted if omitted)"
    echo "  --amp              Enable WSO2 Agent Manager (AMP) instrumentation"
    echo "                     Supported by: langchain, strands (autogen lacks the required packages)"
    echo "                     Requires: amp-instrumentation installed in the agent venv"
    echo "                               AMP_OTEL_ENDPOINT and AMP_AGENT_API_KEY in transactions-agent/.env"
    echo "  --help             Show this help and exit"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  ./demo_scripts/start-demo.sh"
    echo "  ./demo_scripts/start-demo.sh langchain --env=asgardeo"
    echo "  ./demo_scripts/start-demo.sh strands --env=is --amp"
    echo ""
}

# ── Argument parsing ──────────────────────────────────────────────────────────
USE_AMP=false
AGENT_ARG=""
ENV_PROFILE=""
for arg in "$@"; do
    case "$arg" in
        --amp)          USE_AMP=true ;;
        --env=is)       ENV_PROFILE="is" ;;
        --env=asgardeo) ENV_PROFILE="asgardeo" ;;
        --help)         show_help; exit 0 ;;
        -*)             die "Unknown option: $arg. Run --help for usage." ;;
        *)              [[ -z "$AGENT_ARG" ]] && AGENT_ARG="$arg" || die "Unexpected argument: $arg. Run --help for usage." ;;
    esac
done

# ── Existing instance guard ───────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    echo -e "${YELLOW}A demo instance is already running (found .demo.pids).${NC}"
    echo    "Run ./scripts/stop-demo.sh first, or delete .demo.pids to force-start."
    exit 1
fi

echo -e "\n${BOLD}Bank of Asgard — demo launcher${NC}"
echo    "────────────────────────────────────────"

# ── Pre-flight (includes port checks — exits immediately on any failure) ───────
section "Running pre-flight checks"
"$SCRIPT_DIR/validate.sh" || die "Pre-flight failed — fix the issues above first."

# ── Agent selection (only reached if all checks pass) ─────────────────────────
section "Agent selection"

if [[ -z "$AGENT_ARG" ]]; then
    echo ""
    echo "  Which agent implementation would you like to start?"
    echo "  1) langchain"
    echo "  2) autogen"
    echo "  3) strands"
    echo ""
    read -rp "  Enter choice [1-3]: " choice
    case "$choice" in
        1) AGENT_ARG="langchain" ;;
        2) AGENT_ARG="autogen"   ;;
        3) AGENT_ARG="strands"   ;;
        *) die "Invalid choice." ;;
    esac
fi

# Map profile/short name → folder name
case "$AGENT_ARG" in
    langchain|langchain-agent) AGENT="langchain-agent" ;;
    autogen|autogen-agent)     AGENT="autogen-agent"   ;;
    strands|strands-agent)     AGENT="strands-agent"   ;;
    *) die "Unknown agent '$AGENT_ARG'. Choose: langchain, autogen, or strands." ;;
esac

# ── AMP instrumentation selection ────────────────────────────────────────────
AMP_SUPPORTED=false
[[ "$AGENT" == "langchain-agent" || "$AGENT" == "strands-agent" ]] && AMP_SUPPORTED=true

if $USE_AMP && ! $AMP_SUPPORTED; then
    warn "AMP instrumentation is not supported by $AGENT_ARG (only langchain and strands). Skipping."
    USE_AMP=false
elif $AMP_SUPPORTED && ! $USE_AMP; then
    echo ""
    read -rp "  Enable AMP (Agent Manager) instrumentation? [y/N]: " amp_choice
    [[ "$amp_choice" =~ ^[Yy]$ ]] && USE_AMP=true || true
fi

# ── MCP server paths ──────────────────────────────────────────────────────────
MCP_PY="$ROOT/agencies-mcp-server/venv/bin/python"
MCP_ENV="$ROOT/agencies-mcp-server/.env"
[[ -f "$MCP_PY" ]]  || die "agencies-mcp-server venv not found. Run: cd agencies-mcp-server && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt"
[[ -f "$MCP_ENV" ]] || die "agencies-mcp-server/.env not found — copy from agencies-mcp-server/.env.example"

# ── Read LLM config ───────────────────────────────────────────────────────────
LLM_CONFIG="$ROOT/llm_config.yaml"
LLM_PROVIDER=$(grep -E '^provider:' "$LLM_CONFIG" 2>/dev/null | sed 's/provider:[[:space:]]*//' | tr -d '[:space:]' || true)
LLM_MODEL=$(grep -E '^model:' "$LLM_CONFIG" 2>/dev/null | sed 's/model:[[:space:]]*//' | tr -d '[:space:]' || true)
LLM_GATEWAY=$(grep -E '^\s*enabled:\s*true' "$LLM_CONFIG" 2>/dev/null | head -1 || true)

LLM_PROVIDER="${LLM_PROVIDER:-openai}"
if [[ -z "$LLM_MODEL" ]]; then
    case "$LLM_PROVIDER" in
        openai)    LLM_MODEL="gpt-4o-mini" ;;
        gemini)    LLM_MODEL="gemini-2.5-flash-lite" ;;
        anthropic) LLM_MODEL="claude-sonnet-4-6" ;;
        bedrock)   LLM_MODEL="eu.anthropic.claude-sonnet-4-6-20250514-v1:0" ;;
        mistral)   LLM_MODEL="mistral-small-latest" ;;
        *)         LLM_MODEL="unknown" ;;
    esac
fi
if [[ -n "$LLM_GATEWAY" ]]; then LLM_VIA=" via gateway"; else LLM_VIA=""; fi

AGENT_DIR="$ROOT/transactions-agent"
AGENT_PY="$AGENT_DIR/$AGENT/venv/bin/python"
AMP_INSTRUMENT="$AGENT_DIR/$AGENT/venv/bin/amp-instrument"
[[ -f "$AGENT_PY" ]] || die "venv not found for $AGENT — run: python3.11 -m venv transactions-agent/$AGENT/venv && transactions-agent/$AGENT/venv/bin/pip install -r transactions-agent/$AGENT/requirements.txt"

if $USE_AMP; then
    [[ -f "$AMP_INSTRUMENT" ]] || die "amp-instrument not found in $AGENT venv. Install via: $AGENT_DIR/$AGENT/venv/bin/pip install amp-instrumentation"
    AGENT_ENV="$ROOT/transactions-agent/.env"
    grep -q "AMP_OTEL_ENDPOINT" "$AGENT_ENV" 2>/dev/null || warn "AMP_OTEL_ENDPOINT not found in transactions-agent/.env"
    grep -q "AMP_AGENT_API_KEY" "$AGENT_ENV" 2>/dev/null || warn "AMP_AGENT_API_KEY not found in transactions-agent/.env"
    ok "AMP instrumentation enabled"
fi

ok "Using agent: ${AGENT_ARG}"

# ── IDP environment selection ─────────────────────────────────────────────────
section "IDP environment"

if [[ -z "$ENV_PROFILE" ]]; then
    echo ""
    echo "  Which identity provider environment?"
    echo "  1) asgardeo"
    echo "  2) is  (WSO2 Identity Server)"
    echo ""
    read -rp "  Enter choice [1-2]: " env_choice
    case "$env_choice" in
        1) ENV_PROFILE="asgardeo" ;;
        2) ENV_PROFILE="is" ;;
        *) die "Invalid choice." ;;
    esac
fi

ENV_DIRS=(
    "$ROOT/agencies-mcp-server"
    "$ROOT/server"
    "$ROOT/transactions-agent"
    "$ROOT/transactions-api"
)
for dir in "${ENV_DIRS[@]}"; do
    src="$dir/.env.$ENV_PROFILE"
    if [[ -f "$src" ]]; then
        cp "$src" "$dir/.env"
        ok "$(basename "$dir")/.env  ← .env.$ENV_PROFILE"
    else
        warn "$(basename "$dir")/.env.$ENV_PROFILE not found — existing .env unchanged"
    fi
done

CONFIG_SRC="$ROOT/app/public/config.$ENV_PROFILE.js"
CONFIG_DST="$ROOT/app/public/config.js"
if [[ -f "$CONFIG_SRC" ]]; then
    cp "$CONFIG_SRC" "$CONFIG_DST"
    ok "app/public/config.js  ← config.$ENV_PROFILE.js"
else
    warn "app/public/config.$ENV_PROFILE.js not found — existing config.js unchanged"
fi

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
: > "$PID_FILE"

# Persist startup context so restart.sh can relaunch services identically
cat > "$ROOT/.demo.context" <<EOF
AGENT=$AGENT
AGENT_ARG=$AGENT_ARG
USE_AMP=$USE_AMP
<<<<<<< HEAD
=======
ENV_PROFILE=$ENV_PROFILE
>>>>>>> 9fb4f1b (Switch to sonnet 4.6)
EOF

# Cleanup on unexpected exit during startup
cleanup_on_error() {
    echo -e "\n${RED}Startup interrupted — cleaning up...${NC}"
    "$SCRIPT_DIR/stop-demo.sh" --quiet 2>/dev/null || true
}
trap cleanup_on_error ERR INT TERM

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
        sleep 2
        elapsed=$((elapsed + 2))
    done
    fail "$service did not start within ${timeout}s — check $LOG_DIR/mcp.log"
    "$SCRIPT_DIR/stop-demo.sh" --quiet 2>/dev/null || true
    exit 1
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
        sleep 2
        elapsed=$((elapsed + 2))
    done
    fail "$service did not start within ${timeout}s — check .demo-logs/$service.log"
    "$SCRIPT_DIR/stop-demo.sh" --quiet 2>/dev/null || true
    exit 1
}

# ── Start transactions-api ────────────────────────────────────────────────────
section "Starting transactions-api (port $PORT_API)"

TXAPI_PY="$ROOT/transactions-api/venv/bin/python"
[[ -f "$TXAPI_PY" ]] || die "transactions-api venv not found — run: cd transactions-api && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt"
(cd "$ROOT/transactions-api" && "$TXAPI_PY" -m uvicorn app.main:app --port "$PORT_API" \
    > "$LOG_DIR/transactions-api.log" 2>&1) &
echo "transactions-api:$!" >> "$PID_FILE"

wait_for_http "http://localhost:$PORT_API/health" "transactions-api"

# ── Start transactions-agent ──────────────────────────────────────────────────
section "Starting $AGENT (port $PORT_AGENT)"

UVICORN="$AGENT_DIR/$AGENT/venv/bin/uvicorn"
if $USE_AMP; then
    # Export only the two AMP vars amp-instrument needs at startup.
    # Do NOT source the whole .env — bash variable expansion would corrupt any
    # value containing $ (silently truncating secrets). Everything else is loaded
    # safely by Python's load_dotenv() after the process starts.
    _amp_var() { grep -E "^$1=" "$AGENT_ENV" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"; }
    AMP_OTEL_ENDPOINT=$(_amp_var AMP_OTEL_ENDPOINT)
    AMP_AGENT_API_KEY=$(_amp_var AMP_AGENT_API_KEY)
    (export AMP_OTEL_ENDPOINT AMP_AGENT_API_KEY; cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" "$AMP_INSTRUMENT" "$UVICORN" service:app \
        --app-dir "$AGENT" --port "$PORT_AGENT" \
        > "$LOG_DIR/agent.log" 2>&1) &
else
    (cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" "$UVICORN" service:app \
        --app-dir "$AGENT" --port "$PORT_AGENT" \
        > "$LOG_DIR/agent.log" 2>&1) &
fi
echo "agent:$!" >> "$PID_FILE"

wait_for_http "http://localhost:$PORT_AGENT/openapi.json" "$AGENT"

# ── Start agencies-mcp-server ─────────────────────────────────────────────────
section "Starting agencies-mcp-server (port $PORT_MCP)"

(set +u; set -a; source "$MCP_ENV"; set +a; set -u; cd "$ROOT/agencies-mcp-server" && "$MCP_PY" server.py \
    > "$LOG_DIR/mcp.log" 2>&1) &
echo "mcp:$!" >> "$PID_FILE"

wait_for_port $PORT_MCP "agencies-mcp-server"

# ── Start server (Express) ────────────────────────────────────────────────────
section "Starting server (port $PORT_SERVER)"

(cd "$ROOT/server" && node server.js \
    > "$LOG_DIR/server.log" 2>&1) &
echo "server:$!" >> "$PID_FILE"

wait_for_http "http://localhost:$PORT_SERVER/health" "server"

# ── Start frontend (Vite) ─────────────────────────────────────────────────────
section "Starting frontend (port $PORT_FRONTEND)"

# Toggle AWS branding based on agent — strands uses Bedrock (AWS), others do not
CONFIG_JS="$ROOT/app/public/config.js"
if [[ "$AGENT" == "strands-agent" ]]; then
    tmp=$(mktemp) && sed 's/AWS_BRANDING: false/AWS_BRANDING: true/' "$CONFIG_JS" > "$tmp" && mv "$tmp" "$CONFIG_JS"
    ok "AWS branding enabled (strands/Bedrock)"
else
    tmp=$(mktemp) && sed 's/AWS_BRANDING: true/AWS_BRANDING: false/' "$CONFIG_JS" > "$tmp" && mv "$tmp" "$CONFIG_JS"
    ok "AWS branding disabled ($AGENT_ARG)"
fi

(cd "$ROOT/app" && npm run start \
    > "$LOG_DIR/frontend.log" 2>&1) &
echo "frontend:$!" >> "$PID_FILE"

wait_for_http "http://localhost:$PORT_FRONTEND" "frontend" 90

# ── Remove error trap now that everything is up ───────────────────────────────
trap - ERR INT TERM

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo -e "${GREEN}${BOLD}Demo is running!${NC}"
echo ""
echo -e "  ${BOLD}Frontend${NC}             http://localhost:$PORT_FRONTEND"
echo -e "  ${BOLD}Server API${NC}           http://localhost:$PORT_SERVER"
echo -e "  ${BOLD}Transactions API${NC}     http://localhost:$PORT_API"
echo -e "  ${BOLD}Agent ($AGENT_ARG)${NC}           ws://localhost:$PORT_AGENT"
echo -e "  ${BOLD}Agencies MCP${NC}         sse://localhost:$PORT_MCP"
echo -e "  ${BOLD}LLM${NC}                  $LLM_PROVIDER / $LLM_MODEL${LLM_VIA}"
echo -e "  ${BOLD}IDP environment${NC}      $ENV_PROFILE"
[[ "$AGENT" == "strands-agent" ]] && echo -e "  ${BOLD}AWS branding${NC}         enabled" || echo -e "  ${BOLD}AWS branding${NC}         disabled"
$USE_AMP && echo -e "  ${BOLD}AMP instrumentation${NC}  enabled" || true
echo ""
echo -e "  Logs:"
echo -e "    ${BLUE}$LOG_DIR/transactions-api.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/agent.log${NC}          ($AGENT_ARG)"
echo -e "    ${BLUE}$LOG_DIR/mcp.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/server.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/frontend.log${NC}"
echo -e "  To stop: ${BLUE}./demo_scripts/stop-demo.sh${NC}"
echo ""
