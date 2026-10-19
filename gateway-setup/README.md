# Installing Bank of Asgard on an existing WSO2 AI Gateway

`gateway-setup/` provisions everything Bank of Asgard needs on a WSO2 AI Gateway you already run, through the AI Workspace control plane (Platform API). One command creates the LLM proxies, guardrails, applications, API keys, the agencies MCP proxy and the transactions REST API, deploys them to the gateways you name, checks that each one answers, and writes the matching settings for each agent.

It is plain Python 3 (standard library only, Python 3.9+): nothing to install.

## What gets created

All ids and contexts start with `RESOURCE_PREFIX` (default `boa`), and everything goes into the project you choose (`PROJECT_ID`).

| Resource | Id / context | Deployed to | Purpose |
|---|---|---|---|
| LLM provider | `boa-anthropic` (or `boa-bedrock`) | LLM gateways | Upstream connection and key. Skipped when you reuse one with `EXISTING_LLM_PROVIDER_ID`. |
| LLM proxy v1 | `boa-llm-v1` at `/boa-llm-v1` | LLM gateways | Passthrough, no guardrails: `GATEWAY_BASE_URL` |
| LLM proxy v2 | `boa-llm-v2` at `/boa-llm-v2` | LLM gateways | Guardrails (below): `GATEWAY_BASE_URL_SECURED`, used when the chat's **AI Guardrails** toggle is on |
| Applications | `boa-transactions-agent`, `boa-savings-goals-agent`, `boa-tax-agent` | — | One per service, each with its own API keys |
| MCP proxy | `boa-agencies-mcp` at `/boa-agencies` | MCP gateways | `agencies-mcp-server` (Streamable HTTP, `/mcp`): `MCP_GATEWAY_URL` |
| REST API | `boa-transactions-api` at `/boa-transactions` | API gateways | `transactions-api`, all operations of `transactions-api/openapi.yaml`: `TRANSACTIONS_API_BASE_URL` |

LLM and MCP traffic can go to different gateways, and each list can name several gateways. The agents are pointed at the first gateway of each list.

Both proxies also carry `llm-cost` (turn it off with `PROXY_LLM_COST=false`). It prices every call from the gateway's `model_prices.json` and records the cost in the request's analytics metadata as `x-llm-cost` (USD). That's where Moesif, or any other analytics publisher, finds it; it's never sent back in a response header. A provider created by the installer carries `llm-cost` too. A reused provider is never written, so `--check` warns if it lacks one. A cost budget on a proxy needs the proxy's own `llm-cost`: the provider's runs on the request the proxy forwards to it, and its result never reaches the proxy.

### v2 guardrails

Applied in this order. `V2_GUARDRAILS` picks which ones; their exact parameters live in [resources.json](resources.json), with notes on each choice.

| Name | Policy | What it does |
|---|---|---|
| `log-request` | `log-message` | Logs each request's headers and payload to the gateway runtime log, as it arrived. Useful in the demo to show what the agent sends, tool results and the `x-boa-message` header included. Credential headers (`Authorization`, `X-API-Key`, `Cookie`) are excluded. The payload is logged before `pii` runs, so the log does contain the unredacted date of birth. Leave this step out where that matters. |
| `length` | `content-length-guardrail` | Limits what the user typed to 1–10,000 bytes. This replaces the agents' own 4,000-character message cap, which they skip when the gateway is on. The minimum stays at 1 so short replies like "yes" pass. Applies only to what the user typed (see "Guardrails and agent tool turns"). |
| `content-safety` | `azure-content-safety-content-moderation` or `aws-bedrock-guardrail` | Hate, sexual, self-harm and violence moderation. `CONTENT_SAFETY=azure\|bedrock` picks the service. Azure checks both what the user typed and the model's text replies. Requests and replies without text (tool results, tool calls) pass through unchecked. |
| `topic` | `semantic-prompt-guard` | Keeps the conversation on banking by meaning. An allow list (what the assistant does, plus normal dialogue such as "yes, go ahead" or "what about another city?") at a low threshold stops clearly unrelated requests, and a deny list of sports sentences refuses the demo's off-topic subject. On 44 test questions, no banking question or follow-up was blocked. A similarity threshold alone isn't precise topic control, so borderline requests are left to the agent's own instructions. Applies only to what the user typed (see "Guardrails and agent tool turns"). |
| `injection` | `regex-guardrail` | Blocks "ignore your previous instructions" style overrides and "you are now an unrestricted…" personas, anywhere in the request. |
| `pii` | `pii-masking-regex` | Redacts the customer's date of birth anywhere in the request, including the `get_my_profile` tool result, so the model never sees it. |
| `log-response` | `log-message` | Logs each response's headers and payload, including a guardrail's verdict when a request was blocked. |

