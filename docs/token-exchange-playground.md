# Token Exchange Playground — Design (for review)

**Status:** Draft for review · **Scope:** Phase 1 = OBO, interactive · ID-JAG deferred to a later phase.

An interactive, xaa.dev-style webpage for Bank of Asgard that lets you **step through the OBO token exchange live** against the real Asgardeo IdP, inspecting the actual HTTP request/response and decoded JWT claims at each step. Modeled on Okta's [Cross-App Access playground](https://developer.okta.com/blog/2026/01/20/xaa-dev-playground) (three roles — Requesting App / Identity Provider / Resource App — and a four-step guided flow with per-step request/response inspection), but wired to our own agent, IdP, and Transactions API.

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Backend host | **New standalone demo service** (`token-playground/`, FastAPI, port 8014) | Isolated, independently demoable, matches the Python/FastAPI stack of the other services. |
| Fidelity | **Transparent direct HTTP** (`httpx` calls to the IdP token endpoint) | The whole point is teaching the protocol — the inspector shows the exact wire request/response, like xaa.dev. |
| Protocol | **The current OBO protocol the code already uses** (see below) | Faithful to production behavior; ID-JAG comes later as an additional flow, not a replacement. |
| Frontend location | **(open)** Recommended: a page inside the existing BOA React app, reusing the logged-in Asgardeo session for the user subject. Alternative: fully self-contained mini-app with its own login. | Embedded reuses real login → step 1 is authentic. Standalone is closest to xaa.dev but re-implements login. |

## The OBO protocol we replicate

Captured from the `asgardeo_ai` SDK (`agent_auth_manager.py`) + `asgardeo` core client (`auth/client.py`) as used by [auth_manager.py](../transactions-agent/auth/auth_manager.py) and [tools.py](../transactions-agent/app/tools.py). All token calls hit `${IDP_BASE_URL}/oauth2/token` with `Content-Type: application/x-www-form-urlencoded`.

**Key insight:** this is **not** RFC 8693 token-exchange. It is the `authorization_code` grant with an extra **`actor_token`** parameter. The `actor_token` is what makes IS mint a delegated token whose `act.sub` is the agent and `sub` is the user.

### Step 1 — User authorizes (PKCE authorize)

```
GET ${IDP_BASE_URL}/oauth2/authorize
  ?response_type=code
  &client_id={AGENT_APP_ID}
  &scope=profile phone
  &code_challenge={pkce_challenge}
  &code_challenge_method=S256
  &redirect_uri={redirect_uri}
→ user consents → redirect with ?code={user_authorization_code}
```

### Step 2 — Agent authenticates (App-Native Auth → agent token)

The agent authenticates as its own IS principal via the App-Native Authentication API (`/oauth2/authn`) using `username=AGENT_ID` / `password=AGENT_SECRET` + PKCE, receives an agent authorization code, then exchanges it:

```
POST ${IDP_BASE_URL}/oauth2/token
  grant_type=authorization_code
  client_id={AGENT_APP_ID}
  code={agent_authorization_code}
  code_verifier={agent_pkce_verifier}
→ agent access token   (its own identity — becomes the actor)
```

This step is internally multi-step (native-auth `FlowStatus` handshake). The inspector can show it **expanded** (the `/authn` calls) or **collapsed** to a single "agent obtained token" step — a Phase-1 display toggle.

### Step 3 — OBO exchange (the money shot)

```
POST ${IDP_BASE_URL}/oauth2/token
  grant_type=authorization_code
  client_id={AGENT_APP_ID}
  client_secret={…}                 # only if configured
  code={user_authorization_code}    # from step 1
  redirect_uri={redirect_uri}
  code_verifier={pkce_verifier}
  actor_token={agent_access_token}  # ← delegation marker, from step 2
  scope=profile phone
→ OBO token
```

Decoded OBO token (highlight in the JWT viewer): `sub` = user, `act.sub` = agent, `aud` = resource, `scope` = `profile phone`, `exp`.

### Step 4 — Access the resource

```
GET {Transactions API | /scim2/Me}
  Authorization: Bearer {OBO_access_token}
→ protected data
```

This maps 1:1 onto xaa.dev's four steps and onto our existing audit events (`obo_initiated` / `agent_token_fetch` / `obo_exchanged` / `fresh` / `api_call`).

## Standalone service: `token-playground/`

A small FastAPI service — own `venv`, `requirements.txt`, `service.py`, `.env.example`; new port **8014**. Makes transparent `httpx` calls replicating the protocol above and returns a normalized artifact per step:

