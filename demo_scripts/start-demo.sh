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
PORT_SAVINGS=8013

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
    echo "  --env=is|asgardeo  Back up existing .env files then switch to this profile"
    echo "                     (omit to keep your existing .env files unchanged)"
    echo "  --amp              Enable WSO2 Agent Manager (AMP) instrumentation"
    echo "                     Supported by: langchain, strands (autogen lacks the required packages)"
    echo "                     Also instruments savings-goals-agent, which has its own entry in"
    echo "                     Agent Manager — each agent needs its own AMP_AGENT_API_KEY value."
    echo "                     Requires: amp-instrumentation installed in both agent venvs"
    echo "                               AMP_OTEL_ENDPOINT and AMP_AGENT_API_KEY in transactions-agent/.env"
    echo "                               AMP_OTEL_ENDPOINT and AMP_AGENT_API_KEY in savings-goals-agent/.env"
    echo "  --v1 | --v2        Demo-only regression toggle for tracing/eval demos (default: v1)"
    echo "                     v2 deliberately degrades token usage and latency (bloated system"
    echo "                     prompt + over-fetching GetMyTransactions) to show up in traces."
    echo "  --help             Show this help and exit"
    echo ""
    echo -e "${BOLD}Examples:${NC}"
    echo "  ./demo_scripts/start-demo.sh langchain              # uses existing .env files"
    echo "  ./demo_scripts/start-demo.sh langchain --env=asgardeo  # backs up then switches profile"
    echo "  ./demo_scripts/start-demo.sh strands --env=is --amp"
    echo "  ./demo_scripts/start-demo.sh langchain --amp --v2   # demo the regression with AMP tracing"
    echo ""
}

# ── Argument parsing ──────────────────────────────────────────────────────────
USE_AMP=false
AGENT_ARG=""
ENV_PROFILE=""
DEMO_VERSION="v1"
for arg in "$@"; do
    case "$arg" in
        --amp)          USE_AMP=true ;;
        --env=is)       ENV_PROFILE="is" ;;
        --env=asgardeo) ENV_PROFILE="asgardeo" ;;
        --v1)           DEMO_VERSION="v1" ;;
        --v2)           DEMO_VERSION="v2" ;;
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

# ── Savings Goals agent paths ─────────────────────────────────────────────────
SAVINGS_PY="$ROOT/savings-goals-agent/venv/bin/python"
SAVINGS_ENV="$ROOT/savings-goals-agent/.env"
[[ -f "$SAVINGS_PY" ]]  || die "savings-goals-agent venv not found. Run: cd savings-goals-agent && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt"
[[ -f "$SAVINGS_ENV" ]] || die "savings-goals-agent/.env not found — copy from savings-goals-agent/.env.example"

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

SAVINGS_AMP_INSTRUMENT="$ROOT/savings-goals-agent/venv/bin/amp-instrument"

if $USE_AMP; then
    [[ -f "$AMP_INSTRUMENT" ]] || die "amp-instrument not found in $AGENT venv. Install via: $AGENT_DIR/$AGENT/venv/bin/pip install amp-instrumentation"
    AGENT_ENV="$ROOT/transactions-agent/.env"
    grep -q "AMP_OTEL_ENDPOINT" "$AGENT_ENV" 2>/dev/null || warn "AMP_OTEL_ENDPOINT not found in transactions-agent/.env"
    grep -q "AMP_AGENT_API_KEY" "$AGENT_ENV" 2>/dev/null || warn "AMP_AGENT_API_KEY not found in transactions-agent/.env"

    # Each agent has its own entry in Agent Manager — savings-goals-agent needs its own
    # AMP_OTEL_ENDPOINT/AMP_AGENT_API_KEY, read from its own .env, not transactions-agent's.
    [[ -f "$SAVINGS_AMP_INSTRUMENT" ]] || die "amp-instrument not found in savings-goals-agent venv. Install via: savings-goals-agent/venv/bin/pip install amp-instrumentation"
    grep -q "AMP_OTEL_ENDPOINT" "$SAVINGS_ENV" 2>/dev/null || warn "AMP_OTEL_ENDPOINT not found in savings-goals-agent/.env"
    grep -q "AMP_AGENT_API_KEY" "$SAVINGS_ENV" 2>/dev/null || warn "AMP_AGENT_API_KEY not found in savings-goals-agent/.env"
    ok "AMP instrumentation enabled (transactions-agent + savings-goals-agent, separate keys)"