## Prerequisites

The installer configures resources. It does not build gateway images or edit gateway configuration, so the gateway has to bring the following.

**1. WSO2 AI Gateway 1.2 or later, managed by AI Workspace.** Each gateway must be registered and active in the control plane. You need an AI Workspace admin login.

**2. A gateway image with these policies.** `--check` reads each gateway's policy manifest and reports any that are missing.

| Needed for | Policies |
|---|---|
| Always (LLM) | `api-key-auth` (apikey mode) or `jwt-auth` (oauth mode); `llm-cost` (unless you reuse a provider) |
| v2 guardrails | `content-length-guardrail`, `regex-guardrail`, `semantic-prompt-guard`, `azure-content-safety-content-moderation` and/or `aws-bedrock-guardrail`, `pii-masking-regex` |
| Optional | `mcp-auth` (`MCP_AUTH=mcp-auth`), `jwt-auth` (`API_AUTH=jwt-auth`) |

**3. Gateway `config.toml` settings,** depending on what you enable:

- `topic`: an embedding provider (`embedding_provider*` settings, and its API key in the gateway's environment).
- `content-safety`: either `azurecontentsafety_endpoint` / `azurecontentsafety_key`, or `awsbedrock_guardrail_*` (region, guardrail id and version, credentials).
- oauth mode, `mcp-auth` or `jwt-auth`: a `[[policy_configurations.jwtauth_v1.keymanagers]]` entry for your identity provider. Its `name` goes into `JWT_KEY_MANAGER`.

Leave a guardrail out of `V2_GUARDRAILS` if your gateway lacks its setting. Some policies, attached without their settings, make the gateway fail every request on that route.

**4. Network.** The gateways run in containers while `agencies-mcp-server` (8012) and `transactions-api` (8010) run on your machine, so the gateways must be able to reach them:

- Set `UPSTREAM_HOST` to how containers reach your machine: `host.docker.internal` for Docker Desktop and Rancher Desktop (the default) or `host.containers.internal` for Podman. On Linux Docker, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the gateway runtime service.
- Docker Desktop and Rancher Desktop forward `host.docker.internal` to your machine's loopback, so the services' default `127.0.0.1` binding works. Elsewhere (Linux Docker, Podman), or if the install reports the backend unreachable, start them listening on all interfaces: `BIND_HOST=0.0.0.0 ./demo_scripts/start-demo.sh <agent>`.
- If the gateways share a Docker network with the containerised services (`docker-compose.yml`), point `AGENCIES_MCP_UPSTREAM` and `TRANSACTIONS_API_UPSTREAM` at the container names instead.

## Install

```bash
# 1. Settings: the first run creates gateway-setup/gateway.env (gitignored) from the example.
export ADMIN_PASSWORD='...'                          # AI Workspace admin password
./gateway-setup/provision.py --list-targets          # projects and gateway ids
$EDITOR gateway-setup/gateway.env                    # AIW_URL, PROJECT_ID, *_GATEWAY_IDS, provider key...

# 2. Read-only pre-flight: settings, project, gateways, policies, id/context collisions
./gateway-setup/provision.py --check

# 3. Install (idempotent: run it again after any change)
./gateway-setup/provision.py --write-env             # --env-file .env.is to update a start-demo profile
```

Then:

1. Set `gateway.enabled: true` in `llm_config.yaml`.
2. Start the demo with `BIND_HOST=0.0.0.0 ./demo_scripts/start-demo.sh <agent>`.

Without `--write-env`, the settings are only written to `gateway-setup/out/<service>.env` for you to merge by hand. These files hold API keys and are private (mode 600, gitignored).

Useful options:

| Option | Effect |
|---|---|
| `--only llm,mcp,api` | Install just some parts. By default the LLM part always runs, and MCP and the REST API run when their gateway lists are set. |
| `--create-project` | Create `PROJECT_ID` if it does not exist. |
| `--rotate-keys` | Issue new API keys. Otherwise a key from a previous run is kept as long as the gateway accepts it, so re-running never breaks running agents. |
| `--force` | Overwrite resources with our ids that the installer did not create. `--check` reports these as blockers. |

### What `--write-env` sets

| Service | Variables |
|---|---|
| `transactions-agent` | `GATEWAY_BASE_URL`, `GATEWAY_BASE_URL_SECURED`, `GATEWAY_AUTH_MODE`, `GATEWAY_API_KEY`, `GATEWAY_API_KEY_SECURED`, `MCP_GATEWAY_ENABLED`, `MCP_GATEWAY_URL`, `TRANSACTIONS_API_BASE_URL` |
| `savings-goals-agent`, `tax-agent` | `GATEWAY_BASE_URL`, `GATEWAY_AUTH_MODE`, `GATEWAY_API_KEY` |
| `server` | `TRANSACTIONS_API_URL` |

Each file's previous version is kept as `<file>.gateway.bak`.

If the gateway uses a self-signed certificate, add `SSL_CERT_FILE=<its CA>` to the agents' `.env` files.

## Agent authentication

- **`AGENT_AUTH_MODE=apikey` (default).** Each proxy requires `X-API-Key`. The installer issues one key per service and per proxy and links each key to the service's application, so the gateway's analytics attribute traffic per agent. The transactions agent gets separate v1 and v2 keys.
- **`AGENT_AUTH_MODE=oauth`.** The proxies carry `jwt-auth` against `JWT_KEY_MANAGER`. The agents keep fetching client-credentials tokens: set `GATEWAY_TOKEN_ENDPOINT`, `GATEWAY_CLIENT_ID` and `GATEWAY_CLIENT_SECRET` from an application in that identity provider.

For MCP and the REST API, the gateway forwards the caller's own token by default (`MCP_AUTH=passthrough`, `API_AUTH=passthrough`), and `agencies-mcp-server` and `transactions-api` validate it as they always do. Set `mcp-auth` or `jwt-auth` to have the gateway validate it as well.

## Verify

The install finishes by probing each gateway:

| Check | Expected result |
|---|---|
| Each API key | Accepted by the gateway. |
| v2 | Lets an ordinary banking question through and blocks a prompt injection. |
| v2 with a tool-result turn | Does not block it (see the next section). |
| MCP proxy and REST API | Reach their backends. A 502/503 means the gateway cannot connect; see Network above. |

Then, in the app:

1. Open the transactions chat.
2. Ask for your profile with **AI Guardrails** on: the date of birth comes back redacted.
3. Ask the same with the toggle off: the date of birth is shown.
4. Try "ignore your previous instructions…" with the toggle on: the gateway blocks it.

## Guardrails and agent tool turns

The agents call the LLM in a loop: after each tool call, the next request ends with a message carrying the tool's result. That message is a list of content blocks, not plain text.

`semantic-prompt-guard` and the content-safety policies read the text at `$.messages[-1].content`, the last message. When that value is not a string, the AI Gateway policies reject the request (422, `Error extracting value from JSONPath`). Without a fix, every v2 chat that uses a tool would fail on its second request.

How each guardrail deals with it:
- **`injection` and `pii`** read the whole request body instead (`jsonPath "$"`), so the shape of the last message doesn't matter. That's also what lets `pii` redact the date of birth inside a tool result.
- **`length` and `topic`** run only on requests whose last message is the user's own text. The transactions agent tags every LLM request with an `x-boa-message` header: `user-text`, `tool-result` or `content-blocks` (see `message_kind` in [transactions-agent/app/gateway.py](../transactions-agent/app/gateway.py)). The two policies carry an execution condition on it:

  ```
  'x-boa-message' in request.Headers && request.Headers['x-boa-message'][0] == 'user-text'
  ```

  Everything the user types is checked, and tool follow-ups pass.
- **Azure `content-safety`** moderates both directions, so it can't use the condition: the condition would also apply to the response side and skip the final answers, which come right after tool calls. Instead it uses `passthroughOnError: true`. Anything with text (what the user typed, the model's text replies) is moderated and blocked at the thresholds. Tool-result requests and tool-call-only replies are skipped instead of rejected, and so is everything while Azure is unreachable. The Bedrock variant moderates requests only, using the condition.

