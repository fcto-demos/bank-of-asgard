# Production Setup — apis.coach

Step-by-step guide to deploy Bank of Asgard on a VM behind a DigitalOcean Load Balancer.

---

## Architecture

```
Browser
  │
  ├─ https://boa.apis.coach:444       ──►  DO LB  ──►  VM:5173  (Vite preview — frontend SPA)
  └─ wss://boa-agent.apis.coach:445   ──►  DO LB  ──►  VM:8011  (uvicorn — transactions agent)

VM also runs (directly, no LB):
  └─ localhost:3002   Node/Express backend server
  └─ localhost:8010   Transactions API
```

Both domains point to the **same LB IP**. The LB differentiates them by listening port (444 vs 445), so no nginx is needed on the VM.

---

## 1. DNS

Add two A records pointing to the DO LB public IP:

| Hostname | Type | Value |
|---|---|---|
| `boa.apis.coach` | A | `<LB public IP>` |
| `boa-agent.apis.coach` | A | `<LB public IP>` |

---

## 2. DigitalOcean Load Balancer

In **DO Console → Networking → Load Balancers**:

### Forwarding rules

| Protocol | Entry port | Protocol | Target port | Purpose |
|---|---|---|---|---|
| HTTPS | 444 | HTTP | 5173 | Frontend |
| HTTPS | 445 | HTTP | 8011 | Agent (WebSocket) |

> Both rules **must use HTTP** (not TCP) so the LB forwards the WebSocket `Upgrade` header to the agent.

### TLS certificate

Attach certificates for `boa.apis.coach` and `boa-agent.apis.coach` under the **SSL** tab. Use Let's Encrypt via DO if you don't already have certs.

### Idle timeout (critical for WebSocket)

**DO Console → Load Balancers → Settings → Advanced → Idle timeout**

Set to **3600 seconds**. The default of 60 s will kill live WebSocket conversations mid-session.

### Backend droplet

Add your VM as a backend droplet on the **Droplets** tab.

---

## 3. VM — one-time setup

SSH into the VM and run:

```bash
# Install Node.js (v20+ recommended)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pyenv build dependencies
sudo apt-get install -y make build-essential libssl-dev zlib1g-dev \
  libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
  libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev \
  libffi-dev liblzma-dev

# Create the dedicated service user
sudo useradd --system --create-home --shell /bin/bash boa

# Install pyenv and Python 3.11 as the boa user
sudo -u boa bash -c '
  curl -fsSL https://pyenv.run | bash
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
  pyenv install 3.11
'

# Clone the project into the boa home directory
sudo -u boa git clone <your-repo-url> /home/boa/bank-of-asgard

# Pin Python 3.11 to this project only (writes .python-version in the repo root)
sudo -u boa bash -c '
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init -)"
  cd /home/boa/bank-of-asgard && pyenv local 3.11
'
```

> The deploy scripts and service unit files rely on pyenv virtualenv auto-activation via `.python-version` files (written by `pyenv local`). Make sure both pyenv and pyenv-virtualenv are initialised for the `boa` user by adding the following to `/home/boa/.profile`:
>
> ```bash
> export PYENV_ROOT="$HOME/.pyenv"
> export PATH="$PYENV_ROOT/bin:$PATH"
> eval "$(pyenv init -)"
> eval "$(pyenv virtualenv-init -)"
> ```
>
> The service units use `ExecStart=/bin/bash -lc '...'` (login shell), so `.profile` is sourced automatically on each start.

---

## 4. Transactions API — configure & deploy

### 4a. Configure `.env`

```bash
sudo -u boa cp /home/boa/bank-of-asgard/transactions-api/.env.example \
               /home/boa/bank-of-asgard/transactions-api/.env
```

Edit `.env`:

```dotenv
JWKS_URL=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/jwks
JWT_ISSUER=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token
JWKS_CACHE_TTL=3600
CORS_ORIGINS=https://app.apis.coach:444,http://localhost:3002
```

### 4b. Deploy

```bash
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-api.sh
```

