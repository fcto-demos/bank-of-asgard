#!/usr/bin/env bash
# deploy-app.sh — Build and (re)start the Bank of Asgard frontend user service
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/app"
SERVICE_NAME="bank-of-asgard-app"
SERVICE_FILE="$SCRIPT_DIR/${SERVICE_NAME}.service"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"

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
echo "[2/4] Installing systemd user service..."
mkdir -p "$SYSTEMD_USER_DIR"
cp "$SERVICE_FILE" "$SYSTEMD_USER_DIR/${SERVICE_NAME}.service"
systemctl --user daemon-reload
echo "      Service installed: ${SYSTEMD_USER_DIR}/${SERVICE_NAME}.service"

# ── 3. Enable & restart ───────────────────────────────────────────────────────
echo ""
echo "[3/4] Enabling and (re)starting service..."
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"
sleep 1
systemctl --user status "$SERVICE_NAME" --no-pager --lines=5

# ── 4. Enable linger (auto-start at boot without login) ───────────────────────
echo ""
echo "[4/4] Ensuring linger is enabled (start at boot)..."
loginctl enable-linger "$(whoami)"
echo "      Linger enabled for $(whoami)"

echo ""
echo "=== Done ==="
echo "  Service : systemctl --user status ${SERVICE_NAME}"
echo "  Logs    : journalctl --user -u ${SERVICE_NAME} -f"
echo "  App URL : http://localhost:5173  (LB proxies → https://app.apis.coach)"
