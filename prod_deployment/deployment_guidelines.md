# Bank of Asgard — Deployment Guidelines

## DigitalOcean Load Balancer Forwarding Rules
#
# Configure these forwarding rules in:
#   DO Console → Networking → Load Balancers → Forwarding Rules
#
# ┌──────────────────────┬────────────────┬──────────────────────────────┐
# │ Entry point          │ Forwarding     │ Notes                        │
# ├──────────────────────┼────────────────┼──────────────────────────────┤
# │ HTTPS : 449          │ HTTP : 5173    │ Frontend (Vite preview)      │
# │ HTTPS : 450          │ HTTP : 8011    │ Agent (WebSocket / uvicorn)  │
# │ HTTPS : 451          │ HTTP : 3002    │ Node/Express server          │
# └──────────────────────┴────────────────┴──────────────────────────────┘
#
# Both rules must use protocol HTTP (not TCP) so the LB passes the
# WebSocket Upgrade header through to the backend.
#
# IMPORTANT — idle timeout for WebSocket connections:
#   Default is 60 s, which will kill live WS sessions mid-conversation.
#   Raise it to 3600 s in:
#   DO Console → Load Balancers → Settings → Advanced → Idle timeout
#
# DNS:
#   boa.apis.coach        A  →  <LB public IP>
#   boa-agent.apis.coach  A  →  <LB public IP>
#
# Resulting URLs after deploy:
#   Frontend : https://boa.apis.coach:449
#   Server   : https://boa.apis.coach:451
#   Agent WS : wss://boa-agent.apis.coach:450

## Frontend Build & Deploy (app/)

# Vite preview.allowedHosts must list every hostname the app is served under.
# Configured in app/vite.config.js:
#
#   preview: {
#     allowedHosts: ['boa.apis.coach', 'localhost'],
#   }
#
# Without this, Vite 6 rejects requests with "Invalid Host header" when
# accessed via a hostname (e.g. through the DO load balancer).
#
# Steps on the VM after any code change:
#   cd /home/boa/bank-of-asgard/app
#   npm run build
#   systemctl --user restart bank-of-asgard-app
