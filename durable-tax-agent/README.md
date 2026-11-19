# Durable Tax Filing Agent

A durable AI agent for the Kingdom of Asgard's Ministry of Finance, written in Ballerina with `ballerina/workflow`'s `DurableAgent`. It prepares a citizen's 2026 income tax return, files it once the citizen signs, and sees any provisional relief through a ministry officer's evidence review, amending the return on its own when the evidence is rejected or nobody reviews it in time.

It is a durable rewrite of the Python `tax-agent` in this repository, which it replaces: that one is deprecated, and the demo scripts start this agent instead (see [Run with the demo scripts](#run-with-the-demo-scripts)). The tax rules are the same: progressive brackets (0% to 12,000; 20% to 30,000; 35% to 60,000; 45% above) and four relief categories with fixed rates and annual caps.

| Category | Rate | Annual cap | Evidence reviewed |
| --- | --- | --- | --- |
| `medical` | 50% | 1,500 | no |
| `commuting` | 30% | 900 | no |
| `home_energy` | 20% | 600 | no |
| `professional_travel` | 25% | 1,200 | yes, by an officer |

Unknown categories are ignored. The model never handles a figure: every tool takes only the return's number, and reads the figures the bank sent from the run's recorded input. The model decides the steps and explains the outcome.

## Why durable

A request/response service could assess and file a return in one call. It couldn't do what happens next:

| What the return needs | What makes it durable |
| --- | --- |
| Wait for an officer for days, long after the citizen's chat has closed | The run lives in Temporal, not in a request, a session or a process |
| Keep going when the agent crashes or is redeployed while it waits | Finished steps are replayed from history, never run again: `fileReturn` runs exactly once |
| Withdraw the relief when nobody reviews it in time | The review deadline is a durable timer: it survives restarts too |
| Amend a return it already filed | `amendReturn` runs once, and only after a rejection or a missed deadline |
| Show who decided what, and when | The run's history records the citizen's signature, the officer's review and every step |

## How it works

1. The bank's Coordinator calls `POST /prepare-return`. The ministry assigns a return number, records the figures and the citizen as the run's input, and answers with the run's `instanceId` and the draft assessment.
2. The agent calls `assessReturn`, then proposes `fileReturn`. The run waits for the **citizen's signature**: their own token, through the Coordinator's chat.
3. `fileReturn` files the return, with a reference such as `ASG-2026-6A632338` derived from the return number. Reliefs that need evidence are granted **provisionally**.
4. If there are provisional reliefs, the agent opens an `evidenceReview` task for a **tax officer**, who accepts or rejects the evidence in the [Ministry inbox](#ministry-inbox). The task has a deadline (`reviewDeadlineMinutes`).
5. If the officer rejects the evidence, or the deadline passes, the agent calls `amendReturn`: the provisional reliefs are withdrawn and the tax recomputed. An expired review disappears from the inbox on its own.
6. The agent writes a short summary for the citizen.

## API

The service listens on port `8014` under `/tax-agent`.

| Method | Path | Caller | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | anyone | Health check |
| `POST` | `/prepare-return` | Coordinator | Start a return; returns the `instanceId` and the draft assessment |
| `GET` | `/tax-returns/{instanceId}` | Coordinator | Status (`in progress` or `completed`), the filing and the amendment as soon as they happen, and the final summary |
| `GET` | `/tax-returns/{instanceId}/tasks` | Coordinator | The signature step waiting for the citizen, with the assessment of exactly what will be filed |
| `POST` | `/approvals/{taskId}` | Citizen | Sign (`proceed`) or decline (`reject`) the filing |
| `GET` | `/my/tax-returns` | Citizen | The caller's own returns and their status |
| `GET` | `/officer/claims` | Officer | Evidence reviews waiting for an officer, with their deadline |
| `POST` | `/officer/claims/{taskId}` | Officer | Accept or reject the evidence: `{"accepted": false, "note": "..."}` |
| `GET` | `/inbox` | anyone | The Ministry of Finance home page, with the officer workspace (signs the officer in) |

### Authentication

Every endpoint except `/health` and the inbox page requires `Authorization: Bearer <token>`: a JWT signed by the identity provider at `idpBaseUrl` (keys from `<idpBaseUrl>/oauth2/jwks`) whose audience is `expectedAudience`. Expiry is checked; the issuer is not. A missing or invalid token gets `401`, and a token without the operation's scope `403`. Every caller's token has the same audience, so the scope is what tells them apart; `openapi.yaml` documents each operation's scope (`ministryAuth`).

| Caller | Token | Checks |
| --- | --- | --- |
| Coordinator | Its agent token | `coordinatorScope` (required), granted only to the Coordinator's agent identity |
| Citizen | Their own token (OBO), obtained by the Coordinator with their consent | `citizenScope` (when set), and its `sub` must be the citizen the return was started for |
| Officer | Their own token, from signing in to the inbox | `officerScope` (required), and they can't review their own return |

A return belongs to the citizen it was started for: `user_sub` in `POST /prepare-return` (required). It is passed to the run as its input with the figures, so Temporal records it in the run's start event, which can never change and survives restarts (`ownership.bal`). Any other caller gets `403` on the signature, including the Coordinator with its own agent token. The workflow roles the steps are declared for (`citizen`, `tax-officer`) are granted by this service after those checks, never taken from the request, and the decider's `sub` is recorded in the run's history.

In Bank of Asgard, `expectedAudience` is `TAX_AGENT_CLIENT_ID`. The Coordinator (`transactions-agent/langchain-agent/tax_followup.py`) shows the signature step in the chat as a panel. On the citizen's first signature it asks for their consent and gets their OBO token for the Tax Agent app; the same token reads `/my/tax-returns` when the citizen asks about their return later.

`tax_id` is optional in `POST /prepare-return`: the bank has no tax ID for its users and leaves it out.

## Ministry inbox

`http://localhost:8014/tax-agent/inbox` is where a tax officer reviews the evidence for provisional reliefs. It belongs to the ministry, so this agent serves it, not the bank's app. The officer signs in at the identity provider (authorization code with PKCE, client `expectedAudience`, scope `officerScope`) and the page calls the officer API with their own token. The page is the ministry's home page, laid out like the Bank of Asgard's (masthead, hero, titled sections, footer) under the ministry's own navy-and-brass identity, and its public sections (tax year, filing deadline, published reliefs, review window) come from `/inbox/config`, so they always match the rules the agent applies. Its **Evidence review** section lists the open claims, built from each run's recorded input. Each claim shows the return's filing reference, a live countdown to the deadline, the relief under review (spend declared, rate, cap, relief claimed), and what the decision changes: the tax due if the officer accepts, and the tax due and increase if they reject or the deadline passes. The return as filed is one click away. The officer ticks a declaration in their own name before **Accept** or **Reject** is enabled, and can add a note for the record. A claim disappears once it is decided or its deadline passes. Bank of Asgard's identity provider setup for officers is in the repository README ("The tax officer").

## Sample requests

The examples use a local run (`http://localhost:8014`). `$TOKEN` is an agent token, `$CITIZEN_TOKEN` the citizen's own token and `$OFFICER_TOKEN` an officer's, all for `expectedAudience` (see [Authentication](#authentication)). On Agent Manager, use the agent's URL from the console (for example `http://default-default.am-gateway.localhost:19080/durable-tax-agent`) without `/tax-agent`, and add `-H 'X-API-Key: <key>'`.

**1. Start a return**

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8014/tax-agent/prepare-return \
  -H 'Content-Type: application/json' \
  -d '{
    "gross_income": 52000,
    "qualifying_spend": {"medical": 900, "commuting": 1400, "professional_travel": 2000},
    "user_sub": "<citizen sub>"
  }'
```

The response holds the `instanceId` and the draft assessment: total deductions 1370, taxable income 50630, tax before reliefs 11300, tax after reliefs 10820.5, a saving of 479.5, and `"evidenceNeeded": ["Professional travel"]`.

**2. Find the signature step**

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8014/tax-agent/tax-returns/<instanceId>/tasks
```

`steps[0].taskId` is the signature, titled "Sign and file your tax return", with the assessment that will be filed.

**3. Sign the filing**

```bash
curl -X POST -H "Authorization: Bearer $CITIZEN_TOKEN" http://localhost:8014/tax-agent/approvals/<taskId> \
  -H 'Content-Type: application/json' -d '{"action": "proceed"}'
```

`{"action": "reject"}` declines, and the return is not filed. Once filed, `GET /tax-returns/<instanceId>` shows `filing`, with `provisionalReliefs: ["Professional travel"]`.

**4. Review the evidence, as an officer**

```bash
curl -H "Authorization: Bearer $OFFICER_TOKEN" http://localhost:8014/tax-agent/officer/claims
curl -X POST -H "Authorization: Bearer $OFFICER_TOKEN" http://localhost:8014/tax-agent/officer/claims/<claimTaskId> \
  -H 'Content-Type: application/json' -d '{"accepted": false, "note": "No receipts for the March trip"}'
```

Or do nothing: when `reviewDeadlineMinutes` pass, the review ends unanswered.

**5. Read the outcome**

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8014/tax-agent/tax-returns/<instanceId>
```

After a rejection or a missed deadline, `amendment` shows `withdrawnReliefs: ["Professional travel"]`, tax due 10995.5 and an additional tax of 175, and the summary explains why.

## Run Temporal

The agent needs a Temporal server. For local development and demos, run the Temporal dev server in Docker:

```bash
docker run -d --name temporal \
  -p 7233:7233 -p 8233:8233 \
  -v temporal-data:/data \
  temporalio/temporal:latest \
  server start-dev --ip 0.0.0.0 --db-filename /data/temporal.db
```

- `7233` is the gRPC endpoint the agent connects to; `8233` is the Temporal UI (http://localhost:8233).
- `--db-filename` keeps runs in a volume, so they survive a restart of the container.

Or, with the [Temporal CLI](https://docs.temporal.io/cli) installed: `temporal server start-dev --db-filename ./temporal.db`.

For production, use Temporal Cloud or a self-hosted Temporal cluster with a persistent database.

## Run locally

1. Start Temporal (above).
2. Create `Config.toml` (it is gitignored):

   ```toml
   gatewayBaseUrl = "https://local-aigw.apis.coach:8443/boa-llm-v1"
   gatewayApiKey = "<the boa-tax-agent API key for boa-llm-v1>"
   llmModel = "claude-haiku-4-5"
   idpBaseUrl = "https://api.asgardeo.io/t/<ORG_NAME>"
   expectedAudience = "<TAX_AGENT_CLIENT_ID>"
   coordinatorScope = "coordinate_tax_returns"
   citizenScope = "file_tax_return"
   officerScope = "review_tax_claims"
   reviewDeadlineMinutes = 3

   [ballerina.workflow]
   mode = "LOCAL"
   taskQueue = "durable-tax-agent"
   ```

   `gatewayBaseUrl` and `gatewayApiKey` are the `boa-llm-v1` proxy URL and the `boa-tax-agent` application's key: `GATEWAY_BASE_URL` and `GATEWAY_API_KEY` in `gateway-setup/out/tax-agent.env`, which `gateway-setup/provision.py` writes. `idpBaseUrl` is `IDP_BASE_URL` in `transactions-agent/.env`, and `expectedAudience` is `TAX_AGENT_CLIENT_ID` there. `citizenScope` must match `TAX_FILING_SCOPE` in `transactions-agent/.env`; an empty string skips the scope check (the ownership check stays). `coordinatorScope` and `officerScope` are required: they are what tell the Coordinator and an officer from a citizen. `coordinatorScope` must match `TAX_COORDINATOR_SCOPE` in `transactions-agent/.env`. `reviewDeadlineMinutes` is how long an officer has to review the evidence: days in real life, a few minutes in a demo.

3. Run the agent:

   ```bash
   bal run
   ```

## Run with the demo scripts

With Ballerina installed, the [Temporal CLI](https://docs.temporal.io/cli) installed (or a Temporal server already on port `7233`) and `Config.toml` in place, `demo_scripts/start-demo.sh langchain` starts this agent along with the rest of the demo, and `demo_scripts/restart.sh tax` restarts it. Only the langchain coordinator has the tax tools, so the agent is skipped for the other coordinators, and also when any of the three is missing.

- **Temporal.** A Temporal already listening on `7233` is reused and left running by `stop-demo.sh`. Otherwise the scripts start the dev server from this folder, keeping its runs in `temporal.db`, and `stop-demo.sh` stops it. Waiting returns survive both a restart of the agent and a restart of Temporal. The Temporal UI is at http://localhost:8233.
- **Startup.** `bal run` compiles before it starts, so the first start can take a minute or two. The log is `.demo-logs/tax.log` (and `.demo-logs/temporal.log` when the scripts started Temporal).
- **Tracing.** With `--amp`, the scripts turn on the agent's tracing (`ballerinax/amp`) and run `bal run --observability-included`. To trace a run you start yourself, pass that flag too, or set `observabilityIncluded = true` under `[build-options]` in `Ballerina.toml`: if tracing is on without it, every outgoing call fails with "the tracer store is not initialized because observability has not been enabled", starting with the first model call. Tracing's endpoint and the agent's own Agent Manager API key come from `Config.toml`:

  ```toml
  [ballerinax.amp]
  otelEndpoint = "http://localhost:22893/otel"
  apiKey = "<the tax agent's Agent Manager API key>"
  ```

## The model

The model is Anthropic Claude, reached only through the WSO2 AI Gateway's `boa-llm-v1` LLM proxy (`connections.bal`), never Anthropic directly. It is the same passthrough proxy, with no guardrails, that the Savings Goals agent uses: the agent sees structured figures, never raw user chat.

| Setting | Meaning |
| --- | --- |
| `gatewayBaseUrl` | The LLM proxy's URL, without a trailing slash. The agent calls `<gatewayBaseUrl>/v1/messages`. |
| `gatewayApiKey` | The API key the gateway issued to the `boa-tax-agent` application. It is sent as `x-api-key`, which the proxy's API key policy checks; the gateway then swaps in its own Anthropic key. |
| `llmModel` | The `model` from the repo's `llm_config.yaml` (currently `claude-haiku-4-5`), so this agent uses the same model as the others. |

Only API key authentication to the gateway is supported (the gateway installer's default `AGENT_AUTH_MODE=apikey`). The OAuth mode the Python agents also support is not implemented here.

## Deploy on WSO2 Agent Manager

### 1. Create the agent

In the console, create a **platform-hosted** agent with these settings:

| Field | Value |
| --- | --- |
| Repository | `https://github.com/dan-niles/durable_tax_agent`, branch `main`, path `/` |
| Build type | Ballerina |
| Interface type | Custom API |
| Port | `8014` |
| Base path | `/tax-agent` |
| OpenAPI spec | `/openapi.yaml` |

Or with `amctl` and a manifest:

```yaml
apiVersion: agent-manager.wso2.com/v1alpha1
kind: Agent
spec:
  name: durable-tax-agent
  displayName: Durable Tax Filing Agent
  agentType: {type: agent-api, subType: custom-api}
  provisioning:
    type: internal
    repository: {url: https://github.com/dan-niles/durable_tax_agent, branch: main, appPath: /}
  build: {type: buildpack, buildpack: {language: ballerina}}
  inputInterface: {type: HTTP, port: 8014, basePath: /tax-agent, schema: {path: /openapi.yaml}}
  configurations:
    enableAutoInstrumentation: true
    env:
      - {key: BAL_CONFIG_VAR_BALLERINA_WORKFLOW_URL, value: "<temporal-host>:7233"}
      - {key: BAL_CONFIG_VAR_BALLERINA_WORKFLOW_TASKQUEUE, value: durable-tax-agent-amp}
      - {key: BAL_CONFIG_VAR_GATEWAYBASEURL, value: "<LLM proxy URL>"}
      - {key: BAL_CONFIG_VAR_GATEWAYAPIKEY, value: "<boa-tax-agent API key>", isSensitive: true}
      - {key: BAL_CONFIG_VAR_LLMMODEL, value: claude-haiku-4-5}
      - {key: BAL_CONFIG_VAR_IDPBASEURL, value: "<identity provider URL>"}
      - {key: BAL_CONFIG_VAR_EXPECTEDAUDIENCE, value: "<TAX_AGENT_CLIENT_ID>"}
      - {key: BAL_CONFIG_VAR_COORDINATORSCOPE, value: coordinate_tax_returns}
      - {key: BAL_CONFIG_VAR_CITIZENSCOPE, value: file_tax_return}
      - {key: BAL_CONFIG_VAR_OFFICERSCOPE, value: review_tax_claims}
      - {key: BAL_CONFIG_VAR_REVIEWDEADLINEMINUTES, value: "3"}
```

```bash
amctl agent create -f agent.yaml --project default
```

### 2. Environment variables

Ballerina reads configuration on Agent Manager only from `BAL_CONFIG_VAR_<NAME>` environment variables. A `BAL_CONFIG_VAR_*` variable that nothing reads stops the program at startup, so set only these:

| Variable | Value |
| --- | --- |
| `BAL_CONFIG_VAR_GATEWAYBASEURL` | The LLM proxy URL (see [The model](#the-model)) |
| `BAL_CONFIG_VAR_GATEWAYAPIKEY` | The `boa-tax-agent` API key for that proxy (mark as secret) |
| `BAL_CONFIG_VAR_LLMMODEL` | The `model` from `llm_config.yaml` (currently `claude-haiku-4-5`) |
| `BAL_CONFIG_VAR_IDPBASEURL` | The identity provider that issues the Coordinator's token (see [Authentication](#authentication)) |
| `BAL_CONFIG_VAR_EXPECTEDAUDIENCE` | `TAX_AGENT_CLIENT_ID` from `transactions-agent/.env` |
| `BAL_CONFIG_VAR_COORDINATORSCOPE` | The scope the Coordinator's agent token must carry to start and follow returns, e.g. `coordinate_tax_returns` |
| `BAL_CONFIG_VAR_CITIZENSCOPE` | The scope the citizen's token must carry to sign a filing, e.g. `file_tax_return` (empty for none) |
| `BAL_CONFIG_VAR_OFFICERSCOPE` | The scope an officer's token must carry to review evidence, e.g. `review_tax_claims` |
| `BAL_CONFIG_VAR_REVIEWDEADLINEMINUTES` | How long an officer has to review the evidence, in minutes |
| `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_URL` | Temporal's gRPC address, `<host>:<port>` |
| `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_TASKQUEUE` | A task queue used only by this deployment, for example `durable-tax-agent-amp` |

`LOCAL` mode is the default and connects without TLS, which suits a Temporal dev server. For a server with TLS, also set:

| Variable | Value |
| --- | --- |
| `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_MODE` | `SELF_HOSTED` (or `CLOUD` for Temporal Cloud) |
| `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_NAMESPACE` | The Temporal namespace |
| `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_AUTHAPIKEY` | An API key, as a secret |

TLS is used only when an API key, an mTLS certificate or a CA certificate is set. mTLS certificate files can be added as file mounts. Each mount's `mountPath` is a folder, the file appears at `<mountPath>/<key>`, and each folder holds one file.

Use a separate task queue for each deployment. Two deployments that share a task queue on the same Temporal namespace take each other's work.

### 3. Let Agent Manager reach Temporal

Agent pods can only make outbound calls to public hosts on ports 80 and 443 and to the platform gateway. Port `7233` is blocked. So is the laptop LLM gateway's `8443`: on Agent Manager, `BAL_CONFIG_VAR_GATEWAYBASEURL` must be an LLM gateway the pod can reach on 443, or it needs an egress rule like the one below. For Temporal, choose one:

**A. Temporal behind TLS on port 443 at a public address.** Put Temporal behind a TLS proxy (for example Caddy with `reverse_proxy h2c://127.0.0.1:7233`, or nginx with `grpc_pass`) on a host with a public IP, and set `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_URL` to `<hostname>:443` in `SELF_HOSTED` mode. Protect it with mTLS or an API key: an open Temporal server exposes every run's history and lets anyone start or stop runs.

**B. Allow egress to Temporal (local k3d install).** When Temporal runs on the same machine as a local Agent Manager, add a NetworkPolicy that lets the agent's pod reach it on `7233`.

1. Find the address the cluster uses to reach the Docker host:

   ```bash
   docker network inspect k3d-amp-local --format '{{(index .IPAM.Config 0).Gateway}}'
   ```

   This is the address for Temporal running as a Docker container with `-p 7233:7233`. For Temporal running directly on a macOS host under Rancher Desktop, use `192.168.5.2`.

2. Find the agent's data-plane namespace:

   ```bash
   docker exec k3d-amp-local-server-0 kubectl get ns | grep '^dp-'
   ```

3. Apply the policy, replacing `<namespace>` and `<temporal-ip>`:

   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: allow-temporal-egress
     namespace: <namespace>
   spec:
     podSelector:
       matchLabels:
         openchoreo.dev/component: durable-tax-agent
     policyTypes: [Egress]
     egress:
       - to:
           - ipBlock:
               cidr: <temporal-ip>/32
         ports:
           - port: 7233
             protocol: TCP
   ```

   ```bash
   docker cp allow-temporal-egress.yaml k3d-amp-local-server-0:/tmp/
   docker exec k3d-amp-local-server-0 kubectl apply -f /tmp/allow-temporal-egress.yaml
   ```

   Select the pod by `openchoreo.dev/component`. Agent pods do not carry the `amp.wso2.com/workload=agent` label.

4. Set `BAL_CONFIG_VAR_BALLERINA_WORKFLOW_URL` to `<temporal-ip>:7233`.

When the pod starts, its log shows `Registered the WorkflowKind search attribute`, and Temporal lists the pod as a poller on the task queue:

```bash
temporal task-queue describe --task-queue durable-tax-agent-amp
```

### 4. Tokens for Try It

The console's **Try It** page needs a token for every endpoint except `/health` and the inbox (see [Authentication](#authentication)). `openapi.yaml` declares them as the OAuth2 scheme `ministryAuth`, with the scope each operation needs: `coordinate_tax_returns` for the Coordinator's operations (an agent token), `file_tax_return` to sign a return or read your own (the citizen's token, for the `user_sub` the return was started with), and `review_tax_claims` for the officer's. `authorization` is already among the agent's default allowed CORS headers, so no CORS change is needed.

### 5. Try the durability

1. From the bank's chat, prepare a return that includes professional travel and sign it. The chat reports it filed, with the travel relief provisional.
2. Close the chat. In the Temporal UI the run is still `Running`, waiting on the officer's review and its deadline.
3. Click **Suspend** on the agent's Deploy page, then **Re-deploy** (locally: stop `bal run` and start it again). The new process picks the run up where it was.
4. In the Ministry inbox, reject the evidence, or let the deadline pass. The agent amends the return.
5. Open a new chat and ask how the tax return is going. The run's history shows one `fileReturn`, the officer's review and one `amendReturn`.

## Project layout

| File | Contents |
| --- | --- |
| `workflows.bal` | The `taxAgent` durable agent: prompt, tools, the citizen's signature on `fileReturn`, the officer's `evidenceReview` task and its deadline |
| `functions.bal` | The tax rules, the `assessReturn` tool and the `fileReturn` and `amendReturn` activities |
| `main.bal` | The HTTP service |
| `auth.bal` | JWT validation for the Coordinator's agent token, the citizen's token and the officer's token |
| `ownership.bal` | A return's recorded input (citizen, figures, return number), read from the run's start event |
| `returns.bal` | What the Coordinator, the citizen and the officer read: status, signature step, open claims |
| `decisions.bal` | Recording the citizen's signature and the officer's review, one at a time |
| `inbox_page.bal` | The Ministry of Finance home page and officer workspace |
| `types.bal` | Request, assessment and response types |
| `connections.bal` | The model provider (Anthropic through the LLM gateway) |
| `config.bal` | Configurable values, checked at startup |
| `openapi.yaml` | The API spec Agent Manager uses for Try It |
