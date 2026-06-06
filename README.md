<img src="./logo.png" width="400" alt="Bank of Asgard" />

# Foreword

This demo is an extension/rework of the original Bank of Asgard demo which was built to demonstrate IS CIAM capabilities. The instructions configure the demo only for the putpose of showing WSO2 Agentic platform capabilities. If you are looking CIAM capabilities, get the original version. Identity server setup, in particular, is quite different. 

Using this demo, you can experience:

- AI Guardrails
- Agentic identity and OBO flows 
- Agent Management

# Requirements

## WSO2 Products

The following products are used in the context of this demo

- WSO2 Identity Server (on-prem or SaaS) for Agentic Identity , MCP identity and access management.
- WSO2 AI Gateway (4.6 or 4.7 versions) for LLM governance and AI guardrails
- WSO2 Agent Manager Beta for Agent observability and governance
- WSO2 Moesif for APIs Analytics

## Tech stack

| Component | Runtime / Tool | Min version |
|-----------|---------------|-------------|
| React frontend | Node.js + npm | Node 20+ |
| Node/Express server | Node.js + npm | Node 20+ |
| Transactions API | Python + pip | Python 3.11+ |
| Transactions Agent | Python + pip | Python 3.11+ |
| Agencies MCP Server | Python + pip | Python 3.11+ |
| Container-based deployment *(optional)* | Docker or Podman | — |

> All Node dependencies are installed via `npm install` inside `app/` and `server/`.
> All Python dependencies are installed via `pip install -r requirements.txt` inside each service directory

## Identity provider

