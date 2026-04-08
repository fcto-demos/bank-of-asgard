# Transactions AI Agent — Setup Guide

This document describes the architecture, setup, and configuration for the Transactions AI Agent added to the Bank of Asgard project. It follows the same secure agent pattern as the [Gardeo Hotels](https://github.com/wso2/iam-ai-samples/tree/main/hotel-booking-agent-autogen-agent-iam) reference implementation.

---

## Overview

Three components were added to the project:

| Component | Port | Language | Purpose |
|---|---|---|---|
| `transactions-api` | 8010 | Python / FastAPI | Stores and serves transaction data; validates OBO JWTs |
| `transactions-agent` | 8011 | Python / FastAPI + AutoGen | AI agent via WebSocket; triggers OBO consent flow |
| `app` (modified) | 5173 | React / JSX | `/transactions` page with chat UI and consent popup |

---

## Architecture

```
Browser (React)
    │  WebSocket ws://localhost:8011/chat?session_id=<uuid>
    ▼
transactions-agent (port 8011)
    │  GET /transactions  Bearer <OBO token>
    ▼
transactions-api (port 8010)
    │  Validates JWT via Asgardeo JWKS endpoint
    │  Returns transactions for token_data.sub (user identity from OBO token)
    ▼
In-memory store (keyed by user sub)
```

### Security Pattern — On-Behalf-Of (OBO) Token Flow

The agent uses the same `SecureFunctionTool` pattern from the Gardeo Hotels project:

1. User sends a message (e.g. *"Show me my recent transactions"*)
2. The AutoGen agent calls the `GetMyTransactions` tool
3. `SecureFunctionTool` intercepts — the `token` parameter is **never shown to the LLM**
4. No cached OBO token exists → agent sends an `auth_request` WebSocket message to the frontend
5. Frontend displays an "Authorise Access" button with the required scopes
6. User clicks → OAuth popup opens at Asgardeo (`/authorize` with PKCE)
7. User consents → Asgardeo redirects to `http://localhost:8011/callback?code=X&state=Y`
8. Agent exchanges the auth code + agent credentials for an OBO token (`sub=user, act.sub=agent`)
9. OBO token is injected into the tool call → `GET /transactions` is called with `Bearer <obo_token>`
10. Backend validates the JWT, checks the `read_transactions` scope, returns `token_data.sub`'s transactions
11. Token is cached (TTL 1 hour) — subsequent requests in the session skip the consent step

```
Token structure (OBO):
  sub  = <user's Asgardeo ID>        ← who the data belongs to
  act.sub = <agent's client ID>      ← who is acting on their behalf
  scope = "read_transactions"
```

---

## Asgardeo Configuration

The following must be configured in your Asgardeo organisation **before** running the services.

The full setup requires **four IS entries**:

| # | What | Kind | Credentials used in |
|---|---|---|---|
| 1 | **Frontend SPA** | Application | `APP_CLIENT_ID` in `app/public/config.js` |
| 2 | **Server TWA** | Application | `SERVER_APP_CLIENT_ID` / `SERVER_APP_CLIENT_SECRET` in `server/.env` |
| 3 | **Agent identity** | Agent — an IS principal, similar to a user | `AGENT_ID` / `AGENT_SECRET` in `transactions-agent/.env` |
| 4 | **Agent application** | Application — public client, token exchange grant | `IDP_CLIENT_ID` in `transactions-agent/.env` |

Entries 1 and 2 are registered as part of the main [README setup](../README.md#identity-provider-setup). The steps below add entries 3 and 4 and extend permissions on the existing two.

### 1. Register the Transactions API Resource

In the Asgardeo Console → **API Resources**:

- Name: `Transactions API`
- Identifier: `transactions_api` (or any URI)
- Scopes:
  - `read_transactions` — allows reading a user's transaction history
  - `admin_provision` — allows seeding demo data (admin use only)

### 2. Register the Agent Identity

WSO2 Identity Server supports **Agentic Identity** — agents are first-class principals with their own identity, credentials, and role assignments, separate from application registrations.

> **Important:** Agent identities support the OBO token exchange flow. They do **not** support the `client_credentials` grant directly. Provisioning (a one-time admin task) must use a standard application — see step 3.

In the IS Console → **Agents** → **+ New Agent**:

- **Name**: `Transactions Agent` (human-readable display name)
- **Description** (optional): e.g. `AI agent that reads transaction data on behalf of users`
- Click **Register** — the console will display the agent's **Agent ID** and **Agent Secret** once. Copy both immediately.
  - These become `AGENT_ID` and `AGENT_SECRET` in the environment variables.

### 3. Authorise the Server Application for Provisioning and Role Assignment

The server application (`SERVER_APP_CLIENT_ID`) needs two sets of permissions:

**Transactions API scopes** — In the IS Console → **Applications** → select the server app → **API Authorisation** tab:

- Add the `Transactions API` resource and authorise the `admin_provision` scope

This allows the server to automatically seed demo transactions for every new user at signup.

**Internal IS scopes** for automated role assignment — in the same **API Authorisation** tab, also authorise:

- `internal_role_mgt_view` — allows the server to look up the `Read_Transactions` role ID by name
- `internal_role_mgt_users_update` — allows the server to add users to that role

These scopes must also be added to the `scope` parameter in the server's client credentials token request (`server/middleware/auth.js`).

### 4. Configure On-Behalf-Of (OBO) Exchange

Allow the agent to exchange a user authorisation code for an OBO token:

- The agent identity must be permitted to perform the OBO exchange for `read_transactions`
- Set the **redirect URI** on the agent: `http://localhost:8011/callback`

### 5. Existing Frontend Application

The existing `APP_CLIENT_ID` used by the React app must have `read_transactions` added to its allowed scopes so users can grant the agent access via the PKCE flow.

---

## Environment Variables

### `transactions-api/.env`

Copy from `.env.example` and fill in:

```env
JWKS_URL=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/jwks
JWT_ISSUER=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token
JWKS_CACHE_TTL=3600
CORS_ORIGINS=http://localhost:5173,http://localhost:3002
```

### `transactions-agent/.env`

Copy from `.env.example` and fill in:

```env
# Frontend app registered in Asgardeo (used for the PKCE authorisation code flow)
IDP_CLIENT_ID=<IDP_CLIENT_ID>
IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>
IDP_REDIRECT_URI=http://localhost:8011/callback

# Agent's own Asgardeo application (client credentials grant)
AGENT_ID=<AGENT_CLIENT_ID>
AGENT_SECRET=<AGENT_CLIENT_SECRET>

# Transactions API
TRANSACTIONS_API_BASE_URL=http://localhost:8010

# LLM — provide the key matching the provider in llm_config.yaml
# Not required when gateway.enabled: true in llm_config.yaml
OPENAI_API_KEY=<OPENAI_API_KEY>
# GEMINI_API_KEY=<GEMINI_API_KEY>
# ANTHROPIC_API_KEY=<ANTHROPIC_API_KEY>

# WSO2 API Gateway (only when gateway.enabled: true in llm_config.yaml)
# GATEWAY_BASE_URL=<GATEWAY_BASE_URL>
# GATEWAY_TOKEN_ENDPOINT=<GATEWAY_TOKEN_ENDPOINT>
# GATEWAY_CLIENT_ID=<GATEWAY_CLIENT_ID>
# GATEWAY_CLIENT_SECRET=<GATEWAY_CLIENT_SECRET>
```

### `app/public/config.js`

Add the agent WebSocket URL:

```js
TRANSACTIONS_AGENT_URL: "ws://localhost:8011"
```

---

## Running the Services

### Docker / Podman (recommended)

The `docker-compose.yml` at the repo root orchestrates both services on a shared `bank-network`.

**Important:** `llm_config.yaml` is mounted into the agent container from `~/podman_share/llm_config.yaml` on the host (`:ro,z` — read-only, SELinux relabelled for Podman compatibility). This keeps the config outside the image so you can change the LLM provider or gateway settings without rebuilding.

```bash
# 1. Place llm_config.yaml where the compose file expects it
mkdir -p ~/podman_share
cp llm_config.yaml ~/podman_share/llm_config.yaml

# 2. Build and start both services (from the repo root)
docker compose up --build -d
# or with Podman:
podman-compose up --build -d

# View logs
docker compose logs -f transactions-api
docker compose logs -f transactions-agent

# Stop
docker compose down
```

> **Note:** When running via Docker/Podman, set `TRANSACTIONS_API_BASE_URL=http://transactions-api:8010` in `transactions-agent/.env` so the agent reaches the API container by its service name on the shared network. Use `http://localhost:8010` for native development instead.

### Natively (development)

**Transactions API:**
```bash
cd transactions-api
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=$(pwd)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8010
```

**Transactions Agent:**
```bash
cd transactions-agent
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=$(pwd)
uvicorn app.service:app --reload --host 0.0.0.0 --port 8011
```

**Frontend:**
```bash
cd app
npm install
npm run dev
```

---

## Provisioning Demo Data

The `transactions-api` uses an in-memory store. Data must be provisioned for each user before they can use the agent.

### Automatic Provisioning at Signup

As of the latest server changes, **provisioning happens automatically** when a new user registers. The `/signup` endpoint in `server/server.js` performs two steps asynchronously after the user is created:

1. **Role assignment** — looks up the `Read_Transactions` role by name and assigns it to the new user. This grants access to the `/transactions` page and enables the OBO scope consent flow.
2. **Transaction seeding** — calls `POST http://localhost:8010/admin/provision` with the new user's SCIM `id` as `user_sub`, generating 40 demo transactions over the last 90 days.

Both steps are fire-and-forget: failures are logged as warnings (`POST /signup: failed to assign Read_Transactions role` / `POST /signup: failed to provision transactions`) but do not affect the signup response. The `TRANSACTIONS_API_URL` server environment variable controls the provisioning endpoint (`http://localhost:8010` by default).

The same logic runs for the `/business-signup` endpoint (via the same `createUser` path).

> **Note:** Since the `transactions-api` uses an in-memory store, provisioned data is lost on service restart. Use the manual endpoint below to re-seed data for existing users after a restart.

### Manual Provisioning (re-seeding or existing users)

First, obtain a client credentials token using the **server application** credentials (not the agent — agents do not support the `client_credentials` grant).

Replace `<TOKEN_ENDPOINT>` with your identity provider's token endpoint:
- **Asgardeo cloud:** `https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token`
- **WSO2 Identity Server (custom domain):** `https://<YOUR_IS_HOST>/oauth2/token`

```bash
curl -X POST <TOKEN_ENDPOINT> \
  -u "<SERVER_APP_CLIENT_ID>:<SERVER_APP_CLIENT_SECRET>" \
  -d "grant_type=client_credentials&scope=admin_provision"
```

Then provision transactions for a user (you need their Asgardeo `sub` claim):

```bash
curl -X POST http://localhost:8010/admin/provision \
  -H "Authorization: Bearer <AGENT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_sub": "<USER_ASGARDEO_SUB>",
    "num_transactions": 40,
    "days_back": 90
  }'
```

### Finding a User's Sub Claim

Decode any access token issued for that user (e.g. the token from the React frontend's `getAccessToken()`). The `sub` field in the JWT payload is the Asgardeo user ID.

### Demo Data Characteristics

The generator creates deterministic data seeded by `hash(user_sub)` — the same user always gets the same transactions. Each provisioning call generates:

- Monthly salary credit (~$3,800–$4,800) on the 1st of each month
- Regular grocery debits ($35–$180) twice weekly
- Dining, transport, shopping, utilities, entertainment, and health debits
- ~40 transactions spread across the last 90 days by default

---

## LLM Provider Configuration

Edit `llm_config.yaml` at the repo root to switch providers:

```yaml
# provider: openai | gemini | anthropic
provider: openai
# model: gpt-4o-mini   # uncomment to override the default
```

Default models per provider:

| Provider | Default model |
|---|---|
| openai | gpt-4o-mini |
| gemini | gemini-2.5-flash-lite |
| anthropic | claude-sonnet-4-5-20250929 |

### WSO2 API Gateway (optional)

LLM calls can be routed through a WSO2 API Gateway instead of using a direct provider API key. The agent authenticates to the gateway using the OAuth2 client credentials grant and automatically refreshes the access token before it expires.

**1. Enable in `llm_config.yaml`:**

```yaml
provider: anthropic   # controls the default model name

gateway:
  enabled: true
```

**2. Set gateway credentials in `transactions-agent/.env`:**

```env
GATEWAY_BASE_URL=<GATEWAY_BASE_URL>
GATEWAY_TOKEN_ENDPOINT=<GATEWAY_TOKEN_ENDPOINT>
GATEWAY_CLIENT_ID=<GATEWAY_CLIENT_ID>
GATEWAY_CLIENT_SECRET=<GATEWAY_CLIENT_SECRET>
```

| Variable | Description |
|---|---|
| `GATEWAY_BASE_URL` | Base URL exposed by the gateway for LLM calls (e.g. `https://gateway.example.com/llm/1.0.0`) |
| `GATEWAY_TOKEN_ENDPOINT` | OAuth2 token endpoint (e.g. `https://gateway.example.com/oauth2/token`) |
| `GATEWAY_CLIENT_ID` | Client ID for the gateway OAuth2 application |
| `GATEWAY_CLIENT_SECRET` | Client secret for the gateway OAuth2 application |

When `gateway.enabled: true`, no provider API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) is required. The `provider` field in `llm_config.yaml` still controls the default model name used in the request.

**Token refresh behaviour:**
- The token is cached in memory inside `GatewayTokenManager`
- It is refreshed automatically 30 seconds before the `expires_in` time from the token response
- An `asyncio.Lock` prevents concurrent refresh storms under high load
- If the token endpoint is unreachable, the error propagates as an agent-level exception

To fall back to direct provider mode, set `gateway.enabled: false` (or remove the block) and set the appropriate provider API key in `.env`.

---

## File Structure

```
bank-of-asgard/
├── docker-compose.yml               # Orchestrates both Python services
├── llm_config.yaml                  # LLM provider selection
│
├── transactions-api/                # FastAPI — transaction data service
│   ├── app/
│   │   ├── main.py                  # Routes: GET /transactions, POST /admin/provision
│   │   ├── dependencies.py          # JWKS-based JWT validation + scope enforcement
│   │   ├── schemas.py               # Pydantic models (Transaction, ProvisionRequest, etc.)
│   │   └── data.py                  # In-memory store + sample data generator
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── transactions-agent/              # FastAPI + AutoGen — AI agent service
│   ├── auth/                        # OAuth plumbing (copied from gardeo-hotels)
│   │   ├── auth_manager.py          # AutogenAuthManager: OBO + agent token flows
│   │   ├── auth_schema.py           # Validates manager has message_handler for OBO
│   │   ├── models.py                # OAuthTokenType, AuthConfig, AuthRequestMessage
│   │   └── token_manager.py         # TTLCache-based per-session token storage
│   ├── autogen/
│   │   └── tool.py                  # SecureFunctionTool: strips token from LLM view
│   ├── app/
│   │   ├── service.py               # WebSocket /chat + /callback endpoints
│   │   ├── tools.py                 # get_my_transactions (OBO-protected)
│   │   └── prompt.py                # Banking-focused system prompt
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
│
├── server/                          # Node.js / Express backend (modified)
│   ├── server.js                    # MODIFIED — auto role assignment + provisioning on signup
│   ├── config.js                    # MODIFIED — added TRANSACTIONS_API_URL env variable
│   ├── middleware/
│   │   └── auth.js                  # MODIFIED — added internal_role_mgt_view + internal_role_mgt_users_update + admin_provision scopes
│   └── controllers/
│       └── business.js              # MODIFIED — added getRoleIdByName, addUserToRole
│
└── app/                             # React frontend (modified)
    └── src/
        ├── pages/
        │   └── transactions.jsx     # NEW — /transactions page (chat + info panel)
        ├── components/
        │   ├── transactions/
        │   │   └── ChatComponent.jsx # NEW — WebSocket chat + OBO consent popup
        │   └── user-profile/
        │       ├── view-profile.jsx  # MODIFIED — Close Account moved to bottom-right
        │       └── view/
        │           └── bank-account-card.jsx # MODIFIED — Transaction Assistant button added
        ├── constants/
        │   └── app-constants.jsx    # MODIFIED — added TRANSACTIONS route
        └── util/
            └── environment-util.js  # MODIFIED — added TRANSACTIONS_AGENT_URL
```

---

## End-to-End Test Checklist

1. Register a new user via the signup form
2. Check server logs — confirm both messages appear:
   - `POST /signup: user assigned to Read_Transactions role`
   - `POST /signup: transactions provisioned`
3. Log in as that user and navigate to the user profile — verify the **"Open Transaction Assistant"** button appears inside the Bank Account card
4. Click **"Open Transaction Assistant"** — verify `/transactions` loads
5. The chat shows "Welcome to Bank of Asgard! I'm your Transaction Assistant..."
6. Type: *"Show me my recent transactions"*
7. Verify an **"Authorise Access"** panel appears in the chat with the `read_transactions` scope chip
8. Click **"Authorise Access"** — an Asgardeo popup opens
9. Complete login in the popup — popup closes automatically
10. Chat shows: *"Authorisation complete! Fetching your transactions now..."*
11. Agent responds with a formatted list of transactions (not raw JSON)
12. Ask: *"How much did I spend on dining?"* — agent summarises without triggering auth again (token cached)

---

## Security Properties

| Property | Mechanism |
|---|---|
| Token never visible to LLM | `SecureFunctionTool` strips `token: OAuthToken` from function schema before passing to AutoGen |
| Per-session isolation | Each WebSocket gets its own `AutogenAuthManager` + `TokenManager` — no cross-user token leakage |
| Replay protection | `_pending_auths.pop(state)` atomically removes entry; duplicate callbacks are rejected |
| Authorization timeout | `asyncio.wait_for(future, timeout=300s)` — agent does not hang if user closes the popup |
| Scope enforcement (API) | Backend independently validates JWT scopes on every request |
| OBO audit trail | JWT `act` claim identifies the agent separately from the user (`sub`) |
| Eager validation | `AuthSchema.__init__` raises at startup if OBO is configured without a `message_handler` |