Notes from AI Gateway 1.2.1:
- Conditions are CEL. Header access is `request.Headers['name'][0]`. The documented `request.header.x-name` form doesn't compile and makes the route fail with 500.
- `request.Body` is empty in conditions, so the body can't be inspected and the agent-side header is needed.
- Tool output itself (MCP server and API results) isn't moderated by these two policies, because the policies can't read content blocks.

**Agent frameworks.** langchain and autogen send typed messages as plain strings. Strands sends them as content blocks (`content-blocks`), so with strands, `topic` and `content-safety` don't run at all.

The installer checks this on your gateway: it sends a tool-result request tagged `tool-result` and warns if v2 still rejects it.

## Provider exposure

Every LLM proxy forwards its traffic through its provider's own route on the gateway (e.g. `/anthropic`). An open provider route (`allow_all`, no security) lets anyone who can reach the gateway's port call the LLM directly, with no key, using the stored upstream API key. Setting the provider to `deny_all` isn't an option: it also blocks the proxies' forwarded traffic, which then gets 404s.

**Providers the installer creates are locked down instead:**
1. The provider requires its own API key, in the `X-Provider-Key` header (`PROVIDER_KEY_HEADER`).
2. The installer issues that key, keeps it in `out/state.json`, and has each proxy add it to forwarded calls with a `set-headers` policy. The step comes last in the chain, so request logs never record it, and the logs exclude the header anyway.
3. Agents never see this key.

