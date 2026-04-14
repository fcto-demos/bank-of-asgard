#!/usr/bin/env bash
# deploy-api.sh — Set up and (re)start the Bank of Asgard transactions-api user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$PROJECT_ROOT/transactions-api"
VENV_DIR="$API_DIR/.venv"
SERVICE_NAME="bank-of-asgard-api"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

echo "=== Bank of Asgard — Transactions API Deploy ==="

# ── 1. Python venv ────────────────────────────────────────────────────────────
echo ""
echo "[1/4] Setting up Python virtual environment..."
cd "$API_DIR"

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
if [ ! -f "$API_DIR/.env" ]; then
  echo "  ERROR: $API_DIR/.env not found."
  echo "  Copy and fill in the template:"
  echo "    cp $API_DIR/.env.example $API_DIR/.env"
  exit 1
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

loginctl enable-linger "$(whoami)" 2>/dev/null || true

echo ""
echo "=== Done ==="
echo "  Service : systemctl --user status ${SERVICE_NAME}"
echo "  Logs    : journalctl --user -u ${SERVICE_NAME} -f"
echo "  API URL : http://localhost:8010"