fi

ok "Using agent: ${AGENT_ARG}"

# ── IDP environment selection ─────────────────────────────────────────────────
section "IDP environment"

ENV_DIRS=(
    "$ROOT/agencies-mcp-server"
    "$ROOT/server"
    "$ROOT/transactions-agent"
    "$ROOT/transactions-api"
)

if [[ -z "$ENV_PROFILE" ]]; then
    ok "Using existing .env files"
else
    for dir in "${ENV_DIRS[@]}"; do
        [[ -f "$dir/.env" ]] && cp "$dir/.env" "$dir/.env.bak"
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
    [[ -f "$CONFIG_DST" ]] && cp "$CONFIG_DST" "$ROOT/app/public/config.js.bak"
    if [[ -f "$CONFIG_SRC" ]]; then
        cp "$CONFIG_SRC" "$CONFIG_DST"
        ok "app/public/config.js  ← config.$ENV_PROFILE.js"
    else
        warn "app/public/config.$ENV_PROFILE.js not found — existing config.js unchanged"
    fi
fi

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
: > "$PID_FILE"

# Start each demo with a clean token audit trail. The agents append (never truncate)
# to this file, so without this the Token Flow page's transaction_id list keeps growing
# with stale entries from previous demo runs. Unlike the .log files (overwritten with >
# on each start), this JSONL log would otherwise persist across demos.
: > "$LOG_DIR/token-audit.jsonl"

# Persist startup context so restart.sh can relaunch services identically
cat > "$ROOT/.demo.context" <<EOF
AGENT=$AGENT
AGENT_ARG=$AGENT_ARG
USE_AMP=$USE_AMP
ENV_PROFILE=$ENV_PROFILE
DEMO_VERSION=$DEMO_VERSION
EOF

# Cleanup on unexpected exit during startup
cleanup_on_error() {
    echo -e "\n${RED}Startup interrupted — cleaning up...${NC}"
    "$SCRIPT_DIR/stop-demo.sh" --quiet 2>/dev/null || true
}
trap cleanup_on_error ERR INT TERM

