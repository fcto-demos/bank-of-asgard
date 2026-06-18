#!/usr/bin/env bash
# validate.sh — Bank of Asgard pre-flight check
# Usage: ./scripts/validate.sh
# Exits 0 if all required checks pass, 1 if any errors are found.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Ports (edit here if you change a service port) ────────────────────────────
PORT_FRONTEND=5173
PORT_SERVER=3002
PORT_API=8010
PORT_AGENT=8011
PORT_MCP=8012

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

ERRORS=0
WARNINGS=0

pass()    { echo -e "  ${GREEN}✔${NC}  $1"; }
fail()    { echo -e "  ${RED}✗${NC}  $1"; ((ERRORS++))   || true; }
warn()    { echo -e "  ${YELLOW}⚠${NC}  $1"; ((WARNINGS++)) || true; }
section() { echo -e "\n${BOLD}${BLUE}▸ $1${NC}"; }

echo -e "\n${BOLD}Bank of Asgard — pre-flight validation${NC}"
echo    "────────────────────────────────────────"

# ── Runtime versions ──────────────────────────────────────────────────────────
section "Runtime versions"

NODE_VER=$(node --version 2>/dev/null || true)
NODE_MAJOR=$(echo "$NODE_VER" | grep -oE '[0-9]+' | head -1)
if [[ ${NODE_MAJOR:-0} -ge 20 ]]; then
    pass "Node $NODE_VER"
else
    fail "Node 20+ required — found ${NODE_VER:-not found}"
fi

if command -v pnpm &>/dev/null; then
    pass "pnpm $(pnpm --version)"
else
    warn "pnpm not found — install via: npm i -g pnpm"
fi

# ── Required config files ─────────────────────────────────────────────────────
section "Config files"

check_file() {
    local path="$1" label="$2" hint="$3"
    if [[ -f "$path" ]]; then
        pass "$label"
    else
        fail "$label not found — $hint"
    fi
}

check_file "$ROOT/llm_config.yaml"           "llm_config.yaml"           "already in repo root"
check_file "$ROOT/transactions-api/.env"     "transactions-api/.env"     "copy from transactions-api/.env.example"
check_file "$ROOT/transactions-agent/.env"   "transactions-agent/.env"   "copy from transactions-agent/.env.example"
check_file "$ROOT/app/public/config.js"      "app/public/config.js"      "copy from app/public/config.example.js"
check_file "$ROOT/server/.env"               "server/.env"               "copy from server/.env.example"
check_file "$ROOT/agencies-mcp-server/.env" "agencies-mcp-server/.env"  "copy from agencies-mcp-server/.env.example"

# ── Node dependencies ─────────────────────────────────────────────────────────
section "Node dependencies"

if [[ -d "$ROOT/app/node_modules" ]]; then
    pass "app/node_modules"
else
    warn "app/node_modules missing — run: cd app && pnpm install"
fi

if [[ -d "$ROOT/server/node_modules" ]]; then
    pass "server/node_modules"
else
    warn "server/node_modules missing — run: cd server && npm install"
fi

# ── Python virtual environments ───────────────────────────────────────────────
section "Python virtual environments"

check_venv() {
    local py="$1" label="$2" hint="$3"
    if [[ ! -f "$py" ]]; then
        warn "$label venv missing — $hint"
        return
    fi
    local ver
    ver=$("$py" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
    local major minor
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if [[ ${major:-0} -ge 3 && ${minor:-0} -ge 11 ]]; then
        pass "$label venv (Python $ver)"
    else
        fail "$label venv uses Python $ver — 3.11+ required. Recreate with: python3.11 -m venv $(dirname "$(dirname "$py")")"
    fi
}

check_venv "$ROOT/transactions-api/venv/bin/python" \
    "transactions-api" \
    "cd transactions-api && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt"

for agent in langchain-agent autogen-agent strands-agent; do
    check_venv "$ROOT/transactions-agent/$agent/venv/bin/python" \
        "transactions-agent/$agent" \
        "python3.11 -m venv transactions-agent/$agent/venv && transactions-agent/$agent/venv/bin/pip install -r transactions-agent/$agent/requirements.txt"
done

check_venv "$ROOT/agencies-mcp-server/venv/bin/python" \
    "agencies-mcp-server" \
    "cd agencies-mcp-server && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt"

# ── Service import dry-run ────────────────────────────────────────────────────
section "Service import check (dry run)"

AGENT_DIR="$ROOT/transactions-agent"

for agent in langchain-agent autogen-agent strands-agent; do
    py="$AGENT_DIR/$agent/venv/bin/python"
    if [[ ! -f "$py" ]]; then
        warn "$agent — skipped (no venv)"
        continue
    fi
    err=$(PYTHONPATH="$AGENT_DIR" "$py" - <<EOF 2>&1
import sys
sys.path.insert(0, '$AGENT_DIR/$agent')
import importlib.util
spec = importlib.util.spec_from_file_location('service', '$AGENT_DIR/$agent/service.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
EOF
    ) && pass "$agent imports OK" || fail "$agent import failed — $(echo "$err" | grep -v '^$' | tail -2 | tr '\n' ' ')"
done

TXAPI_PY="$ROOT/transactions-api/venv/bin/python"
if [[ -f "$TXAPI_PY" ]]; then
    err=$(cd "$ROOT/transactions-api" && "$TXAPI_PY" -c "from app.main import app" 2>&1) \
        && pass "transactions-api imports OK" \
        || fail "transactions-api import failed — $(echo "$err" | tail -1)"
else
    warn "transactions-api — skipped (no venv)"
fi

MCP_PY="$ROOT/agencies-mcp-server/venv/bin/python"
if [[ ! -f "$MCP_PY" ]]; then
    warn "agencies-mcp-server — skipped (no venv)"
elif [[ ! -f "$ROOT/agencies-mcp-server/.env" ]]; then
    warn "agencies-mcp-server — skipped (no .env)"
else
    err=$(cd "$ROOT/agencies-mcp-server" && "$MCP_PY" - <<'EOF' 2>&1
import importlib.util
spec = importlib.util.spec_from_file_location("server", "server.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
EOF
    ) && pass "agencies-mcp-server imports OK" \
      || fail "agencies-mcp-server import failed — $(echo "$err" | grep -v '^$' | tail -2 | tr '\n' ' ')"
fi

# ── Port availability ─────────────────────────────────────────────────────────
section "Port availability"

check_port() {
    local port="$1" service="$2"
    local in_use=false
    if command -v lsof &>/dev/null; then
        lsof -i ":$port" -sTCP:LISTEN -t &>/dev/null 2>&1 && in_use=true || true
    elif command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":$port " && in_use=true || true
    elif command -v netstat &>/dev/null; then
        netstat -tlnp 2>/dev/null | grep -q ":$port " && in_use=true || true
    else
        warn "Port $port ($service) — cannot check (lsof/ss/netstat not found)"
        return
    fi
    $in_use && fail "Port $port ($service) already in use" || pass "Port $port ($service) free"
}

check_port $PORT_FRONTEND "frontend"
check_port $PORT_SERVER   "server"
check_port $PORT_API      "transactions-api"
check_port $PORT_AGENT    "transactions-agent"
check_port $PORT_MCP      "agencies-mcp-server"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}${BOLD}$ERRORS error(s) found — fix them before starting.${NC}"
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo -e "${YELLOW}${BOLD}Ready with $WARNINGS warning(s).${NC}"
else
    echo -e "${GREEN}${BOLD}All checks passed — ready to start.${NC}"
fi