Verified on AI Gateway 1.2.1:
- proxy calls work;
- calling the provider directly fails with 401, with or without a proxy key;
- the gateway removes `X-Provider-Key` before the upstream sees it.

**A reused provider (`EXISTING_LLM_PROVIDER_ID`) is never modified.** To lock one:
1. Turn on its API-key security with header `X-Provider-Key`.
2. Issue it a key: `POST /llm-providers/{id}/api-keys`.
3. Put the key in `EXISTING_PROVIDER_KEY`. The installer then adds `set-headers` to its proxies.

Every other proxy routed through that provider (other projects' too) needs the same header, or it stops working.

`--check` and the post-install verification probe the provider route without credentials, and warn if it answers. While a provider is open, keep the gateway ports off untrusted networks: bind them to `127.0.0.1` in the gateway's compose file (`127.0.0.1:8443:8443`, and the plain-HTTP `8080` mapping too), or firewall them.

## Remove

```bash
./gateway-setup/teardown.py --dry-run     # what would go
./gateway-setup/teardown.py               # undeploy and delete
```

Teardown only removes resources whose description carries the installer's marker, unless you pass `--force`. It never deletes a provider you reused, or the project.

Afterwards:
- Set `gateway.enabled: false` in `llm_config.yaml`.
- Set `MCP_GATEWAY_ENABLED=false`, or restore the `.env.gateway.bak` backups.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `login ... failed` with a certificate error | Set `TLS_CA_FILE` to the AI Workspace CA. `TLS_VERIFY=false` works for throwaway local setups only. |
| `BLOCKER ... image lacks: <policy>` | Rebuild the gateway image with that policy, or drop the guardrail from `V2_GUARDRAILS`. |
| `COLLISION` / `not created by gateway-setup` | Another resource already uses that id or context. Change `RESOURCE_PREFIX`. |
| MCP or REST API probe: 502/503 | The gateway cannot reach the backend. Check `UPSTREAM_HOST`, start the services with `BIND_HOST=0.0.0.0`, check the firewall. |
| Probes report "no answer from the gateway" | The endpoint the control plane records isn't reachable from your machine. Set `LLM_GATEWAY_URL` / `MCP_GATEWAY_URL` / `API_GATEWAY_URL` (e.g. `https://localhost:8443`). |
| Every v2 request fails with 500 | A guardrail is attached without its `config.toml` setting (embedding provider, content-safety credentials). |
| Agent shows "blocked by an AI guardrail policy" on normal questions | Read the reason. If it says `Error extracting value from JSONPath`, a guardrail is reading the last message without the `x-boa-message` condition. See "Guardrails and agent tool turns". |
| Every v2 request fails with 500 after editing a policy's condition | The CEL expression doesn't compile. The gateway runtime log shows `failed to compile CEL expression`. Use `request.Headers['…'][0]`. |
