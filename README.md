<img src="./logo.png" width="400" alt="Bank of Asgard" />

# Requirements

## Tech stack

| Component | Runtime / Tool | Min version |
|-----------|---------------|-------------|
| React frontend | Node.js + npm | Node 20+ |
| Node/Express server | Node.js + npm | Node 20+ |
| Transactions API | Python + pip | Python 3.11+ |
| Transactions Agent | Python + pip | Python 3.11+ |
| Container-based deployment option | Docker or Podman | — |

> All Node dependencies are installed via `npm install` inside `app/` and `server/`.
> All Python dependencies are installed via `pip install -r requirements.txt` inside each service directory (or automatically by the deploy scripts).

## Identity provider

- Asgardeo (https://console.asgardeo.io) or WSO2 Identity Server 7.2+

  

# Default Ports

| Port   | Service                                | Change it in                                                 |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| `5173` | React frontend (Vite dev/preview)      | `app/vite.config.js` → `server.port` / `preview.port`        |
| `3002` | Node/Express backend server            | `server/.env` → `PORT`                                       |
| `8010` | Transactions API (FastAPI)             | `transactions-api/app/main.py` → uvicorn `--port`, `server/.env` → `TRANSACTIONS_API_URL`, `transactions-api/Dockerfile` → `EXPOSE` + `CMD --port`, `docker-compose.yml` → port mapping |
| `8011` | Transactions Agent WebSocket (FastAPI) | `script/bank-of-asgard-agent.service` → `--port`, `transactions-agent/.env` → `IDP_REDIRECT_URI` callback path, `transactions-agent/Dockerfile` → `EXPOSE` + `CMD --port`, `docker-compose.yml` → port mapping |

When changing a port, also update:

- `transactions-api/.env` → `CORS_ORIGINS` (must include the frontend origin)
- `app/public/config.js` → `API_BASE_URL` / `API_SERVICE_URL` (if changing port 3002) or `TRANSACTIONS_AGENT_URL` (if changing port 8011)
- Any redirect URIs registered in the identity provider console

# Configuration Instructions

## Custom Attributes

1. Create [custom attributes](https://wso2.com/asgardeo/docs/guides/users/attributes/manage-attributes/) named `accountType` and `businessName`. Add the businessName, accountType and country attributes to the profile scope (User Attributes and Store &rarr; User Attributes)
2. Create another [custom attribute](https://wso2.com/asgardeo/docs/guides/users/attributes/manage-attributes/) with the name `isFirstLogin`.
3. Enable the [Attribute Update Verification](https://wso2.com/asgardeo/docs/guides/users/attributes/user-attribute-change-verification/) for user email.

## FrontEnd Application

1. Create a SPA application.

  * Navigate to the "Shared Access" tab and share the application with all organizations.
  * Enable the `Code`, `Refresh Grant` and `Organization Switch` types. 
   > [!NOTE]	
   >
   > The organization switch grant type is available only after shared access is enabled.


1. Add authorized redirect URL: `http://localhost:5173` and allowed origin: `http://localhost:5173` (Adapt this to the port used by the app. 5173 is the defaut Vite port.)

2. Add the `mobile`, `country`, `email` and `accountType` to the **profile** scope ( `User Attributes & Stores` &rarr; `Attributes` &rarr; `OpenId Connect` &rarr; `Scopes` &rarr; `Profile` &rarr; `New Attribute`)

3. Enable the following scopes and attributes within the client application created.  
    * Profile: `Country, First Name, Last Name, Username, Birth Date, AccountType, Business Name, Email`
    * Email: `email`
    * Phone : `telephone`
    * Address:   `country`

4. Enable the following authenticators within the client application:

     * `Identifier First` - First Step
     * `Username and Password`, `Passkey` - Second Step
     * `TOTP` and `Email OTP` - Third Step
5. Configure the conditional authentication script (Replace the `<NODE_SERVER_BASE_PATH>` with server URL) with the one found at [conditional-auth-script.js](./scripts/conditional-auth-script.js).

> [!IMPORTANT]	
>
> If you are using Asgardeo or an identity server deployment on a VM for example, you must expose the server (running on localhost, port 3002) to the Internet. You can do this with something like **[ngrok](https://ngrok.com)** for example and use that URL as NODE_SERVER_BASE_PATH.

6. As part of the demo, you create, modify and delete users and roles. You therefore must enable API authorization access for the following API resources:

     - Organization APIs
       - Application Management API
         ```
         internal_org_application_mgt_update internal_org_application_mgt_delete internal_org_application_mgt_create internal_org_application_mgt_view
         ```
       - Identity Provider Management API
         ```
         internal_org_idp_view internal_org_idp_delete internal_org_idp_update internal_org_idp_create
         ```
       - SCIM2 Users API with the scopes:
         ```
         internal_org_user_mgt_update internal_org_user_mgt_delete internal_org_user_mgt_list internal_org_user_mgt_create 
         ```
       - SCIM2 Roles API with the scopes:
         ```
         internal_org_user_mgt_view internal_org_role_mgt_delete internal_org_role_mgt_create internal_org_role_mgt_update internal_org_role_mgt_view
         ```

## Server Application

1. Create a standard web application.
2. Navigate to the "Shared Access" tab and share the application with all organizations.
3. Enable the following grant types:
     `Code`, `Client Credentials`, `Organization Switch`

> [!NOTE]
>
> The organization switch grant type is available only after shared access is enabled.

4. Add the Authorized redirect URLs and allowed origins:
   redirect url: `https://localhost:3002`, allowed origin: `https://localhost:3002 http://localhost:5173`

5. Enable API Authorization access for the following API resources:

     - Management APIs
       - SCIM2 Users API with the scopes:
         ```
         internal_user_mgt_create internal_user_mgt_list internal_user_mgt_view internal_user_mgt_delete internal_user_mgt_update
         ```
       - Organization Management API with the scopes:
         ```
         internal_organization_create internal_organization_view internal_organization_update internal_organization_delete
         ```

     - Organization APIs
       - SCIM2 Users API with the scopes:
         ```
         internal_org_user_mgt_update internal_org_user_mgt_delete internal_org_user_mgt_list internal_org_user_mgt_create 
         ```
       - SCIM2 Roles API with the scopes:
         ```
         internal_org_user_mgt_view internal_org_role_mgt_delete internal_org_role_mgt_create internal_org_role_mgt_update internal_org_role_mgt_view
         ```


## Additional Setup

1. Navigate to the User Management &rarr; Roles tab and create an organization role named `Business Administrator` with the permissions for the SCIM2 Users and SCIM2 Roles organization APIs. Also, create organization roles `Manager`, `Auditor` and `Member`.

2. Navigate to Connections &rarr; Passkey Setup &rarr; Add the Trusted Origins: `http://localhost:5173` and enable `Allow Passkey usernameless authentication` option.

3. [Optional] Configure [Onfido identity verification](https://wso2.com/asgardeo/docs/guides/identity-verification/add-identity-verification-with-onfido/) for your organization - If you do not have access to Onfido, you won't be able to use the profile verification feature of the application.

4. Create a copy of `app/public/config.example.js` inside the `app/public/` folder. And name it as `config.js`. Update the [config values](docs/config-properties.md) accordingly.

## Starting Front and Backend Apps

1. Navigate to `App_home/app` and run `npm i`.

2. From within the `App_home/app` directory, execute `npm start` to run the application.

3. Create a copy of `server/.env.example` inside the `server/` folder. And name it as `.env`. Update the according to the commented instructions.

4. Navigate to `App_home/server` and run `npm i`.

5. From within the `App_home/server` directory, execute `nodemon server.js` to run the server.

---

## Transactions AI Agent — Setup

The project includes an AI-powered transaction assistant. See **[docs/transactions-agent-setup.md](docs/transactions-agent-setup.md)** for the full architecture, security pattern, and end-to-end test checklist. The summary below covers the required configuration steps.

### Asgardeo / WSO2 IS Configuration

Before running the agent services, complete the following in your identity provider console:

1. **Register the Transactions API resource** (Console → API Resources):

   - Name: `Transactions API`

   - Scopes: `read_transactions`, `admin_provision`

2. **Register the Agent identity** (Console → Agents → New Agent):

   - Name: `Transactions Agent`

   - Copy the generated **Agent ID** and **Agent Secret** — shown only once

3. Authorise the **server application** for provisioning (Console → Applications → server app → API Authorisation):

   - Add `Transactions API` with scope `admin_provision`

   - Ensure those scopes are present: `internal_role_mgt_view`, `internal_role_mgt_users_update`

4. Configure the existing **frontend SPA application** (the one using `APP_CLIENT_ID` in `config.js`)

   - **Add `read_transactions` scope** to the existing frontend SPA application (the one using `APP_CLIENT_ID` in `config.js`) so users can grant the agent access.


   - Add the agent redirect URI to the Authorized redirect URLs list: `http://localhost:8011/callback`


   - Add the agent endpoint to Allowed Origins list: `http://localhost:8011`


### Transactions API

Create a copy of `transactions-api/.env.example` inside `transactions-api/` and name it `.env`. Fill in:

```env
JWKS_URL=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/jwks or https://my.local_is.com/oauth2/jwks
JWT_ISSUER=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token or https://my.local_is.com/oauth2/token
JWKS_CACHE_TTL=3600

# CORS — comma-separated list of allowed origins
CORS_ORIGINS=http://localhost:5173,http://localhost:3002
```

### LLM Configuration

Edit `llm_config.yaml` at the repo root to select the LLM provider:
```yaml
# provider: openai | gemini | anthropic
provider: openai
# model: gpt-4o-mini   # uncomment to override the default
```
Default models: `openai → gpt-4o-mini`, `gemini → gemini-2.5-flash-lite`, `anthropic → claude-sonnet-4-5-20250929`.

**Optional — WSO2 API Gateway:** to route LLM calls via a gateway instead of a direct API key, enable the gateway option and set the required variables in the agent's `.env`:
```yaml
# llm_config.yaml
gateway:
  enabled: true
```
```env
# transactions-agent/.env
GATEWAY_BASE_URL=<GATEWAY_BASE_URL>
GATEWAY_TOKEN_ENDPOINT=<GATEWAY_TOKEN_ENDPOINT>
GATEWAY_CLIENT_ID=<GATEWAY_CLIENT_ID>
GATEWAY_CLIENT_SECRET=<GATEWAY_CLIENT_SECRET>
```
The agent fetches and automatically refreshes an OAuth2 client credentials token on every LLM request. No provider API key is needed when the gateway is enabled.

### Transactions Agent

1. Create a copy of `transactions-agent/.env.example` inside `transactions-agent/` and name it `.env`. Fill in:

```env
IDP_CLIENT_ID=<SPA_APP_CLIENT_ID>
IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>
IDP_REDIRECT_URI=http://localhost:8011/callback

AGENT_ID=<AGENT_ID>
AGENT_SECRET=<AGENT_SECRET>

TRANSACTIONS_API_BASE_URL=http://transactions-api:8010   # use container name when running via Docker/Podman

# Set the key matching the provider in llm_config.yaml (not needed when gateway is enabled)
OPENAI_API_KEY=<OPENAI_API_KEY>
# GEMINI_API_KEY=<GEMINI_API_KEY>
# ANTHROPIC_API_KEY=<ANTHROPIC_API_KEY>

# WSO2 Agent Manager — optional, only needed when running with instrumentation (see below)
# AMP_OTEL_ENDPOINT=http://host.containers.internal:22893/otel   # use this when running in a container
# AMP_OTEL_ENDPOINT=http://localhost:22893/otel                   # use this when running natively
# AMP_AGENT_API_KEY=<AMP_AGENT_API_KEY>
```

2. Add the agent WebSocket URL to `app/public/config.js`:

```js
TRANSACTIONS_AGENT_URL: "ws://localhost:8011"
```

### Running with Docker / Podman (recommended)

1. Copy `llm_config.yaml` to `~/podman_share/llm_config.yaml` on the host (this directory is mounted by default when you create the Podman machine) - The compose file mounts this path into the agent container so the config file is kept outside the image and never rebuilt on change.

```bash
mkdir -p ~/podman_share
cp llm_config.yaml ~/podman_share/llm_config.yaml
```

2. Start both services from the repo root

```bash
# Without Agent Manager instrumentation (default)
podman compose up --build -d

# With WSO2 Agent Manager instrumentation
podman compose -f docker-compose.yml -f docker-compose.amp.yml up --build -d
```

3. View logs

```bash
podman compose logs -f transactions-api
podman compose logs -f transactions-agent
```

4. Stop

```bash
podman compose down
```

### Running Natively (development)

1. From within the `transactions-api/` directory:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

2. From within the `transactions-agent/` directory:

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Without Agent Manager instrumentation (default)
uvicorn app.service:app --reload --port 8011

# With WSO2 Agent Manager instrumentation
amp-instrument uvicorn app.service:app --reload --port 8011
```