The following instructions have been tested on June 2026 on Asgardeo (https://console.asgardeo.io) and WSO2 Identity Server **7.2**.

# Identity Provider Setup

The full setup requires:

1. The creation of 4 applications (Frontend / Backend / Agent / MCP Client)
2. The registration of the agent identity (credentials)
3. The creation of custom attributes and addition of these attributes to the OpenID connect profiles.

Following table summarizes the apps plus credentials setup, and where this information is configured in the various environment files.

| #    | What                       | Kind                                              | Default AppName | ClientIDs /Client Secrets / Credentials used in              |
| ---- | -------------------------- | ------------------------------------------------- | --------------- | ------------------------------------------------------------ |
| 1    | **Frontend SPA**           | Application                                       | BOA-Frontend    | `APP_CLIENT_ID` in `app/public/config.js`                    |
| 2    | **Server SWA**             | Application                                       | BOA-Backend     | `SERVER_APP_CLIENT_ID` / `SERVER_APP_CLIENT_SECRET` in `server/.env` |
| 3    | **Agent identity**         | Agent — an IS principal, similar to a user        |                 | `AGENT_ID` / `AGENT_SECRET` in `transactions-agent/.env`     |
| 4    | **Agent TWA application**  | Application — public client, token exchange grant | BOA-Agent       | `AGENT_APP_ID` in `transactions-agent/.env`                  |
| 5    | **MCP Client application** | Application — MCP client                          | BOA-Agencies    | `MCP_CLIENT_ID` in `transactions-agent/.env`; `EXPECTED_AUDIENCE` in `agencies-mcp-server/.env` |

## Custom User Attributes

1. Create [custom attributes](https://wso2.com/asgardeo/docs/guides/users/attributes/manage-attributes/) named `accountType` ,  `businessName`, `isFirstLogin`

   | Attribute Name / Display Name | Type    | Values              | Input Format | Display                    |
   | ----------------------------- | ------- | ------------------- | ------------ | -------------------------- |
   | accountType                   | OPTIONS | Business / Personal | DropDown     | Admin Console/User Profile |
   | isFirstLogin                  | BOOLEAN | N/A                 | CheckBox     | Admin Console              |
   | businessName                  | TEXT    |                     | Text input   | Admin Console/User Profile |

2. Add those attributes to the Profile OIDC scope (from User Attributes and Store &rarr; User Attributes&rarr;OpenIDConnect &rarr;scopes)

3. Enable the [Attribute Update Verification](https://wso2.com/asgardeo/docs/guides/users/attributes/user-attribute-change-verification/) for user email.

## Agent Identity

The agent gets its own IS principal (like a user account)

- Name: `Transactions Agent`
- Copy the generated **Agent ID** and **Agent Secret** (the secret is shown only once). These become `AGENT_ID` and `AGENT_SECRET`.

## Resources

Resources include APIs and MCPs.

1. **Register the Transactions API resource** (Console → Resources → API Resources)

   - Identifier: `http://boa-transaction-api` 
   - Name: `Transactions API`

   - Scopes: `read_transactions`, `admin_provision`
   - Select "Requires Authorization"

2. **Register the Agencies MCP Server ** (Console → Resources → MCP Servers)

   - Identifier: `http://boa-agencies-mcp` 	
   - Name: `Agencies MCP Server`
   - No scopes are required

## Roles

We need to create a role, which is assigned automatically to new personal banking users. The role is called **Read_Transactions** and has access to read_transactions scope - This name is the default one used in the code, but can be overriden in the .env file of the backend application if necessary.

- Create the role as an <u>organization</u> role

- On Permissions, select the Transactions API and select the read_transactions scope.

## Additional IS Configuration

Navigate to Connections &rarr; Passkey &rarr; Set Up &rarr; Add the Trusted Origins: `http://localhost:5173` and enable `Allow Passkey usernameless authentication` option.

# Applications

## FrontEnd

1. Create a Single Page Application (SPA), call it **BOA-FrontEnd**

2. Set the redirect URL to`http://localhost:5173` (adapt this to the port used by the app. 5173 is the default Vite port)

3. Select "Allow Sharing with organizations" and "Allow AI agents to use this application"
     * Confirm to share will all organizations (this is used when creating business accounts, which behind the scenes created sub-orgs per business)

4. On the protocol tab, ensure the `Code`, `Refresh Grant` and `Organization Switch` grant types are selected

5. On the User Attributes tab, enable the following scopes and attributes.  

   1. Profile: `Country, First Name, Last Name, Username, Birth Date, AccountType, Business Name, Email`

   * Email: `email`

   * Phone : `telephone`

   * Address:   `country`

6. On the Login Flow tab, enable the following authenticators:

   * `Identifier First` - First Step

   * `Username and Password`, `Passkey` - Second Step

Note the **Client ID**, you will use it to set `APP_CLIENT_ID` in `app/public/config.js`

## Backend

1. Create a standard web application, call it **BOA-Backend**.
     * Select OAuth2 as the protocol
     * Select "Allow Sharing with organizations" and "Allow AI agents to use this application"

2. On the protocol tab, select the `Code`, `Client Credentials` and `Organization Switch` grant types

3. Set the redirect URL to`https://localhost:3002` (adapt this to the port if you changed it)

4. Add the following allowed origins:`https://localhost:3002` and `http://localhost:5173`

5. Enable API Authorization access for the following API resources:

     - Transaction API with scopes: `read_transactions`and  `admin_provision`

6. As part of the demo, you create, modify and delete users and roles. You therefore must enable API authorization access for the following API resources:

     1. **Management APIs**

        - SCIM2 Users API with the scopes
      		
          ```
          internal_user_mgt_create internal_user_mgt_delete internal_user_mgt_list internal_user_mgt_update internal_user_mgt_view
          ```
        
		- SCIM2 Roles API with the scopes:
        ```
        internal_role_mgt_users_update internal_role_mgt_view 
        ```

     > [!NOTE]
     >
     > In the latest versions of IS / Asgardeo, some scopes will be added automatically as you add 			those above.

     Note the clientID and clientSecret - You will use them to set `SERVER_APP_CLIENT_ID` / `SERVER_APP_CLIENT_SECRET` in `server/.env`.

## Agent

1. Create a traditional web application, call it **BOA-Agent**.
2. Once the app is created, enable the **Code** and  **Token Exchange** grant types ( this allows the agent to perform the OBO exchange on behalf of users)
3. Select the Public Client option (secret will be removed)
4. Add the redirect URL: `http://localhost:8011/callback`

5. Add the allowed origin: `http://localhost:8011`
6. Ensure token format is JWT.
7. Under **Authorization**, add the Transactions API and the `read_transactions` scope (this is required, otherwise the scope won't be added to the OBO token)
8. Under **Roles**, make sure Audience is set to Organization (since we are creating organization-level roles)
9. Under **Advanced**, enable "App Native Authentication "
10. Copy the generated **Client ID** — You will use to set `AGENT_APP_ID` in `transactions-agent/.env`


## MCP Client

1. Create  an MCP Client application (Console → Applications → MCP Client)
   * Call it **BOA-MCP**
   * Use the redirect URL: `http://localhost:8011/callback`
   * Check *Public Client*

2. Once the app is created, add the allowed origin: `http://localhost:8011`
3. Under **API Authorisation**, add the `Agencies MCP Server` resource registered above
4. Under **Advanced**, enable "App Native Authentication "
5. Copy the generated **Client ID** — You will use it to set:
   1. `MCP_CLIENT_ID` in `transactions-agent/.env`
   2. `EXPECTED_AUDIENCE` in `agencies-mcp-server/.env` 

# Application Setup

## Default Ports

| Port   | Service                                | Change it in                                                 |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| `5173` | React frontend (Vite dev/preview)      | `app/vite.config.js` → `server.port` / `preview.port`        |
| `3002` | Node/Express backend server            | `server/.env` → `PORT`                                       |
| `8010` | Transactions API (FastAPI)             | `transactions-api/app/main.py` → uvicorn `--port`, `server/.env` → `TRANSACTIONS_API_URL`, `transactions-api/Dockerfile` → `EXPOSE` + `CMD --port`, `docker-compose.yml` → port mapping |
| `8011` | Transactions Agent WebSocket (FastAPI) | `script/bank-of-asgard-agent.service` → `--port`, `transactions-agent/.env` → `IDP_REDIRECT_URI` callback path, `transactions-agent/Dockerfile` → `EXPOSE` + `CMD --port`, `docker-compose.yml` → port mapping |
| `8012` | Agencies MCP Server (FastMCP SSE)      | `agencies-mcp-server/server.py` → port constant, `docker-compose.yml` → port mapping |

When changing a port, also update:

- `transactions-api/.env` → `CORS_ORIGINS` (must include the frontend origin)
- `app/public/config.js` → `API_BASE_URL` / `API_SERVICE_URL` (if changing port 3002) or `TRANSACTIONS_AGENT_URL` (if changing port 8011)
- Any redirect URIs registered in the identity provider console
- The port constants at the top of `demo_scripts/validate.sh`, `demo_scripts/start-demo.sh`, `demo_scripts/stop-demo.sh`, and `demo_scripts/restart.sh` — each file has a clearly marked `PORT_*` block for exactly this purpose

## **Credentials**

| Env var pair                                  | Issued by                       | Used for                                                     | Validates in        | SAMPLE VALUE                  |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------ | ------------------- | ----------------------------- |
| `AGENT_APP_ID`                                | Asgardeo / IS (public app)      | PKCE login — identifies the app to the IDP                   | IDP login page      | AGENT_123                     |
| `AGENT_ID` + `AGENT_SECRET`                   | Asgardeo / IS (agent principal) | OBO token exchange (Flow 1) — credentials in native auth step | Transactions API    | AGENTID_123 / AGENTSECRET_123 |
| `MCP_CLIENT_ID`                               | Asgardeo / IS (public app)      | MCP bearer token (Flow 3)                                    | Agencies MCP Server | MCP_123                       |
| `GATEWAY_CLIENT_ID` + `GATEWAY_CLIENT_SECRET` | WSO2 AI Gateway                 | LLM API access via gateway (Flow 4 only)                     | WSO2 AI Gateway     | GW_CLIENTID / GWCLIENT_SECRET |
| APP_CLIENT_ID                                 | Asgardeo / IS                   | Credential for FrontEnd App                                  | IS                  | APP_123                       |
| SERVER APP ID + SECRET                        | Asgardeo / IS                   | Credentials for Backend App                                  | IS                  | SERVERID_123 SERVERSEC_123    |

> `EXPECTED_AUDIENCE` in `agencies-mcp-server/.env` must equal `MCP_CLIENT_ID` — Asgardeo / IS puts the requesting application's client ID in the `aud` claim.

## Frontend

1. Create a copy of `app/public/config.example.js` inside the `app/public/` folder and name it `config.js`. 

   

   ```js
   window.config = {
   
     API_BASE_URL: "http://localhost:3002",  
     API_SERVICE_URL: "http://localhost:3002",
     APP_BASE_URL: "http://localhost:5173",
     IDP_BASE_URL: "https://myidentity-server.com:9445",
     ORGANIZATION_NAME: "carbon.super",
     // Asgardeo Setup
     // IDP_BASE_URL: "https://api.asgardeo.io/t/myOrg",
     // ORGANIZATION_NAME: "myOrg",
     APP_CLIENT_ID: "APP_123",
     APP_NAME: "",
     DISABLED_FEATURES: [],
     TRANSFER_THRESHOLD: 10000,
     IDENTITY_VERIFICATION_PROVIDER_ID: "",
   
     IDENTITY_VERIFICATION_CLAIMS: [
     	"http://wso2.org/claims/dob",
     ],
   
     TRANSACTIONS_AGENT_URL: "ws://localhost:8011", // Adjust if you change the ports
     AWS_BRANDING: false,  // uncomment to show "Powered by AWS" logos
   
   	DEMO_USERS: {
       personal: {
         firstName: "Thor",
         lastName: "Odinson",
         username: "thor.odinson",
         email: "thor@asgard.demo",
         password: "Demo@12345",
         dateOfBirth: "1985-03-15",
         country: "Norway",
         mobile: "0411111111"
       },
       business: {
         firstName: "Loki",
         lastName: "Laufeyson",
         username: "loki.laufeyson",
         email: "loki@asgard.demo",
         password: "Demo@12345",
         dateOfBirth: "1987-06-01",
         country: "Norway",
         mobile: "0422222222",
         businessName: "Asgard Enterprises"
       }
     }
   }
   ```

   No rebuild is needed — `config.js` is a static file read at runtime.

## Backend

Create a copy of `server/.env.example` inside the `server/` folder and name it `.env`. 

```yaml
# The port number that the server will listen to.
# Change this to the desired port number that the server should listen to.
# Change from 5000 which is used by Control Center on MacOS
PORT=3002

# The client ID for the Asgardeo Traditional Web Application (TWA) app
SERVER_APP_CLIENT_ID="SERVERID_123"

# The client ID for the Asgardeo Traditional Web Application (TWA) app
SERVER_APP_CLIENT_SECRET="SERVERSEC_123"

# The base URL for the identity provider's API
# For Asgardeo, use https://api.asgardeo.io/t/your-org
IDP_BASE_URL="https://myidentity-server.com:9445"

# The base URL for the client application
# E.g., http://localhost:5173
VITE_REACT_APP_CLIENT_BASE_URL="http://localhost:5173"

# GEO API Key - Only used for conditional login. Ignore.
GEO_API_KEY="dummy"

# Name of the user store to create the users. Default is "PRIMARY". 
# For Asgardeo, use "DEFAULT".
USER_STORE_NAME="PRIMARY"

# Name of the IS role assigned to new users on signup to grant access to transactions.
# Default is "Read_Transactions". Override if your role has a different name.
# TRANSACTIONS_ROLE_NAME="Read_Transactions"
```



### Agencies MCP Server

Create `.env` from `.env.example`:

```YAML
IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>   # or your WSO2 IS base URL
EXPECTED_AUDIENCE=MCP_123                   				# client ID of the MCP Client Application (IS step 5)
# SSL_VERIFY=false   																# only for self-signed certs in local dev
```

> > [!CAUTION]
> >
> > `EXPECTED_AUDIENCE` must equal `MCP_CLIENT_ID` — the token issued via `MCP_CLIENT_ID`'s native auth flow carries `aud = MCP_CLIENT_ID`.



### Transactions API

Create a copy of `transactions-api/.env.example` inside `transactions-api/` and name it `.env`. 

```YAML
# Asgardeo JWT Validation
#JWKS_URL=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/jwks
#JWT_ISSUER=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token
# IS JWT Validation
JWKS_URL=https://myidentity-server.com:9445/oauth2/jwks
JWT_ISSUER=https://myidentity-server.com:9445/oauth2/token
JWKS_CACHE_TTL=3600

# CORS — comma-separated list of allowed origins
CORS_ORIGINS=http://localhost:5173,http://localhost:3002

# Use SSL verification (Can be set to false for local testing with self-signed certs; not recommended for production)
# SSL_VERIFY=false
```

### Transactions Agent

Create a copy of `transactions-agent/.env.example` inside `transactions-agent/` and name it `.env`. Fill in:

```YAML
AGENT_APP_ID=AGENT_123
# ASGARDEO SETUP
# IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>
IDP_REDIRECT_URI=http://localhost:8011/callback
# Agent Secret can contain special characters, like a password. Use double-quotes.
AGENT_ID="AGENTID_123"
AGENT_SECRET="AGENTSECRET_123"

# If you are using docker, use the container name from docker-compose. Otherwise the local 
# machine hostname
TRANSACTIONS_API_BASE_URL=http://transactions-api:8010

# Set the key matching the provider in llm_config.yaml (not needed when WSO2 gateway is enabled)
OPENAI_API_KEY=<OPENAI_API_KEY>
# GEMINI_API_KEY=<GEMINI_API_KEY>
# ANTHROPIC_API_KEY=<ANTHROPIC_API_KEY>
# MISTRAL_API_KEY=<MISTRAL_API_KEY>

# WSO2 API Gateway (only when gateway.enabled: true in llm_config.yaml)
# GATEWAY_BASE_URL=<GATEWAY_BASE_URL>
# GATEWAY_BASE_URL_SECURED=<GATEWAY_BASE_URL_SECURED>
# GATEWAY_TOKEN_ENDPOINT=<GATEWAY_TOKEN_ENDPOINT>
# GATEWAY_CLIENT_ID=<GATEWAY_CLIENT_ID>
# GATEWAY_CLIENT_SECRET=<GATEWAY_CLIENT_SECRET>

# Agencies MCP Server — dedicated public OAuth2 app for MCP access (IS step 5)
# EXPECTED_AUDIENCE in agencies-mcp-server/.env must equal this value
MCP_CLIENT_ID=MCP_123
# Direct endpoint (default, no gateway routing):
AGENCIES_MCP_URL=http://localhost:8012/sse
# Gateway-routed endpoint (optional):
# MCP_GATEWAY_URL=https://<GATEWAY_HOST>/agencies/sse
# MCP_GATEWAY_ENABLED=false

# Disable TLS certificate verification — use only for localhost dev with self-signed certs
# SSL_VERIFY=false

# WSO2 Agent Manager — OpenTelemetry instrumentation (amp-instrumentation)
export AMP_OTEL_ENDPOINT="http://localhost:22893/otel"
export AMP_AGENT_API_KEY="<from Agent Manager Setup"

```

## LLM Configuration

Edit `llm_config.yaml` at the repo root to select the LLM provider:
```yaml
# provider: openai | gemini | anthropic | bedrock | mistral
provider: openai
# model: gpt-4o-mini   # uncomment to override the default
```

| Provider    | Default model                                  | Notes                         |
| ----------- | ---------------------------------------------- | ----------------------------- |
| `openai`    | `gpt-4o-mini`                                  |                               |
| `gemini`    | `gemini-2.5-flash-lite`                        |                               |
| `anthropic` | `claude-sonnet-4-5-20250929`                   |                               |
| `bedrock`   | `eu.anthropic.claude-sonnet-4-6-20250514-v1:0` | strands agent only            |
| `mistral`   | `mistral-small-latest`                         | Must be OpenAI-compatible API |

# Using WSO2 AI Gateway (recommended )

### LLM APIs

Change the configuration to route LLM calls via a gateway instead of a direct API key - The demo allows to switch between GATEWAY_BASE_URL and GATEWAY_BASE_URL_SECURED. Typically you want to expose a V1 and v2 of the same LLM API, one in passthrough mode (no guardrails) and one with guardrails, typically semantic analysis, content safety, content length guards.

Then create a new application from dev portal, subscribe to the two APIs, and use CLIENTID/SECRET of this app as GATEWAY_CLIENT_ID/GATEWAY_CLIENT_SECRET.

```yaml
# llm_config.yaml
gateway:
  enabled: true
```
```YAML
# transactions-agent/.env
GATEWAY_BASE_URL=<GATEWAY_BASE_URL># Passthrough
GATEWAY_BASE_URL_SECURED=<GATEWAY_BASE_URL_SECURED>   # guardrail-enabled endpoint 
GATEWAY_TOKEN_ENDPOINT=<GATEWAY_TOKEN_ENDPOINT>
GATEWAY_CLIENT_ID=<GATEWAY_CLIENT_ID>
GATEWAY_CLIENT_SECRET=<GATEWAY_CLIENT_SECRET>
# Example
#GATEWAY_BASE_URL=https://my-api-gateway.com:8250/claude/v1
#GATEWAY_BASE_URL_SECURED=https://my-api-gateway.com:8250/claude/v2
#GATEWAY_CLIENT_ID=<apim_client_id>
#GATEWAY_CLIENT_SECRET=<apim_client_secret>
#GATEWAY_TOKEN_ENDPOINT=https://my-api-gateway.com:9450/oauth2/token
```
### Agencies MCP Server

You can proxy the Agencies MCP server via the publisher console:

- **Backend URL**: `http://host.containers.internal:8012/sse`
- Enable **OAuth2 protection** so the agent must present a bearer token
- Set the resulting gateway-managed SSE URL as `MCP_GATEWAY_URL` in `transactions-agent/.env` and set `MCP_GATEWAY_ENABLED=true`
- If the gateway requires a specific scope, set it as `MCP_TOKEN_SCOPE`

When `MCP_GATEWAY_ENABLED` is unset or `false`, the agent connects directly to `AGENCIES_MCP_URL` (useful for local dev without the gateway).

### Demo scripts (recommended for local development)

The `demo_scripts/` directory provides four helper scripts that manage the full stack — transactions-api, agencies-mcp-server, selected agent, Express server, and frontend — as native processes with health-checked startup, clean teardown, and single-service restart.

> [!NOTE]
>
> **Platform support:** macOS and Linux. Windows requires [WSL](https://learn.microsoft.com/en-us/windows/wsl/install).

**One-time setup** — create a venv for each service you plan to use:

```bash
# Transactions API
cd transactions-api && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt && cd ..

# Agencies MCP server
cd agencies-mcp-server && python3.11 -m venv venv && venv/bin/pip install -r requirements.txt && cd ..

# Agents (repeat for each framework you want to run)
cd transactions-agent
python3.11 -m venv langchain-agent/venv && langchain-agent/venv/bin/pip install -r langchain-agent/requirements.txt
python3.11 -m venv autogen-agent/venv   && autogen-agent/venv/bin/pip install   -r autogen-agent/requirements.txt
python3.11 -m venv strands-agent/venv   && strands-agent/venv/bin/pip install   -r strands-agent/requirements.txt
cd ..
```

| Script | Purpose |
|--------|---------|
| `demo_scripts/validate.sh` | Pre-flight check — verifies versions, config files, venvs, imports, and port availability |
| `demo_scripts/start-demo.sh [langchain\|autogen\|strands]` | Starts the full stack in order; polls each health endpoint before moving on; prompts for agent and AMP if not specified |
| `demo_scripts/stop-demo.sh` | Gracefully stops everything started by `start-demo.sh` |
| `demo_scripts/restart.sh <service>` | Stops and restarts a single service (`transactions-api`, `agent`, `mcp`, `server`, `frontend`) |

```bash
# Verify everything is configured correctly
./demo_scripts/validate.sh

# Start the full stack (agent framework prompted if not specified)
./demo_scripts/start-demo.sh langchain
# Start the full stack with instrumentation
./demo_scripts/start-demo.sh langchain --amp

# Restart a single service after a code change (e.g. after editing the agent)
./demo_scripts/restart.sh agent
./demo_scripts/restart.sh mcp

# Stop everything
./demo_scripts/stop-demo.sh
```

Logs are written to `.demo-logs/` (one file per service). Process IDs are tracked in `.demo.pids`.

### Running with Docker / Podman (alternative)

The compose file uses **profiles** to select which agent implementation to run (`autogen`, `strands`, or `langchain`). Only one agent listens on port 8011 at a time. The `agencies-mcp-server` (port 8012) has no profile and starts automatically alongside whichever agent profile is active.

1. (Podman only) Copy `llm_config.yaml` to a path the Podman VM can reach:

```bash
mkdir -p ~/podman_share
cp llm_config.yaml ~/podman_share/llm_config.yaml
```

2. Start the agent and the API, specifying the agent profile:

```bash
# Choose one: autogen | strands | langchain
podman compose --profile langchain up --build -d
# or with docker:
docker compose --profile langchain up --build -d
```

To enable **WSO2 Agent Manager (AMP) instrumentation** (supported by `langchain` and `strands` only), pass the overlay file and set `AMP_AGENT_API_KEY` in `.env`:

```bash
podman compose -f docker-compose.yml -f docker-compose.amp.yml --profile langchain up --build -d
```

3. View logs:

```bash
podman compose logs -f transactions-api
podman compose logs -f bank-transactions-agent
```

4. Stop:

```bash
podman compose down
```

