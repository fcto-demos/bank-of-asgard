# DigitalOcean Load Balancer forwarding rules for Bank of Asgard
#
# Configure these two forwarding rules in:
#   DO Console → Networking → Load Balancers → Forwarding Rules
#
# ┌──────────────────────┬────────────────┬──────────────────────────────┐
# │ Entry point          │ Forwarding     │ Notes                        │
# ├──────────────────────┼────────────────┼──────────────────────────────┤
# │ HTTPS : 444          │ HTTP : 5173    │ Frontend (Vite preview)      │
# │ HTTPS : 445          │ HTTP : 8011    │ Agent (WebSocket / uvicorn)  │
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
#   app.apis.coach        A  →  <LB public IP>
#   boa-agent.apis.coach  A  →  <LB public IP>
#
# Resulting URLs after deploy:
#   Frontend : https://app.apis.coach:444
#   Agent WS : wss://boa-agent.apis.coach:445
