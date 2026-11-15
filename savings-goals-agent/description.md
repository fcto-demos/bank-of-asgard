# Savings Goals Agent

Source of truth for this agent's A2A card copy. The served card is built in `a2a_server.py` (`build_agent_card`) from this text. When `server.py`, `a2a_server.py` or `projections.py` changes what the agent can do, update this file and the card in the same step.

## Card fields

A2A 1.0 field names, as the card at `/.well-known/agent-card.json` serves them.

| Field | Value |
| --- | --- |
| `name` | Savings Goals Agent |
| `version` | `1.1.0` (`AGENT_VERSION` in `server.py`, also the FastAPI version) |
| `provider.organization` | Bank of Asgard |
| `supportedInterfaces` | `JSONRPC` at `A2A_PUBLIC_URL` (default `http://localhost:8013`), then `HTTP+JSON` at `A2A_PUBLIC_URL/v1`, both `protocolVersion: 1.0`. Behind the gateway's agent proxy, the gateway rewrites both to its own URL. |
| `defaultInputModes` | `application/json` |
| `defaultOutputModes` | `application/json`, `text/plain` |
| `capabilities.streaming` | `false`: one request, one complete response |
| `capabilities.pushNotifications` | `false` |

## description

Turns money a customer could stop spending into a concrete, named savings goal. Given a summary of recurring subscriptions, a summary of spending health, and the total monthly amount recoverable, it names a goal, projects what that amount becomes after 1, 5 and 10 years of monthly saving, and writes a short encouraging recommendation the customer can act on.

The projections are computed arithmetically — future value of a monthly annuity at 3% APY, compounded monthly — and the language model is given those figures to explain, never to calculate. A caller can therefore reproduce every number the agent reports without re-running the model.

The agent is stateless. It holds no customer record, performs no lookup of its own, and sees only the summaries the caller passes in. It never receives a transaction list, a merchant name, or an account identifier.

## Skills

### `suggest-savings-goal`

**name:** Suggest a savings goal

**description:** Proposes a named savings goal from an amount the customer could redirect into savings each month, with projected balances at 1, 5 and 10 years and a short motivating recommendation. Expects the two natural-language summaries produced upstream (recurring subscriptions, spending health) plus the monthly recoverable figure; returns the goal name, the monthly amount, the three projections, and the recommendation text.

**tags:** `personal-finance`, `savings`, `goal-setting`, `projections`, `financial-wellbeing`

**inputModes:** `application/json` · **outputModes:** `application/json`

**examples:**

- "Three forgotten subscriptions come to 47.97 a month and spending is up 8% on dining — what savings goal should we suggest?"
- "The customer can free up 120 a month. Name a goal and show what it's worth over ten years."
- "Give me a goal, the 1/5/10-year projections, and a message I can show the customer."

## Security

Bearer JWT, validated on every route except `/health` and the Agent Card, which is public by A2A design. The token's RS256 signature is checked against the IDP's JWKS, and its `aud` claim must equal this service's `EXPECTED_AUDIENCE`, the agent's own client ID. No scopes are required: authorisation is audience-based, so holding a token minted *for this agent* is the access decision.

The only configured caller is the Bank of Asgard Coordinator, which presents an agent token audienced for `SAVINGS_AGENT_CLIENT_ID`. The card declares this as `securitySchemes.agentToken`, an `httpAuthSecurityScheme` with `scheme: Bearer` and `bearerFormat: JWT`, whose description names the IDP's token endpoint. It is HTTP bearer rather than `oauth2` with the `clientCredentials` flow: an oauth2 flow needs a non-empty `scopes` map, and this agent checks none.

Optionally, if `INBOUND_API_KEY` is set, a caller may instead present that value on the `X-API-Key` header (configurable via `INBOUND_API_KEY_HEADER`). It is an alternative to the bearer JWT, not a replacement, and is checked with a constant-time comparison. It exists for third-party callers that can't be issued OAuth client credentials for this agent. Left unset (the default), only bearer JWTs are accepted. When it is set, the card adds `securitySchemes.apiKey`, an `apiKeySecurityScheme` with `location: header` and `name: X-API-Key`. `securityRequirements` lists the two schemes as separate entries, so either one satisfies the request.

Callers should forward `X-Transaction-Id` so this agent's audit events correlate with the calling turn. The field is also accepted in the message's data part. For tracing, send the standard W3C `traceparent` header, so this agent's spans join the caller's trace, and a `baggage` header carrying `gen_ai.conversation.id`. `user_sub` identifies whose consented data is being delegated and is decoded by the caller from the user's OBO token — it is recorded for audit and never used to fetch anything.

## What a caller actually gets back

- `status` — `ok`
- `goal_name` — a proposed name, e.g. "Asgard Vault — Rainy Day Fund"
- `suggested_monthly_amount` — echoes the requested monthly figure
- `projected_balances` — `1y`, `5y`, `10y`
- `message` — 3–5 sentences, warm in tone, citing the projections verbatim

If the model returns something that will not parse as JSON, the agent degrades rather than fails: `goal_name` falls back to "Savings Goal" and `message` carries the raw text.

`DEMO_VERSION=v2` is a demo-only rogue mode: the agent never proposes a goal and always answers `status: needs_more_info` with `questions`, so a monitoring product can catch a runaway agent. It is not a capability, and stays out of the card.

## A2A transport

A2A 1.0 over a2a-sdk 1.x (`a2a_server.py`), on the same FastAPI app and port as before:

- `GET /.well-known/agent-card.json`: the card, public.
- `POST /`: the JSON-RPC binding.
- `POST /v1/message:send` and the rest of `/v1/...`: the HTTP+JSON binding.

Every operation request needs `A2A-Version: 1.0`; without it, the SDK answers with a version error. A request is one `SendMessage` whose message has a single data part, holding the fields the REST body had: `subscription_summary`, `spending_summary`, `monthly_recoverable`, and optionally `user_sub` and `transaction_id`. A missing or invalid field returns JSON-RPC `-32602` (invalid params). The reply is a single `Message`, never a `Task`. Its data part carries the fields listed above, and a text part carries `message`.

`POST /suggest-goal` still serves the same request as plain REST (documented in `openapi.yaml`) for callers not on A2A yet; the Coordinator no longer uses it.
