# Asgard Assistant (Coordinator)

Source of truth for this agent's A2A card copy. When a tool is added, removed or re-scoped in `langchain-agent/service.py`, or the system prompt in `app/prompt.py` changes what the assistant will do, update this file in the same step.

## Card fields

| Field | Value |
| --- | --- |
| `name` | Asgard Assistant |
| `version` | `1.0.0` (matches `FastAPI(version=...)` in each `service.py`) |
| `provider.organization` | Bank of Asgard |
| `url` | `ws://localhost:8011/chat` in local development — see the caveat below |
| `defaultInputModes` | `text/plain` |
| `defaultOutputModes` | `text/plain` |
| `capabilities.streaming` | `true` — a persistent WebSocket, incremental messages |
| `capabilities.pushNotifications` | `false` |
| `capabilities.stateTransitionHistory` | `false` — history lives in the session, not replayable |

Three implementations exist — `langchain-agent/`, `autogen-agent/` and `strands-agent/` — behind the same `/chat` contract, but they are **not interchangeable for card purposes**: they register different tools, so they offer different skills.

| Skill | langchain | autogen | strands |
| --- | :-: | :-: | :-: |
| `banking-chat` | ✓ | ✓ | ✓ |
| `transaction-review` | ✓ | ✓ | ✓ |
| `profile-management` | ✓ | ✓ | ✓ |
| `spending-analysis` | ✓ | — | — |
| `savings-goal` | ✓ | — | — |
| `tax-return-prep` | ✓ | — | — |

Only the langchain implementation registers `AnalyzeSubscriptions`, `AnalyzeSpendingHealth`, `SuggestSavingsGoal` and the two tax tools. Publish the six-skill card only for a langchain deployment; autogen and strands get the top three. Model choice is deployment configuration (`llm_config.yaml`), not a card field.

## description

The customer-facing banking assistant for Bank of Asgard. It answers general questions about branches, products and services without authentication, and — once the customer authorises it — reviews their transaction history, analyses their spending, manages their profile, and coordinates two specialist agents on their behalf: one that proposes savings goals, one at the Ministry of Finance that drafts a tax return.

It is the only agent in the estate that talks to the customer directly, and the only one that holds a session. Everything it does with account data runs under the customer's own consent, delegated per action: reading transactions, reading the profile, updating the profile and sharing tax figures each require a separate authorisation, so consent to one is never consent to another.

It presents results as prose or formatted lists, never raw JSON, in British English. It will not discuss a customer's date of birth under any circumstances, and it will not speculate about data no tool returned.

*The paragraph above describes a langchain deployment. For autogen or strands, drop the clauses about analysing spending and coordinating specialist agents — those tools are not registered.*

## Skills

### `banking-chat`

**name:** General banking assistance

**description:** Answers questions about Bank of Asgard products, services and branch locations, including opening hours, phone numbers and services offered near a named town. Requires no authentication.

**tags:** `banking`, `customer-service`, `branch-locator`, `unauthenticated`

**examples:** "Where's my nearest branch in Oslo?" · "What are your opening hours in Bergen?" · "What accounts do you offer?"

### `transaction-review`

**name:** Review transactions

**description:** Retrieves and explains the customer's own transaction history, filtered by date range, type (debit, credit, transfer) and count. Groups by category with totals, highlights the largest purchase or most frequent merchant, and answers follow-up questions about the data already retrieved.

**tags:** `transactions`, `account-activity`, `spending`, `requires-consent`

**examples:** "Show me last month's transactions" · "What did I spend on groceries in January?" · "What was my biggest purchase this quarter?"

### `spending-analysis`

**name:** Analyse spending and subscriptions

**description:** Two related analyses over the customer's own history: a scan of the past year for recurring monthly subscriptions, including ones that are easy to forget, and a category-by-category comparison of the last ~45 days against the prior ~45 days. Together these form the "financial check-up".

