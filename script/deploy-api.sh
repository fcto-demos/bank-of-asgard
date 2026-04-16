#!/usr/bin/env bash
# deploy-api.sh — Set up and (re)start the Bank of Asgard transactions-api user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$PROJECT_ROOT/transactions-api"
VENV_NAME="boa-api"
SERVICE_NAME="bank-of-asgard-api"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_DIR="/etc/systemd/user"

echo "=== Bank of Asgard — Transactions API Deploy ==="

# ── 1. Python virtualenv ──────────────────────────────────────────────────────
echo ""
echo "[1/4] Setting up Python virtual environment..."
cd "$API_DIR"

export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
eval "$(pyenv virtualenv-init -)"

pyenv virtualenv 3.11 "$VENV_NAME" 2>/dev/null || echo "      Virtualenv '$VENV_NAME' already exists."
pyenv local "$VENV_NAME"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
echo "      Dependencies installed in '$VENV_NAME'."

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
echo "[3/4] Installing systemd service..."
sudo install -m 644 "$SERVICE_FILE" "$SYSTEMD_DIR/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
echo "      Service installed: ${SYSTEMD_DIR}/${SERVICE_NAME}.service"

# ── 4. Enable & restart ───────────────────────────────────────────────────────
echo ""
echo "[4/4] Enabling and (re)starting service..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 1
sudo systemctl status "$SERVICE_NAME" --no-pager --lines=5

echo ""
echo "=== Done ==="
echo "  Service : sudo systemctl status ${SERVICE_NAME}"
echo "  Logs    : journalctl -u ${SERVICE_NAME} -f"
echo "  API URL : http://localhost:8010"
