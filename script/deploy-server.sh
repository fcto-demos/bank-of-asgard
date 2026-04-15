#!/usr/bin/env bash
# deploy-server.sh — Set up and (re)start the Bank of Asgard Node/Express server user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"
SERVICE_NAME="bank-of-asgard-server"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "=== Bank of Asgard — Node Server Deploy ==="

# ── 1. npm install ────────────────────────────────────────────────────────────
echo ""
echo "[1/4] Installing Node dependencies..."
cd "$SERVER_DIR"
npm install --prefer-offline
echo "      Dependencies installed."

# ── 2. .env check ─────────────────────────────────────────────────────────────
echo ""
echo "[2/4] Checking .env file..."
if [ ! -f "$SERVER_DIR/.env" ]; then
  echo "  ERROR: $SERVER_DIR/.env not found."
  echo "  Copy and fill in the template:"
  echo "    cp $SERVER_DIR/.env.example $SERVER_DIR/.env"
  exit 1
fi
if grep -q "localhost:8010\|transactions-api:8010" "$SERVER_DIR/.env" 2>/dev/null; then
  # Remind if still using Docker container name
  if grep -q "transactions-api:8010" "$SERVER_DIR/.env" 2>/dev/null; then
    echo ""
    echo "  WARNING: TRANSACTIONS_API_URL uses the Docker container name."
    echo "  For native deployment set: TRANSACTIONS_API_URL=http://localhost:8010"
    echo ""
  fi
fi
echo "      .env found."

# ── 3. Install service file ───────────────────────────────────────────────────
echo ""
echo "[3/4] Installing systemd service..."
cp "$SERVICE_FILE" "$SYSTEMD_DIR/${SERVICE_NAME}.service"
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
echo "  Service    : sudo systemctl status ${SERVICE_NAME}"
echo "  Logs       : journalctl -u ${SERVICE_NAME} -f"
echo "  Server URL : http://localhost:3002"
