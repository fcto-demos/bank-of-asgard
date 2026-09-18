# Tax Filing Agent

Source of truth for this agent's A2A card copy. When `server.py` or `tax_rules.py` changes what the agent can do or which reliefs it grants, update this file in the same step.

## Card fields

| Field | Value |
| --- | --- |
| `name` | Tax Filing Agent |
| `version` | `1.0.0` (matches `FastAPI(version=...)` in `server.py`) |
| `provider.organization` | Ministry of Finance, Kingdom of Asgard |
| `url` | `http://localhost:8014` in local development |
| `defaultInputModes` | `application/json` |
| `defaultOutputModes` | `application/json`, `text/plain` |
| `capabilities.streaming` | `false` — one request, one complete response |
| `capabilities.pushNotifications` | `false` |
| `capabilities.stateTransitionHistory` | `false` |

Note that this agent belongs to a **different organisation** from the bank-side agents. A call to it is a cross-organisation hop, and that is the point of its existence in the demo — the card should name the ministry as provider, not the bank.

## description

Prepares a draft income tax assessment for the Kingdom of Asgard from per-category spend totals. Given a citizen's gross income and how much they spent in each published relief category, it applies the statutory rates and caps, works out total deductions, taxable income, tax before and after reliefs, the resulting saving and the citizen's marginal rate, then writes a plain-language summary and returns a draft reference.

Every figure comes from published rules applied in ordinary arithmetic: a progressive bracket table (0% to 12,000; 20% to 30,000; 35% to 60,000; 45% above) and four per-category relief rules with fixed rates and annual caps. The language model receives the finished assessment and explains it; it never computes, restates or rounds a number. The ministry can therefore say exactly which rule produced any figure and reproduce it on demand.

The agent grants relief only for categories it publishes. An unrecognised category is ignored rather than guessed at.

## Relief categories

| Category | Label | Rate | Annual cap | Receipts needed |
| --- | --- | --- | --- | --- |
| `medical` | Medical and health expenses | 50% | 1,500 | no |
| `commuting` | Commuting relief | 30% | 900 | no |
| `home_energy` | Home office and energy relief | 20% | 600 | no |
| `professional_travel` | Professional travel | 25% | 1,200 | **yes** |

Tax year 2026; filing deadline 2027-04-30. These must stay in step with the bank-side mapping in `transactions-agent/app/tax.py`.

## Skills

### `prepare-tax-return`

**name:** Prepare a draft tax return

**description:** Produces a draft income tax assessment from a citizen's gross income and their qualifying spend per relief category. Returns the reliefs granted (with the rate, cap and whether the cap bound), total deductions, taxable income, tax before and after reliefs, estimated saving, marginal rate, any categories still requiring receipts, the filing deadline and a draft reference. Categories outside the published list are ignored.

**tags:** `tax`, `government`, `assessment`, `deductions`, `tax-relief`, `cross-organisation`

**inputModes:** `application/json` · **outputModes:** `application/json`

**examples:**

- "Gross income 52,000 with 900 medical and 1,400 commuting spend — what's the draft assessment?"
- "How much tax would these reliefs save, and does anything need receipts?"
- "Prepare a draft return for the 2026 tax year from these category totals."

## Security

Bearer JWT, validated on every route except `/health`. The token's RS256 signature is checked against the IDP's JWKS and its `aud` claim must equal this service's `EXPECTED_AUDIENCE` — the agent's own client ID, which the bank side configures as `TAX_AGENT_CLIENT_ID`. No scopes are required: authorisation is audience-based, so a token minted *for this agent* is itself the access decision, and the ministry can prove which agent called it.

In A2A terms: a `securityScheme` of type `oauth2` with the `clientCredentials` flow and an empty `scopes` object.

Callers should forward `X-Transaction-Id` for audit and trace correlation; it is accepted in the body as well. `user_sub` identifies the citizen whose consented data is being delegated and is recorded for audit only.

## Data minimisation — worth stating on the card

The request carries gross income, one total per relief category, and optionally a tax ID. It carries **no transaction list, no merchant names, no dates and no account identifiers**. The bank classifies spend into the ministry's categories on its own side and sends only the aggregates. Any caller integrating against this agent should preserve that boundary.

## What a caller actually gets back

- `headline` — a short summary line
- `message` — plain-language explanation of the assessment
- `assessment` — the full structured result: `reliefs[]`, `total_deductions`, `taxable_income`, `tax_before_reliefs`, `tax_after_reliefs`, `estimated_saving`, `marginal_rate`, `evidence_needed[]`, `tax_year`, `filing_deadline`
- `reference` — e.g. `ASG-2026-DRAFT`

If the model's reply will not parse as JSON, `headline` falls back to "Draft tax return prepared" and `message` carries the raw text. The `assessment` block is unaffected — it never passes through the model.

## Deferred: A2A transport

The service speaks plain REST (`POST /prepare-return`), not A2A. Transport, a served card and a public `url` come later — the content above is what the card will be filled from. Confirm the field names against the A2A spec revision in force when that work starts.