This will:
1. Create pyenv virtualenv `boa-api` (if it doesn't exist), set it locally via `pyenv local`, and `pip install -r requirements.txt`
2. Validate that `.env` exists
3. Install `/etc/systemd/system/bank-of-asgard-api.service`
4. Enable and start the service (runs as `boa`, virtualenv auto-activated by pyenv)

---

## 5. Node/Express Server — configure & deploy

### 5a. Configure `.env`

```bash
sudo -u boa cp /home/boa/bank-of-asgard/server/.env.example \
               /home/boa/bank-of-asgard/server/.env
```

Edit `.env`:

```dotenv
PORT=3002
SERVER_APP_CLIENT_ID=<your-twa-client-id>
SERVER_APP_CLIENT_SECRET=<your-twa-client-secret>
IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>
IDP_TOKEN_ENDPOINT=https://api.asgardeo.io/t/<ORG_NAME>/oauth2/token
VITE_REACT_APP_CLIENT_BASE_URL=https://app.apis.coach:444
GEO_API_KEY=<your-ipgeolocation-key>
USER_STORE_NAME=DEFAULT
TRANSACTIONS_API_URL=http://localhost:8010   # ← not the Docker container name
```

### 5b. Deploy

```bash
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-server.sh
```

This will:
1. `npm install`
2. Validate that `.env` exists and warn if the Docker container name is still set
3. Install `/etc/systemd/system/bank-of-asgard-server.service`
4. Enable and start the service (runs as `boa`)

---

## 6. Transactions Agent — configure & deploy

### 6a. Configure `.env`

```bash
sudo -u boa cp /home/boa/bank-of-asgard/transactions-agent/.env.example \
               /home/boa/bank-of-asgard/transactions-agent/.env
```

Edit `.env`:

```dotenv
IDP_CLIENT_ID=<your-client-id>
IDP_BASE_URL=https://api.asgardeo.io/t/<ORG_NAME>
IDP_REDIRECT_URI=https://boa-agent.apis.coach:445/callback   # ← must match Asgardeo app settings

AGENT_ID=<agent-client-id>
AGENT_SECRET=<agent-client-secret>

TRANSACTIONS_API_BASE_URL=http://localhost:8010

# WSO2 API Gateway (when gateway.enabled: true in llm_config.yaml)
GATEWAY_BASE_URL=<gateway-base-url>
GATEWAY_BASE_URL_SECURED=<gateway-secured-url>
GATEWAY_TOKEN_ENDPOINT=<gateway-token-endpoint>
GATEWAY_CLIENT_ID=<gateway-client-id>
GATEWAY_CLIENT_SECRET=<gateway-client-secret>
```

### 6b. Configure LLM provider

`llm_config.yaml` at the repo root controls which LLM is used.

**Bedrock via WSO2 API Gateway (current setup):**

```yaml
provider: bedrock
# model: eu.anthropic.claude-sonnet-4-6   # default; uncomment to override

gateway:
  enabled: true
```

The gateway handles AWS authentication on its backend. No AWS credentials are needed on the VM — only the `GATEWAY_*` env vars above.

**Other supported providers** (set `gateway.enabled: false` and provide the matching API key):

| provider | Default model | Env var |
|---|---|---|
| `anthropic` | `claude-sonnet-4-5-20250929` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |
| `gemini` | `gemini-2.5-flash-lite` | `GEMINI_API_KEY` |
| `bedrock` (no gateway) | `eu.anthropic.claude-sonnet-4-6` | AWS credentials via `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`; region from `AWS_DEFAULT_REGION` (default `eu-north-1`) |

### 6c. Deploy

```bash
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-agent.sh
```

This will:
1. Create pyenv virtualenv `boa-agent` (if it doesn't exist), set it locally via `pyenv local`, and `pip install -r requirements.txt`
2. Validate that `.env` exists and warn about any remaining `localhost` references
3. Install `/etc/systemd/system/bank-of-asgard-agent.service`
4. Enable and start the service (runs as `boa`, virtualenv auto-activated by pyenv)

---

## 7. Frontend — configure & deploy

### 7a. Set the production config

```bash
sudo -u boa cp /home/boa/bank-of-asgard/app/public/config.prod.js \
               /home/boa/bank-of-asgard/app/public/config.js
```

Open `config.js` and fill in:

```js
API_BASE_URL:     "https://api.apis.coach",
API_SERVICE_URL:  "https://api.apis.coach",
```

All other values are already set for the `apis.coach` domain.

### 7b. Deploy

```bash
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-app.sh
```

This will:
1. `npm install` + `npm run build` (produces `dist/`)
2. Install `/etc/systemd/system/bank-of-asgard-app.service`
3. Enable and start the service (runs as `boa`, starts at boot automatically)

---

## 8. Full deploy (all services at once)

After a `git pull`, redeploy everything in dependency order:

```bash
sudo -u boa git -C /home/boa/bank-of-asgard pull
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-all.sh
```

To redeploy a single service:

```bash
sudo -u boa git -C /home/boa/bank-of-asgard pull
sudo -u boa bash /home/boa/bank-of-asgard/script/deploy-agent.sh   # for example
```

---

## 9. Asgardeo — update redirect URIs

In your Asgardeo console, update the **Allowed redirect URLs** for the agent application to include:

```
https://boa-agent.apis.coach:445/callback
```

Remove any `localhost` entries that were used for local development.

---

## 10. Service management

```bash
# Status
sudo systemctl status bank-of-asgard-api
sudo systemctl status bank-of-asgard-server
sudo systemctl status bank-of-asgard-agent
sudo systemctl status bank-of-asgard-app

# Logs (live)
journalctl -u bank-of-asgard-api    -f
journalctl -u bank-of-asgard-server -f
journalctl -u bank-of-asgard-agent  -f
journalctl -u bank-of-asgard-app    -f

# Restart
sudo systemctl restart bank-of-asgard-api
sudo systemctl restart bank-of-asgard-server
sudo systemctl restart bank-of-asgard-agent
sudo systemctl restart bank-of-asgard-app

# Stop all
sudo systemctl stop bank-of-asgard-api bank-of-asgard-server bank-of-asgard-agent bank-of-asgard-app
```

---

## Reference — deployed URLs

| Service | Local | Public |
|---|---|---|
| Frontend | `http://0.0.0.0:5173` | `https://app.apis.coach:444` |
| Agent WebSocket | `http://0.0.0.0:8011` | `wss://boa-agent.apis.coach:445` |
| Node server | `http://localhost:3002` | (internal only) |
| Transactions API | `http://localhost:8010` | (internal only) |

## Reference — deployment files

| File | Purpose |
|---|---|
| `script/deploy-all.sh` | Deploy all four services in order |
| `script/deploy-api.sh` | Setup venv and install transactions-api service |
| `script/deploy-server.sh` | npm install and install Node server service |
| `script/deploy-agent.sh` | Setup venv and install agent service |
| `script/deploy-app.sh` | Build and install frontend service |
| `script/bank-of-asgard-api.service` | Systemd unit for the transactions API |
| `script/bank-of-asgard-server.service` | Systemd unit for the Node server |
| `script/bank-of-asgard-agent.service` | Systemd unit for the agent |
| `script/bank-of-asgard-app.service` | Systemd unit for the frontend |
| `script/do-lb-config.md` | DO LB forwarding rules reference |
| `app/public/config.prod.js` | Production frontend config template |
| `llm_config.yaml` | LLM provider selection (repo root) |
