#!/usr/bin/env bash
# deploy-all.sh — Deploy all four Bank of Asgard services in dependency order:
#   1. transactions-api   (port 8010 — data layer, no external deps)
#   2. server             (port 3002 — depends on transactions-api)
#   3. transactions-agent (port 8011 — depends on transactions-api)
#   4. app                (port 5173 — frontend, depends on server + agent)
#
# Run this for a full first-time deploy or to redeploy everything after a git pull.
# To redeploy a single service, run its individual script directly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════════╗"
echo "║      Bank of Asgard — Full Deploy                ║"
echo "╚══════════════════════════════════════════════════╝"

echo ""
echo "▶ [1/4] Transactions API"
bash "$SCRIPT_DIR/deploy-api.sh"

echo ""
echo "▶ [2/4] Node/Express Server"
bash "$SCRIPT_DIR/deploy-server.sh"

echo ""
echo "▶ [3/4] Transactions Agent"
bash "$SCRIPT_DIR/deploy-agent.sh"

echo ""
echo "▶ [4/4] Frontend App"
bash "$SCRIPT_DIR/deploy-app.sh"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      All services deployed                       ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Status:"
echo "    systemctl --user status bank-of-asgard-api"
echo "    systemctl --user status bank-of-asgard-server"
echo "    systemctl --user status bank-of-asgard-agent"
echo "    systemctl --user status bank-of-asgard-app"
echo ""
echo "  Logs (live):"
echo "    journalctl --user -u bank-of-asgard-api    -f"
echo "    journalctl --user -u bank-of-asgard-server -f"
echo "    journalctl --user -u bank-of-asgard-agent  -f"
echo "    journalctl --user -u bank-of-asgard-app    -f"
