# Bank of Asgard — Claude Code Guide

## Project Overview

Full-stack banking demo app integrating Asgardeo/WSO2 Identity Server for identity and OAuth flows, with an AI-powered Transactions Agent.

| Component | Stack | Port |
|-----------|-------|------|
| React frontend | Node.js + Vite | 5173 |
| Node/Express server | Node.js | 3002 |
| Transactions API | Python/FastAPI | 8010 |
| Transactions Agent | Python/FastAPI + WebSocket | 8011 |

## Transactions Agent (`transactions-agent/`)

The agent is built with the **Strands Agents SDK** (`strands-agents`). Entry point: [transactions-agent/app/service.py](transactions-agent/app/service.py).

### LLM Provider Configuration

Provider is controlled by `llm_config.yaml` at the repo root. Supported providers:

| provider | Model client | Notes |
|----------|-------------|-------|
| `anthropic` | `AnthropicModel` | Direct Anthropic API |
| `bedrock` | `BedrockModel` (no gateway) / `AnthropicModel` (gateway) | AWS Bedrock Converse API; default model `eu.anthropic.claude-sonnet-4-6` (EU cross-region inference profile), default region `eu-north-1` |
| `gemini` | `OpenAIModel` | Via Google's OpenAI-compatible endpoint |
| `openai` | `OpenAIModel` | Direct OpenAI API |

### WSO2 API Gateway

When `gateway.enabled: true` in `llm_config.yaml`, all LLM calls are routed via the WSO2 API Gateway using OAuth2 client-credentials bearer tokens — including the `bedrock` provider. The gateway handles AWS authentication on its backend. Do **not** bypass the gateway for any provider; the OAuth bearer-token flow on the client side is always used when the gateway is enabled.

The gateway supports two endpoints — `GATEWAY_BASE_URL` (standard) and `GATEWAY_BASE_URL_SECURED` (with guardrails). The agent selects between them based on the `secured` WebSocket query parameter.

### Key env vars (transactions-agent/.env)

```
# Identity provider
IDP_CLIENT_ID, IDP_BASE_URL, IDP_REDIRECT_URI

# Agent credentials
AGENT_ID, AGENT_SECRET

# LLM provider keys (only the one matching llm_config.yaml provider is needed)
ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY

# AWS Bedrock — direct access (bedrock provider, no gateway only)
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN  # temporary credentials
AWS_DEFAULT_REGION          # defaults to eu-north-1
AWS_BEARER_TOKEN_BEDROCK    # alternative: API key from AWS console (boto3 picks this up automatically)

# WSO2 API Gateway (when gateway.enabled: true — covers Bedrock and other providers)
GATEWAY_BASE_URL            # standard endpoint
GATEWAY_BASE_URL_SECURED    # endpoint with Bedrock guardrails enabled
GATEWAY_TOKEN_ENDPOINT, GATEWAY_CLIENT_ID, GATEWAY_CLIENT_SECRET
```

### AWS Bedrock model IDs

Bedrock requires a cross-region inference profile ID, not the base model ID. The `eu.` prefix routes within EU regions:

| Model | Bedrock ID |
|-------|-----------|
| Claude Sonnet 4.6 | `eu.anthropic.claude-sonnet-4-6` |
| Claude Sonnet 4.5 | `eu.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| Claude Haiku 4.5 | `eu.anthropic.claude-haiku-4-5-20251001-v1:0` |

Specifying the base model ID (e.g. `anthropic.claude-sonnet-4-6`) without a cross-region profile will return a `ValidationException`.

### Auth flow

The agent uses On-Behalf-Of (OBO) tokens to call the Transactions API on behalf of the logged-in user. Auth is managed per WebSocket session via `AutogenAuthManager` in `auth/`. The `SecureStrandsTool` wrapper injects the OBO token into each `GetMyTransactions` tool call.

## Python conventions

- Python 3.11+
- `ruff` for linting (config at `ruff.toml` in repo root)
- `requirements.txt` in each service directory (no pyproject.toml)

## Branch / PR conventions

Current active branch: `feat/langchain-migration`
Main branch: `main`