# ── Crash detection: verify a background process is still alive after 2s ─────
check_launched() {
    local pid="$1" service="$2" log="$3"
    sleep 2
    if ! kill -0 "$pid" 2>/dev/null; then
        fail "$service exited immediately — last lines of log:"
        echo ""
        tail -20 "$log" 2>/dev/null | sed 's/^/    /'
        echo ""
        "$SCRIPT_DIR/stop-demo.sh" --quiet 2>/dev/null || true
        exit 1
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
    (export AMP_OTEL_ENDPOINT AMP_AGENT_API_KEY DEMO_VERSION; cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" "$AMP_INSTRUMENT" "$UVICORN" service:app \
        --app-dir "$AGENT" --port "$PORT_AGENT" \
        > "$LOG_DIR/agent.log" 2>&1) &
else
    info "Agent command: cd $AGENT_DIR && PYTHONPATH=$AGENT_DIR DEMO_VERSION=$DEMO_VERSION $UVICORN service:app --app-dir $AGENT --port $PORT_AGENT"
    (export DEMO_VERSION; cd "$AGENT_DIR" && PYTHONPATH="$AGENT_DIR" "$UVICORN" service:app \
        --app-dir "$AGENT" --port "$PORT_AGENT" \
        > "$LOG_DIR/agent.log" 2>&1) &
fi
echo "agent:$!" >> "$PID_FILE"
check_launched "$!" "$AGENT" "$LOG_DIR/agent.log"

wait_for_http "http://localhost:$PORT_AGENT/openapi.json" "$AGENT"

# ── Start agencies-mcp-server ─────────────────────────────────────────────────
section "Starting agencies-mcp-server (port $PORT_MCP)"

(set +u; set -a; source "$MCP_ENV"; set +a; set -u; cd "$ROOT/agencies-mcp-server" && "$MCP_PY" server.py \
    > "$LOG_DIR/mcp.log" 2>&1) &
echo "mcp:$!" >> "$PID_FILE"

wait_for_port $PORT_MCP "agencies-mcp-server"

# ── Start savings-goals-agent ──────────────────────────────────────────────────
section "Starting savings-goals-agent (port $PORT_SAVINGS)"

if $USE_AMP; then
    # Own AMP_OTEL_ENDPOINT/AMP_AGENT_API_KEY — this agent has its own entry in Agent
    # Manager, separate from transactions-agent's. Export only these two (not the whole
    # .env) — same $-expansion-corrupts-secrets reasoning as the transactions-agent branch.
    _savings_amp_var() { grep -E "^$1=" "$SAVINGS_ENV" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"; }
    SAVINGS_AMP_OTEL_ENDPOINT=$(_savings_amp_var AMP_OTEL_ENDPOINT)
    SAVINGS_AMP_AGENT_API_KEY=$(_savings_amp_var AMP_AGENT_API_KEY)
    (export AMP_OTEL_ENDPOINT="$SAVINGS_AMP_OTEL_ENDPOINT" AMP_AGENT_API_KEY="$SAVINGS_AMP_AGENT_API_KEY"; \
        cd "$ROOT/savings-goals-agent" && "$SAVINGS_AMP_INSTRUMENT" "$SAVINGS_PY" server.py \
        > "$LOG_DIR/savings.log" 2>&1) &
else
    (set +u; set -a; source "$SAVINGS_ENV"; set +a; set -u; cd "$ROOT/savings-goals-agent" && "$SAVINGS_PY" server.py \
        > "$LOG_DIR/savings.log" 2>&1) &
fi
echo "savings:$!" >> "$PID_FILE"

wait_for_port $PORT_SAVINGS "savings-goals-agent"

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

info "Building frontend (vite preview serves dist/ — must be built first)..."
(cd "$ROOT/app" && npm run build > "$LOG_DIR/frontend-build.log" 2>&1) \
    || die "Frontend build failed — check $LOG_DIR/frontend-build.log"
ok "Frontend built"

(cd "$ROOT/app" && npm run preview \
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
echo -e "  ${BOLD}Savings Goals agent${NC} http://localhost:$PORT_SAVINGS"
echo -e "  ${BOLD}LLM${NC}                  $LLM_PROVIDER / $LLM_MODEL${LLM_VIA}"
echo -e "  ${BOLD}IDP environment${NC}      ${ENV_PROFILE:-existing}"
[[ "$AGENT" == "strands-agent" ]] && echo -e "  ${BOLD}AWS branding${NC}         enabled" || echo -e "  ${BOLD}AWS branding${NC}         disabled"
$USE_AMP && echo -e "  ${BOLD}AMP instrumentation${NC}  enabled" || true
echo -e "  ${BOLD}Demo version${NC}         $DEMO_VERSION"
echo ""
echo -e "  Logs:"
echo -e "    ${BLUE}$LOG_DIR/transactions-api.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/agent.log${NC}          ($AGENT_ARG)"
echo -e "    ${BLUE}$LOG_DIR/mcp.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/savings.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/server.log${NC}"
echo -e "    ${BLUE}$LOG_DIR/frontend.log${NC}"
echo -e "  To stop: ${BLUE}./demo_scripts/stop-demo.sh${NC}"
echo ""
