#!/usr/bin/env bash
# deploy-agent.sh — Set up and (re)start the Bank of Asgard transactions-agent user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGENT_DIR="$PROJECT_ROOT/transactions-agent"
VENV_DIR="$AGENT_DIR/.venv"
SERVICE_NAME="bank-of-asgard-agent"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

echo "=== Bank of Asgard — Transactions Agent Deploy ==="

# ── 1. Python venv ────────────────────────────────────────────────────────────
echo ""
echo "[1/4] Setting up Python virtual environment..."
cd "$AGENT_DIR"

if [ ! -d "$VENV_DIR" ]; then
  python3 -m venv "$VENV_DIR"
  echo "      Created venv at $VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "      Dependencies installed."

# ── 2. .env check ─────────────────────────────────────────────────────────────
echo ""
echo "[2/4] Checking .env file..."
if [ ! -f "$AGENT_DIR/.env" ]; then
  echo "  ERROR: $AGENT_DIR/.env not found."
  echo "  Copy and fill in the template:"
  echo "    cp $AGENT_DIR/.env.example $AGENT_DIR/.env"
  echo "  Make sure ASGARDEO_REDIRECT_URI=https://boa-agent.apis.coach:445/callback"
  exit 1
fi
if grep -q "localhost" "$AGENT_DIR/.env" 2>/dev/null; then
  echo ""
  echo "  WARNING: .env still contains 'localhost' references."
  echo "  Ensure ASGARDEO_REDIRECT_URI=https://boa-agent.apis.coach:445/callback"
  echo ""
fi
echo "      .env found."

# ── 3. Install service file ───────────────────────────────────────────────────
echo ""
echo "[3/4] Installing systemd user service..."
mkdir -p "$SYSTEMD_USER_DIR"
cp "$SERVICE_FILE" "$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"
systemctl --user daemon-reload
echo "      Service installed: ${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"

# ── 4. Enable & restart ───────────────────────────────────────────────────────
echo ""
echo "[4/4] Enabling and (re)starting service..."
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"
sleep 1
systemctl --user status "$SERVICE_NAME" --no-pager --lines=5

# Linger (in case not already set by deploy-app.sh)
loginctl enable-linger "$(whoami)" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "  Service   : systemctl --user status ${SERVICE_NAME}"
echo "  Logs      : journalctl --user -u ${SERVICE_NAME} -f"
echo "  Local WS  : ws://127.0.0.1:8011"
echo "  Public WS : wss://boa-agent.apis.coach  (via LB)"
