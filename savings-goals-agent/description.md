# Savings Goals Agent

Source of truth for this agent's A2A card copy. When `server.py` or `projections.py` changes what the agent can do, update this file in the same step.

## Card fields

| Field | Value |
| --- | --- |
| `name` | Savings Goals Agent |
| `version` | `1.0.0` (matches `FastAPI(version=...)` in `server.py`) |
| `provider.organization` | Bank of Asgard |
| `url` | `http://localhost:8013` in local development |
| `documentationUrl` | `savings-goals-agent/openapi.yaml` |
| `defaultInputModes` | `application/json` |
| `defaultOutputModes` | `application/json`, `text/plain` |
| `capabilities.streaming` | `false` — one request, one complete response |
| `capabilities.pushNotifications` | `false` |
| `capabilities.stateTransitionHistory` | `false` |

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

Bearer JWT, validated on every route except `/health`. The token's RS256 signature is checked against the IDP's JWKS and its `aud` claim must equal this service's `EXPECTED_AUDIENCE` — the agent's own client ID. No scopes are required: authorisation here is audience-based, so possession of a token minted *for this agent* is the access decision.

The only configured caller is the Bank of Asgard Coordinator, which presents an agent token audienced for `SAVINGS_AGENT_CLIENT_ID`. In A2A terms this is a `securityScheme` of type `oauth2` with the `clientCredentials` flow and an empty `scopes` object.

Optionally, if `INBOUND_API_KEY` is set, a caller may instead present that value on the `X-API-Key` header (configurable via `INBOUND_API_KEY_HEADER`) — this is an alternative to the bearer JWT above, not a replacement, and is checked with a constant-time comparison. It exists for third-party callers that can't be issued OAuth client credentials for this agent. Left unset (the default), only bearer JWTs are accepted. In A2A terms this adds a second `securityScheme` of type `apiKey` (`in: header`, `name: X-API-Key`); either scheme independently satisfies the request.

Callers should forward `X-Transaction-Id` so this agent's audit events and traces correlate with the calling session; the field is also accepted in the request body. `user_sub` identifies whose consented data is being delegated and is decoded by the caller from the user's OBO token — it is recorded for audit and never used to fetch anything.

## What a caller actually gets back

- `goal_name` — a proposed name, e.g. "Asgard Vault — Rainy Day Fund"
- `suggested_monthly_amount` — echoes the requested monthly figure
- `projected_balances` — `1y`, `5y`, `10y`
- `message` — 3–5 sentences, warm in tone, citing the projections verbatim

If the model returns something that will not parse as JSON, the agent degrades rather than fails: `goal_name` falls back to "Savings Goal" and `message` carries the raw text.

## Deferred: A2A transport

The service speaks plain REST (`POST /suggest-goal`), not A2A. Transport, a served card and a public `url` come later — the content above is what the card will be filled from. Confirm the field names against the A2A spec revision in force when that work starts.
