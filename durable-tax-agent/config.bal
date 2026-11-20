# The LLM gateway proxy that fronts Anthropic, without a trailing slash, for example
configurable string gatewayBaseUrl = ?;

# The API key the gateway issued to the `boa-tax-agent` application for that proxy.
# Same value as `GATEWAY_API_KEY` in `tax-agent/.env`.
configurable string gatewayApiKey = ?;

# The Anthropic model name: the `model` from the repo's `llm_config.yaml` (currently `claude-haiku-4-5`).
configurable string llmModel = ?;

# The identity provider that issues the Coordinator's agent token, without a trailing slash.
# Its keys are read from `<idpBaseUrl>/oauth2/jwks`. Same value as `IDP_BASE_URL` in `tax-agent/.env`.
configurable string idpBaseUrl = ?;

# The audience the Coordinator's token must carry: this agent's client ID.
# Same value as `EXPECTED_AUDIENCE` in `tax-agent/.env` and `TAX_AGENT_CLIENT_ID` in `transactions-agent/.env`.
configurable string expectedAudience = ?;

# The scope the bank Coordinator's agent token must carry to start and follow returns, for example
# `coordinate_tax_returns`. Grant it only to the Coordinator's agent identity. Must not be empty:
# without it, any token issued for this agent's client could start and read returns.
configurable string coordinatorScope = ?;

# The scope an officer's token must carry to review evidence for provisional reliefs, for example
# `review_tax_claims`. Only the tax-officer role should hold it. Must not be empty: it is what tells
# an officer from a citizen.
configurable string officerScope = ?;

# How long an officer has to review the evidence for a provisional relief, in minutes. When it
# passes, the review ends unanswered and the agent withdraws the relief. Days in real life; a few
# minutes in a demo.
configurable int reviewDeadlineMinutes = ?;

# The scope the citizen's own token must carry to sign a filing, for example
# `file_tax_return`. Same value as `TAX_FILING_SCOPE` in `transactions-agent/.env`. An empty string
# skips the scope check; the token must still belong to the citizen the return was started for.
configurable string citizenScope = ?;

function init() returns error? {
    if coordinatorScope.trim() == "" {
        return error("coordinatorScope must be set: it is what limits starting and reading returns to the Coordinator");
    }
    if officerScope.trim() == "" {
        return error("officerScope must be set: it is the only thing that tells a tax officer from a citizen");
    }
    if reviewDeadlineMinutes < 1 {
        return error("reviewDeadlineMinutes must be at least 1");
    }
}
