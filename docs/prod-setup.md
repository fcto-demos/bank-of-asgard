# Production Setup — apis.coach

Step-by-step guide to deploy Bank of Asgard on a VM behind a DigitalOcean Load Balancer.

---

## Architecture

```
Browser
  │
  ├─ https://app.apis.coach:444  ──►  DO LB  ──►  VM:5173  (Vite preview — frontend SPA)
  └─ wss://boa-agent.apis.coach:445  ─►  DO LB  ──►  VM:8011  (uvicorn — transactions agent)

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
| `app.apis.coach` | A | `<LB public IP>` |
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

Attach certificates for `app.apis.coach` and `boa-agent.apis.coach` under the **SSL** tab. Use Let's Encrypt via DO if you don't already have certs.

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

# Install Python 3.11+
sudo apt-get install -y python3.11 python3.11-venv python3-pip

# Clone the project
cd ~
git clone <your-repo-url> bank-of-asgard
```

---

## 4. Frontend — configure & deploy

### 4a. Set the production config

```bash
cp ~/bank-of-asgard/app/public/config.prod.js ~/bank-of-asgard/app/public/config.js
```

Open `config.js` and fill in the two placeholder values:

```js
API_BASE_URL:     "https://api.apis.coach",   // URL where server/ is exposed
API_SERVICE_URL:  "https://api.apis.coach",   // same
```

All other values are already set for the `apis.coach` domain.

### 4b. Run the deploy script

```bash
bash ~/bank-of-asgard/script/deploy-app.sh
```

This will:
1. `npm install` + `npm run build` (produces `dist/`)
2. Install `~/.config/systemd/user/bank-of-asgard-app.service`
3. Enable and start the service
4. Enable linger so it starts at boot without a login session

---

## 5. Transactions agent — configure & deploy

### 5a. Set the production `.env`

```bash
cp ~/bank-of-asgard/transactions-agent/.env.example \
   ~/bank-of-asgard/transactions-agent/.env
```

Edit `.env` and set the following values:

```dotenv
IDP_CLIENT_ID=<your-client-id>
IDP_BASE_URL=https://identity.dev.apis.coach:9445
IDP_REDIRECT_URI=https://boa-agent.apis.coach:445/callback   # ← must match Asgardeo app settings

AGENT_ID=<agent-client-id>
AGENT_SECRET=<agent-client-secret>

TRANSACTIONS_API_BASE_URL=http://localhost:8010   # ← not the docker container name

OPENAI_API_KEY=<your-key>   # or GEMINI_API_KEY / ANTHROPIC_API_KEY / MISTRAL_API_KEY
```

> If you previously used Docker, note that `TRANSACTIONS_API_BASE_URL` used the container name (`http://transactions-api:8010`). On the VM it must be `http://localhost:8010`.

### 5b. Place the LLM config

The agent expects `llm_config.yaml` at the project root:

```bash
cp ~/bank-of-asgard/llm_config.yaml ~/bank-of-asgard/transactions-agent/  # or symlink
```

### 5c. Run the deploy script

```bash
bash ~/bank-of-asgard/script/deploy-agent.sh
```

This will:
1. Create a Python venv at `transactions-agent/.venv` and `pip install -r requirements.txt`
2. Validate that `.env` exists and warn about any remaining `localhost` references
3. Install `~/.config/systemd/user/bank-of-asgard-agent.service`
4. Enable and start the service

---

## 6. Asgardeo — update redirect URIs

In your Asgardeo console, update the **Allowed redirect URLs** for the agent application to include:

```
https://boa-agent.apis.coach:445/callback
```

Remove any `localhost` entries that were used for local development.

---

## 7. Redeploying after a code change

**Frontend** (rebuild required):
```bash
cd ~/bank-of-asgard && git pull
bash ~/bank-of-asgard/script/deploy-app.sh
```

**Agent** (restarts the service, rebuilds venv if needed):
```bash
cd ~/bank-of-asgard && git pull
bash ~/bank-of-asgard/script/deploy-agent.sh
```

**Config-only change** (no rebuild needed — `config.js` is loaded at runtime):
```bash
# Edit ~/bank-of-asgard/app/public/config.js, then:
systemctl --user restart bank-of-asgard-app
```

---

## 8. Service management

```bash
# Status
systemctl --user status bank-of-asgard-app
systemctl --user status bank-of-asgard-agent

# Logs (live)
journalctl --user -u bank-of-asgard-app -f
journalctl --user -u bank-of-asgard-agent -f

# Restart
systemctl --user restart bank-of-asgard-app
systemctl --user restart bank-of-asgard-agent

# Stop
systemctl --user stop bank-of-asgard-app
systemctl --user stop bank-of-asgard-agent
```

---

## Reference — deployed URLs

| Service | Local | Public |
|---|---|---|
| Frontend | `http://0.0.0.0:5173` | `https://app.apis.coach:444` |
| Agent WebSocket | `http://0.0.0.0:8011` | `wss://boa-agent.apis.coach:445` |
| Backend server | `http://localhost:6000` | (configure separately) |
| Transactions API | `http://localhost:8010` | (internal only) |

## Reference — deployment files

| File | Purpose |
|---|---|
| `script/deploy-app.sh` | Build and install frontend service |
| `script/deploy-agent.sh` | Setup venv and install agent service |
| `script/bank-of-asgard-app.service` | Systemd unit for the frontend |
| `script/bank-of-asgard-agent.service` | Systemd unit for the agent |
| `script/nginx-lb.conf` | DO LB forwarding rules reference |
| `app/public/config.prod.js` | Production frontend config template |
