#!/usr/bin/env bash
# deploy-app.sh — Build and (re)start the Bank of Asgard frontend user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/app"
SERVICE_NAME="bank-of-asgard-app"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "=== Bank of Asgard — Frontend Deploy ==="

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "[1/4] Building app..."
cd "$APP_DIR"
npm install --prefer-offline
npm run build
echo "      Build complete → dist/"

# ── 2. Install service file ───────────────────────────────────────────────────
echo ""
echo "[2/4] Installing systemd service..."
sudo install -m 644 "$SERVICE_FILE" "$SYSTEMD_DIR/${SERVICE_NAME}.service"
sudo systemctl daemon-reload
echo "      Service installed: ${SYSTEMD_DIR}/${SERVICE_NAME}.service"

# ── 3. Enable & restart ───────────────────────────────────────────────────────
echo ""
echo "[3/4] Enabling and (re)starting service..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 1
sudo systemctl status "$SERVICE_NAME" --no-pager --lines=5

# ── 4. Verify service is running ──────────────────────────────────────────────
echo ""
echo "[4/4] Service running as boa user — no linger needed (system service)."

echo ""
echo "=== Done ==="
echo "  Service : sudo systemctl status ${SERVICE_NAME}"
echo "  Logs    : journalctl -u ${SERVICE_NAME} -f"
echo "  App URL : http://localhost:5173  (LB proxies → https://app.apis.coach)"