```json
{
  "request":  { "method": "POST", "url": "…/oauth2/token", "headers": {…}, "form": {…} },
  "response": { "status": 200, "body": {…} },
  "decoded":  { "header": {…}, "payload": {…} }
}
```

- **Secrets masked** in the returned request: `client_secret`, `agent_secret`, and bearer-token tails (e.g. `Bearer eyJ…<masked>`). Full decoded claims are shown — acceptable for demo code.
- **Endpoints:** `POST /playground/obo/{authorize, agent-token, exchange, call}` (later `POST /playground/idjag/*`).
- **Config** (its own `.env`): `IDP_BASE_URL`, `AGENT_APP_ID` (+ secret if used), `AGENT_ID` / `AGENT_SECRET`, `redirect_uri`, resource identifiers, `ENABLE_PLAYGROUND`.
- **Demo-gated:** off by default in prod deployment; not linked from prod nav.
- **Bonus:** emit the same token-audit events so the existing Token Flow page also reflects playground runs.

### Integration

Same pattern as the other services: add a launch block to [start-demo.sh](../demo_scripts/start-demo.sh), a case to `restart.sh`, venv/env checks to `validate.sh`, a section to `README.md`, and (optionally) a `docker-compose` profile. New port 8014 alongside 8010–8013.

## The webpage

Recommended: `app/src/pages/token-exchange-playground.jsx`, route `/playground`, reusing the logged-in Asgardeo session for the user subject.

- **Top — three role cards:** Requesting App (*Transactions Agent*), Identity Server (*Asgardeo*), Resource (*Transactions API* / `/scim2/Me*`). Each shows its config (client_id, resource identifier, scopes), secrets masked.
- **Middle — 4-step stepper:** each step has a **Run** button that calls the service and fills:
  - an **inspector** (outbound request → response, secrets masked), and
  - a **JWT viewer** (header + claims table, with `sub` / `act.sub` / `aud` / `scope` / `exp` highlighted).
- **Live mini sequence diagram** that fills in as steps complete — reusing the Mermaid builder + theme from the Token Flow page (refactor `buildDiagramText` / `effectiveHop` / `EVENT_LABELS` out of [token-flow.jsx](../app/src/pages/token-flow.jsx) into a shared module).
- **Components:** `components/playground/StepCard.jsx`, `RequestResponseInspector.jsx`, `JwtViewer.jsx`; `api/playground.js` for the axios calls; route + nav entry following the Token Flow (demo-only) pattern.

## Security & guardrails

- All secret-bearing exchanges run **server-side** in the standalone service; the browser only triggers steps and displays returned artifacts.
- Displayed requests mask `client_secret` / `agent_secret` / bearer tails. Decoded JWT claims are shown (demo).
- Playground endpoints are **demo-gated** (`ENABLE_PLAYGROUND=true`), off in prod, not in prod nav.
- CORS: allow the frontend origin (already configured pattern in the other services).

## Phasing

- **Phase 1 — OBO playground:** standalone `token-playground/` service + the page, end-to-end against real Asgardeo (role cards, 4-step stepper, inspector, JWT viewer, live diagram). Refactor the Mermaid builder into a shared module.
- **Phase 2 — polish:** progressive step reveal, copy-to-clipboard, error/failure states (reuse the red failure styling), tie playground runs into the audit log.
- **Phase 3 — ID-JAG (later):** a flow toggle ("OBO" vs "Cross-App Access") reusing the same artifact/inspector/JWT components. The artifact model is grant-agnostic, so ID-JAG slots in as a new set of `/playground/idjag/*` endpoints (IdP mints an ID-JAG assertion → requesting app presents it to the resource's token endpoint → scoped access token, no user consent) without reworking the UI. Prerequisite: confirm Asgardeo / WSO2 IS support for the identity-assertion authorization grant, or simulate assertion issuance for the demo.

## Open items to confirm

1. **Frontend location** — embedded page in the BOA app (recommended, reuses login) vs fully standalone mini-app.
2. **Step 2 display** — expand the native-auth handshake, or collapse to a single "agent obtained token" step.
3. **Resource for step 4** — Transactions API (`read_transactions`) or `/scim2/Me` (`profile phone`), or offer both.

## References

- Okta — [Introducing xaa.dev](https://developer.okta.com/blog/2026/01/20/xaa-dev-playground)
- OAuth.net — [Cross-App Access](https://oauth.net/cross-app-access/)
- IETF — [Identity Assertion JWT Authorization Grant (draft-04)](https://www.ietf.org/archive/id/draft-ietf-oauth-identity-assertion-authz-grant-04.html)