**tags:** `spending-analysis`, `subscriptions`, `financial-wellbeing`, `requires-consent`

**examples:** "Give me a financial check-up" · "Am I paying for anything I've forgotten about?" · "How has my spending changed recently?"

*langchain implementation only.*

### `savings-goal`

**name:** Suggest a savings goal

**description:** Takes money identified as recoverable — typically forgotten subscriptions — and delegates to the Savings Goals Agent, returning a named goal, projected balances at 1, 5 and 10 years, and a recommendation. A real cross-process agent call.

**tags:** `savings`, `goal-setting`, `projections`, `delegation`

**examples:** "What could I do with the money from those subscriptions?" · "Turn that into a savings goal"

*langchain implementation only.*

### `tax-return-prep`

**name:** Prepare a draft tax return

**description:** Classifies the customer's transactions for the tax year into the Ministry of Finance's four relief categories and totals each, then — only after the customer agrees to share the figures — sends the per-category totals to the ministry's Tax Filing Agent and returns the draft assessment: deductions, taxable income, estimated saving, receipts still needed and the filing deadline. Only the aggregates cross the organisational boundary; no transaction detail leaves the bank.

**tags:** `tax`, `deductions`, `cross-organisation`, `requires-consent`, `delegation`

**examples:** "Can you help me with my tax return?" · "How much tax relief am I entitled to?" · "Estimate my tax for this year"

*langchain implementation only.*

### `profile-management`

**name:** View and update profile

**description:** Shows the customer's profile — first name, last name, email, mobile, country, account type — and updates first name, last name, country and mobile on request. Email requires a separate verification flow; date of birth and account type cannot be changed here. Reading and updating are separately consented.

**tags:** `profile`, `self-service`, `requires-consent`

**examples:** "What's my registered mobile number?" · "Change my country to Norway" · "Update my surname"

## Security

Unlike the two specialist agents, this one is **not** protected by a bearer token at the transport. The customer authenticates through Asgardeo in the browser, and the assistant then obtains a separate on-behalf-of token per action, each with its own scope and its own consent prompt:

| Action | Token type | Scope |
| --- | --- | --- |
| Read transactions, subscription and spending analysis | OBO | `read_transactions` |
| Read profile | OBO | SCIM2 self-service read |
| Update profile | OBO | SCIM2 self-service write (`/scim2/Me`, not the admin scope) |
| Summarise deductible spend | OBO | tax consent scope |
| Call the Savings Goals Agent | agent token | audienced for `SAVINGS_AGENT_CLIENT_ID` |
| Call the Tax Filing Agent | agent token | audienced for `TAX_AGENT_CLIENT_ID` |
| Call the Agencies MCP server | agent token | audienced for the MCP client ID |

Two consequences worth putting on the card: consent is **per action, not per session**, so a card that advertises `transaction-review` is advertising a capability the customer must still approve at use time; and the downstream agents authorise this agent by audience, so its identity is provable to them.

## Which skills to advertise

The accurate skill list for a given deployment depends on configuration as well as implementation: `GetAgencies` is registered only when the MCP client ID is set, `SuggestSavingsGoal` only when `SAVINGS_AGENT_CLIENT_ID` is set, and the tax tools only when `TAX_AGENT_CLIENT_ID` is set. Generate the card's `skills` array from the same config the service reads at startup rather than hardcoding all six — an advertised skill the agent cannot perform is worse than an unadvertised one.

Every account-specific skill here is gated on interactive consent: the OBO flow assumes a human in a browser approving each action. That shapes the card content, not just the plumbing — these skills cannot be promised to an unattended caller on the strength of the card alone, and the `description` text should not imply otherwise.

## Deferred: A2A transport

The endpoint is a WebSocket at `/chat` carrying `{"type": "message", "content": "..."}` frames, not an A2A transport. Transport, a served card and a public `url` come later — the content above is what the card will be filled from. Confirm the field names against the A2A spec revision in force when that work starts.
