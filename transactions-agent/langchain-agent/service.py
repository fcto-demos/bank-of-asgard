import anthropic as _anthropic_sdk
import base64
import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from functools import cached_property
from pathlib import Path
from typing import Literal, Dict, List, Any

import httpx

# Configure logging before asgardeo imports so the patch is in place when its clients are created
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
import yaml
from fastapi.responses import HTMLResponse
from langchain.agents import create_agent
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, AIMessage
from langchain_openai import ChatOpenAI
from traceloop.sdk import Traceloop
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from pydantic import BaseModel, PrivateAttr
from starlette.websockets import WebSocketDisconnect

from app.audit_log import register_actor_name, set_session, set_transaction
from app.gateway import GatewayTokenManager, GatewayBearerAuth
from app.prompt import agent_system_prompt, WELCOME_MESSAGE
from app.tools import (
    get_my_transactions, get_agencies as _get_agencies,
    get_my_profile, update_my_profile,
    PROFILE_AUTH_CONFIG, UPDATE_PROFILE_AUTH_CONFIG,
    GET_MY_PROFILE_DESCRIPTION, UPDATE_MY_PROFILE_DESCRIPTION,
    auth_completion_message,
)
from app.subagents import subscription_detective, spending_health
from tool import SecureLangChainTool
from auth import AuthRequestMessage, AutogenAuthManager, AuthSchema, AuthConfig, OAuthTokenType

from asgardeo_ai import AgentConfig
from asgardeo.models import AsgardeoConfig, OAuthToken

logger = logging.getLogger(__name__)

# Suppress verbose third-party INFO logs
logging.getLogger("langchain").setLevel(logging.WARNING)
logging.getLogger("langchain_core").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

load_dotenv()

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"


class GatewayChatAnthropic(ChatAnthropic):
    """ChatAnthropic subclass that injects gateway Bearer auth via a custom httpx client.

    ChatAnthropic builds its own internal httpx client and does not expose http_client
    as a constructor parameter. This subclass overrides _async_client to inject our
    GatewayBearerAuth handler so tokens are refreshed transparently on each request.
    """

    _gw_auth: GatewayBearerAuth = PrivateAttr()

    def __init__(self, *, gw_auth: GatewayBearerAuth, **data):
        super().__init__(**data)
        self._gw_auth = gw_auth

    @cached_property
    def _async_client(self) -> _anthropic_sdk.AsyncAnthropic:
        http_client = httpx.AsyncClient(auth=self._gw_auth, verify=_ssl_verify)
        return _anthropic_sdk.AsyncAnthropic(**self._client_params, http_client=http_client)


# IDP configuration
client_id = os.environ.get('AGENT_APP_ID')
base_url = os.environ.get('IDP_BASE_URL')
redirect_uri = os.environ.get('IDP_REDIRECT_URI', 'http://localhost:8011/callback')

# Transactions Agent (Coordinator) identity — renamed from AGENT_ID/AGENT_SECRET now
# that the demo distinguishes resource audiences (transactions_api, agencies_mcp,
# savings_agent) more explicitly, even though all three are authenticated with this
# same identity (same pattern as GetAgencies) — see SuggestSavingsGoal wiring below.
transactions_agent_id = os.environ.get('TRANSACTIONS_AGENT_ID')
transactions_agent_secret = os.environ.get('TRANSACTIONS_AGENT_SECRET')

# Both the agent_id value and the service name show up as origin/destination across
# different audit events (auth_manager.py uses the former, gateway.py the latter) — they
# must resolve to the same canonical actor, not look like two unrelated entities.
register_actor_name(transactions_agent_id, "Transactions Agent")
register_actor_name("transactions-agent", "Transactions Agent")

# Dedicated OAuth2 app for MCP access (separate from the public app used for user auth)
mcp_client_id = os.environ.get('MCP_CLIENT_ID')
if not mcp_client_id:
    logger.warning("MCP_CLIENT_ID not set — GetAgencies tool will not be available")

asgardeo_config = AsgardeoConfig(
    base_url=base_url,
    client_id=client_id,
    redirect_uri=redirect_uri
)

mcp_asgardeo_config = AsgardeoConfig(
    base_url=base_url,
    client_id=mcp_client_id,
    redirect_uri=redirect_uri
) if mcp_client_id else None

# Dedicated OAuth2 app for the standalone Savings Goals agent service (same pattern as
# MCP_CLIENT_ID above — the Coordinator authenticates with its OWN identity, just
# requesting a token audienced for this app, so the call is traceable as "Coordinator
# called Savings Agent" rather than the Savings Agent appearing to call itself).
savings_agent_client_id = os.environ.get('SAVINGS_AGENT_CLIENT_ID')
if not savings_agent_client_id:
    logger.warning("SAVINGS_AGENT_CLIENT_ID not set — SuggestSavingsGoal tool will not be available")

savings_asgardeo_config = AsgardeoConfig(
    base_url=base_url,
    client_id=savings_agent_client_id,
    redirect_uri=redirect_uri
) if savings_agent_client_id else None

SAVINGS_AGENT_URL = os.environ.get('SAVINGS_AGENT_URL', 'http://localhost:8013/suggest-goal')

agent_config = AgentConfig(
    agent_id=transactions_agent_id,
    agent_secret=transactions_agent_secret,
)


def _load_llm_config() -> dict:
    """Load LLM config from llm_config.yaml.

    Searches: /app/ (Docker mount), then project root (native development).
    """
    candidates = [
        Path(__file__).parent / "llm_config.yaml",               # Docker: /app/llm_config.yaml
        Path(__file__).parent.parent.parent / "llm_config.yaml",  # native: repo root
    ]
    for path in candidates:
        if path.exists():
            with open(path) as f:
                return yaml.safe_load(f) or {}
    logger.warning("llm_config.yaml not found — falling back to openai/gpt-4o-mini")
    return {}


_llm_cfg = _load_llm_config()
llm_provider = _llm_cfg.get("provider", "openai").lower()
llm_model = _llm_cfg.get("model")

openai_api_key = os.environ.get('OPENAI_API_KEY')
gemini_api_key = os.environ.get('GEMINI_API_KEY')
anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
mistral_api_key = os.environ.get('MISTRAL_API_KEY')

app = FastAPI(
    title="Bank of Asgard — Transactions Agent",
    version="1.0.0",
)


class TextResponse(BaseModel):
    type: Literal["message"] = "message"
    content: str


# Build LLM based on configured provider
_gateway_cfg = _llm_cfg.get("gateway", {})
_use_gateway = _gateway_cfg.get("enabled", False)

_default_models = {
    "gemini": "gemini-2.5-flash-lite",
    "anthropic": "claude-haiku-4-5",
    "openai": "gpt-4o-mini",
    "mistral": "mistral-small-latest",
}


def _build_gateway_llm(gw_base_url: str, token_manager: GatewayTokenManager):
    """Build a LangChain LLM routed via the WSO2 API Gateway at the given base URL."""
    gw_auth = GatewayBearerAuth(token_manager)
    if llm_provider == 'anthropic':
        return GatewayChatAnthropic(
            model=llm_model or _default_models["anthropic"],
            anthropic_api_url=gw_base_url,
            anthropic_api_key="unused",
            gw_auth=gw_auth,
        )
    else:
        return ChatOpenAI(
            model=llm_model or _default_models.get(llm_provider, "gpt-4o-mini"),
            base_url=gw_base_url,
            api_key="unused",
            http_async_client=httpx.AsyncClient(auth=gw_auth, verify=_ssl_verify),
        )


_GATEWAY_URL_PREFIXES: tuple[str, ...] = ()

if _use_gateway:
    logger.info("LLM routing via WSO2 API Gateway (provider=%s)", llm_provider)
    _gw_token_manager = GatewayTokenManager(
        token_endpoint=os.environ["GATEWAY_TOKEN_ENDPOINT"],
        client_id=os.environ["GATEWAY_CLIENT_ID"],
        client_secret=os.environ["GATEWAY_CLIENT_SECRET"],
        ssl_verify=_ssl_verify,
    )
    llm = _build_gateway_llm(os.environ["GATEWAY_BASE_URL"], _gw_token_manager)
    llm_secured = _build_gateway_llm(os.environ["GATEWAY_BASE_URL_SECURED"], _gw_token_manager)
    logger.info("Gateway base URL: %s", os.environ["GATEWAY_BASE_URL"])
    logger.info("Gateway secured URL: %s", os.environ["GATEWAY_BASE_URL_SECURED"])
    # 446 (guardrail) is a status only the WSO2 AI Gateway returns — never the IDP or
    # any other service. _extract_gateway_error uses this to make sure it only treats a
    # 446/429 as a gateway error when the failing request actually targeted the gateway.
    _GATEWAY_URL_PREFIXES = (os.environ["GATEWAY_BASE_URL"], os.environ["GATEWAY_BASE_URL_SECURED"])
else:
    match llm_provider:
        case 'gemini':
            llm = ChatOpenAI(
                model=llm_model or _default_models["gemini"],
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=gemini_api_key,
            )
        case 'anthropic':
            llm = ChatAnthropic(
                model=llm_model or _default_models["anthropic"],
                anthropic_api_key=anthropic_api_key,
            )
        case 'mistral':
            llm = ChatOpenAI(
                model=llm_model or _default_models["mistral"],
                base_url="https://api.mistral.ai/v1",
                api_key=mistral_api_key,
            )
        case _:  # default: openai
            llm = ChatOpenAI(
                model=llm_model or _default_models["openai"],
                api_key=openai_api_key,
                temperature=0.1,
                max_tokens=2000,
            )
    llm_secured = llm


# In-process sub-agents — built once at startup, reused across sessions. They never see
# raw user chat input (only structured/internal summaries), so they always run on the
# unsecured `llm` (v1 gateway) regardless of a session's guardrails toggle.
_subscription_graph = subscription_detective.build_graph(llm)
_spending_health_graph = spending_health.build_graph(llm)


async def _analyze_subscriptions(token: OAuthToken) -> str:
    """Scan up to a year of transaction history for recurring monthly subscriptions."""
    start_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
    result = await get_my_transactions(token, start_date=start_date, limit=300)
    return await subscription_detective.analyze(_subscription_graph, result["transactions"])


async def _analyze_spending_health(token: OAuthToken) -> str:
    """Compare the last ~45 days of spending against the prior ~45 days, by category."""
    start_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    result = await get_my_transactions(token, start_date=start_date, limit=300)
    return await spending_health.analyze(_spending_health_graph, result["transactions"])


async def _suggest_savings_goal(
    token: OAuthToken,
    subscription_summary: str,
    spending_summary: str,
    monthly_recoverable: float,
    user_sub: str | None = None,
    transaction_id: str | None = None,
) -> str:
    """Call the standalone Savings Goals agent service with findings from the other
    two sub-agents and return its recommendation. A real cross-process agent call —
    unlike the other two sub-agents, this one runs in a separate service/venv/port.

    user_sub (decoded from the user's OBO token, not LLM-supplied — see
    websocket_endpoint's wrapper closures) lets the Savings Agent's audit log tie this
    call back to whose consented data the Coordinator is delegating, not just which
    agents were involved.

    transaction_id (the Coordinator's session_id) is forwarded so the Savings Agent
    can tag its own spans with the same Traceloop association property, since OTEL
    context doesn't cross this process boundary on its own."""
    headers = {"Authorization": f"Bearer {token.access_token}"}
    # Also sent as a header (not just in the body) so the Savings Agent's bearer-auth
    # middleware — which runs before the body is parsed — can tag its own
    # validated_incoming audit event with the right transaction_id too.
    if transaction_id:
        headers["X-Transaction-Id"] = transaction_id
    payload = {
        "subscription_summary": subscription_summary,
        "spending_summary": spending_summary,
        "monthly_recoverable": monthly_recoverable,
        "user_sub": user_sub,
        "transaction_id": transaction_id,
    }
    async with httpx.AsyncClient(verify=_ssl_verify) as client:
        response = await client.post(SAVINGS_AGENT_URL, headers=headers, json=payload, timeout=30.0)
        response.raise_for_status()
        result = response.json()
    return (
        f"{result['message']} (Goal: {result['goal_name']}, "
        f"projected balances: {result['projected_balances']})"
    )


# Local to langchain-agent only — NOT added to the shared app/prompt.py, since autogen
# and strands don't have these three tools wired up. Appended to agent_system_prompt
# below, the same string-concatenation technique already used for DEMO_VERSION's v2
# addendum (composed here instead of inside app/prompt.py).
_COORDINATOR_ADDENDUM = """

FINANCIAL CHECK-UP: You also coordinate two specialist sub-agents and a savings advisor:
- AnalyzeSubscriptions: finds recurring monthly charges, including easy-to-forget ones.
- AnalyzeSpendingHealth: reports recent category-level spending trends.
- SuggestSavingsGoal: turns recoverable monthly money into a concrete savings goal with
  multi-year projections — pass it the summaries from the two tools above plus the total
  monthly amount you judge could be redirected to savings.

When the user asks for a general financial check-up, health check, or "how am I doing
financially", call AnalyzeSubscriptions and AnalyzeSpendingHealth together in the same
turn (do not call one and wait for the other first), then call SuggestSavingsGoal once
you have both results back."""


# Per-session state — each WebSocket gets its own auth manager and token cache
auth_managers: Dict[str, AutogenAuthManager] = {}
state_mapping: Dict[str, str] = {}
# state -> scopes requested for that OBO auth, so /callback can tailor the
# "authorisation complete" message to the action the user authorised.
auth_request_scopes: Dict[str, list] = {}
websocket_connections: Dict[str, WebSocket] = {}


def _is_gateway_request(cause: Exception) -> bool:
    """446 (guardrail) and the gateway's 429 are statuses only the WSO2 AI Gateway
    returns — never the IDP, transactions-api, or any other service this process talks
    to. Check the failing request's URL actually targeted the gateway before treating
    its status code as a guardrail/rate-limit signal, so an unrelated error that happens
    to carry the same status code elsewhere isn't mislabeled."""
    request = getattr(cause, "request", None) or getattr(getattr(cause, "response", None), "request", None)
    url = str(getattr(request, "url", ""))
    return bool(url) and any(url.startswith(prefix) for prefix in _GATEWAY_URL_PREFIXES)


def _extract_gateway_error(e: Exception) -> str | None:
    """Walk the exception chain looking for known gateway HTTP errors and return a user-friendly message."""
    cause = e
    while cause is not None:
        if isinstance(cause, httpx.HTTPStatusError):
            status = cause.response.status_code
            body = cause.response.text
            parsed = None
        elif isinstance(cause, _anthropic_sdk.APIStatusError):
            status = cause.status_code
            body = str(cause.body)
            parsed = cause.body if isinstance(cause.body, dict) else None
        else:
            cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)
            continue

        if not _is_gateway_request(cause):
            cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)
            continue

        if status == 446:
            logger.warning("Guardrail triggered (446): %s", body)
            try:
                data = parsed if parsed is not None else json.loads(body)
                msg = data.get("message") or data.get("detail")
                if isinstance(msg, dict):
                    msg = msg.get("actionReason") or msg.get("action") or str(msg)
                return msg or body or "Your request was blocked by an AI guardrail policy."
            except Exception:
                return body or "Your request was blocked by an AI guardrail policy."
        if status == 429:
            logger.warning("Rate limit hit (429): %s", body)
            return "I'm currently busy — the AI service is at capacity. Please try again in a moment."
        cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)
    # No structured 446/429 status found anywhere in the exception chain — this isn't a
    # gateway/guardrail error. Deliberately no string-substring fallback here: matching
    # "446"/"429" anywhere in str(e) (e.g. inside a URL, random PKCE code_challenge, or
    # any other incidental digit sequence) produces false positives that mislabel
    # unrelated errors (auth/config failures, etc.) as guardrail blocks.
    return None


def _decode_sub(access_token: str) -> str | None:
    """Decode the `sub` claim from a JWT without verifying the signature — for tracing
    only (e.g. tagging cross-agent calls with which user's consented data is involved).
    The token has already been validated upstream by whoever issued/required it."""
    try:
        payload = access_token.split(".")[1]
        payload += "=" * (4 - len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("sub")
    except Exception:
        return None


def _user_friendly_error(e: Exception) -> str:
    msg = str(e)
    if "401" in msg or "authentication" in msg.lower() or "api key" in msg.lower():
        return "There is a configuration problem with the AI service. Please contact the administrator."
    if "timeout" in msg.lower():
        return "The request timed out. Please try again."
    if "no oauth token" in msg.lower() or "oauth" in msg.lower():
        return "I wasn't able to authorise access to your transactions. Please try again."
    return "An unexpected error occurred. Please try again."


def _message_text(content) -> str:
    """Flatten a LangChain message's ``content`` into plain text for the UI.

    Most providers set ``AIMessage.content`` to a plain string, but Anthropic
    (including via the WSO2 gateway) returns a list of content blocks such as
    ``[{"type": "text", "text": "..."}]``. Passing that list straight to the UI
    renders the raw JSON, so we concatenate the text blocks into one string.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return str(content)


def _log_token_usage(new_messages: list, session_id: str) -> None:
    """Sum token usage across all LLM calls in one agent turn and log a single line.

    Handles both OpenAI (token_usage.prompt_tokens/completion_tokens) and
    Anthropic (usage.input_tokens/output_tokens) response_metadata shapes.
    """
    total_input = total_output = calls = 0
    for msg in new_messages:
        if not isinstance(msg, AIMessage):
            continue
        meta = msg.response_metadata or {}
        usage = meta.get("token_usage") or meta.get("usage") or {}
        inp = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
        out = usage.get("output_tokens") or usage.get("completion_tokens") or 0
        if inp or out:
            calls += 1
            total_input += inp
            total_output += out
    if calls:
        logger.info(
            "[tokens] session=%s llm_calls=%d input=%d output=%d total=%d",
            session_id, calls, total_input, total_output, total_input + total_output,
        )


async def run_agent(
    graph: Any,
    websocket: WebSocket,
    chat_history: List,
    session_id: str = "",
    session_context: dict | None = None,
):
    """Run the chat loop — receive user messages and return agent responses."""
    while True:
        user_input = await websocket.receive_text()

        if user_input.strip().lower() == "exit":
            await websocket.close()
            break

        # Fresh transaction_id per turn — each prompt gets its own trace instead of
        # every turn in the session sharing one ID and accumulating the whole history.
        turn_id = str(uuid.uuid4())
        if session_context is not None:
            session_context["transaction_id"] = turn_id
        Traceloop.set_association_properties({"transaction_id": turn_id})
        set_transaction(turn_id)

        try:
            messages = chat_history + [HumanMessage(content=user_input)]
            result = await graph.ainvoke({"messages": messages})

            # The last message in the result is the AI's final response
            output = _message_text(result["messages"][-1].content)

            new_messages = result["messages"][len(messages):]
            _log_token_usage(new_messages, session_id)

            # Update history with new messages from this turn
            chat_history.extend(new_messages)

            for msg in new_messages[:-1]:
                logger.debug(f"[Agent Step] {msg}")

            await websocket.send_json(
                TextResponse(content=output).model_dump()
            )
        except Exception as e:
            guardrail_msg = _extract_gateway_error(e)
            if guardrail_msg:
                await websocket.send_json(TextResponse(content=guardrail_msg).model_dump())
            else:
                logger.error(f"Agent error processing message: {e}")
                await websocket.send_json(
                    TextResponse(content=_user_friendly_error(e)).model_dump()
                )


@app.websocket("/chat")
async def websocket_endpoint(websocket: WebSocket, secured: bool = False):
    """WebSocket endpoint for the Transaction Assistant chat."""
    session_id = str(uuid.uuid4())
    set_session(session_id)

    async def message_handler(message: AuthRequestMessage):
        """Send OBO auth request to the frontend over this session's WebSocket."""
        state_mapping[message.state] = session_id
        auth_request_scopes[message.state] = message.scopes
        await websocket.send_json(message.model_dump())

    auth_manager = AutogenAuthManager(
        config=asgardeo_config,
        agent_config=agent_config,
        message_handler=message_handler,
    )

    auth_managers[session_id] = auth_manager
    websocket_connections[session_id] = websocket

    # Captures the end user's identity (decoded from the OBO token, never LLM-supplied)
    # the first time an OBO-authenticated tool runs, so SuggestSavingsGoal's call to the
    # standalone Savings Agent can be traced back to whose consented data is involved.
    # transaction_id is refreshed per turn in run_agent (not per session) so each prompt
    # gets its own trace instead of accumulating the whole conversation under one ID.
    session_context: dict = {"user_sub": None, "transaction_id": None}

    async def _analyze_subscriptions_traced(token: OAuthToken) -> str:
        session_context["user_sub"] = _decode_sub(token.access_token)
        return await _analyze_subscriptions(token)

    async def _analyze_spending_health_traced(token: OAuthToken) -> str:
        session_context["user_sub"] = _decode_sub(token.access_token)
        return await _analyze_spending_health(token)

    async def _suggest_savings_goal_traced(
        token: OAuthToken,
        subscription_summary: str,
        spending_summary: str,
        monthly_recoverable: float,
    ) -> str:
        return await _suggest_savings_goal(
            token, subscription_summary, spending_summary, monthly_recoverable,
            user_sub=session_context["user_sub"],
            transaction_id=session_context["transaction_id"],
        )

    # Wire the transactions tool with OBO token auth
    get_transactions_tool = SecureLangChainTool(
        get_my_transactions,
        description=(
            "Fetch the current user's bank transactions. "
            "Supports optional filters: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD), "
            "type ('debit', 'credit', or 'transfer'), and limit (max number of results). "
            "Always call this tool before answering questions about the user's transactions, "
            "spending history, or account activity."
        ),
        name="GetMyTransactions",
        auth=AuthSchema(auth_manager, AuthConfig(
            scopes=["read_transactions"],
            token_type=OAuthTokenType.OBO_TOKEN,
            resource="transactions_api"
        ))
    )

    # Wire the profile tools — same OBO auth_manager as GetMyTransactions, but a
    # different AuthConfig (scim2_me), so the user gets a separate consent prompt.
    get_profile_tool = SecureLangChainTool(
        get_my_profile,
        description=GET_MY_PROFILE_DESCRIPTION,
        name="GetMyProfile",
        auth=AuthSchema(auth_manager, PROFILE_AUTH_CONFIG)
    )

    update_profile_tool = SecureLangChainTool(
        update_my_profile,
        description=UPDATE_MY_PROFILE_DESCRIPTION,
        name="UpdateMyProfile",
        auth=AuthSchema(auth_manager, UPDATE_PROFILE_AUTH_CONFIG)
    )

    # Wire the two in-process sub-agent tools — same OBO auth_manager as GetMyTransactions,
    # since they just do more analysis on data the user already has access to.
    analyze_subscriptions_tool = SecureLangChainTool(
        _analyze_subscriptions_traced,
        description=(
            "Scan the user's transaction history over the past year for recurring monthly "
            "subscriptions, including ones that might be easy to forget about. Use this when "
            "the user asks for a financial check-up, wants to find forgotten subscriptions, "
            "or asks what they're being charged for repeatedly."
        ),
        name="AnalyzeSubscriptions",
        auth=AuthSchema(auth_manager, AuthConfig(
            scopes=["read_transactions"],
            token_type=OAuthTokenType.OBO_TOKEN,
            resource="transactions_api"
        ))
    )

    analyze_spending_health_tool = SecureLangChainTool(
        _analyze_spending_health_traced,
        description=(
            "Analyze the user's recent spending trends by category, comparing the last ~45 "
            "days to the prior ~45 days. Use this when the user asks for a financial "
            "check-up or asks how their spending has changed recently."
        ),
        name="AnalyzeSpendingHealth",
        auth=AuthSchema(auth_manager, AuthConfig(
            scopes=["read_transactions"],
            token_type=OAuthTokenType.OBO_TOKEN,
            resource="transactions_api"
        ))
    )

    # Wire the agencies MCP tool — uses a dedicated OAuth2 app (MCP_CLIENT_ID) so the
    # token audience matches the MCP server's EXPECTED_AUDIENCE. No message_handler
    # needed: AGENT_TOKEN goes through native auth, no user redirect involved.
    mcp_auth_manager = AutogenAuthManager(
        config=mcp_asgardeo_config,
        agent_config=agent_config,
    ) if mcp_asgardeo_config else None

    get_agencies_tool = SecureLangChainTool(
        _get_agencies,
        description=(
            "Find Bank of Asgard branches and agencies near a given town. "
            "Call this when the user asks about branch locations, opening hours, "
            "phone numbers, or available services near a city."
        ),
        name="GetAgencies",
        auth=AuthSchema(mcp_auth_manager, AuthConfig(
            scopes=[],
            token_type=OAuthTokenType.AGENT_TOKEN,
            resource="agencies_mcp"
        )) if mcp_auth_manager else None
    )

    # Wire the Savings Goals tool — a real cross-process call to the standalone
    # savings-goals-agent service, using the Coordinator's own identity requesting a
    # token audienced for SAVINGS_AGENT_CLIENT_ID (same pattern as GetAgencies). This
    # makes the call traceable as "Coordinator called Savings Agent" — see
    # savings-goals-agent/server.py's _validate_token for the corresponding claim log.
    savings_auth_manager = AutogenAuthManager(
        config=savings_asgardeo_config,
        agent_config=agent_config,
    ) if savings_asgardeo_config else None

    suggest_savings_goal_tool = SecureLangChainTool(
        _suggest_savings_goal_traced,
        description=(
            "Suggest a concrete savings goal given recoverable monthly money the user could "
            "redirect into savings — e.g. from forgotten subscriptions found by "
            "AnalyzeSubscriptions. Pass in the natural-language summaries already returned by "
            "AnalyzeSubscriptions (subscription_summary) and AnalyzeSpendingHealth "
            "(spending_summary), plus the total monthly amount that could be recovered "
            "(monthly_recoverable). Returns a goal name, projected balances over 1/5/10 years, "
            "and a friendly recommendation message."
        ),
        name="SuggestSavingsGoal",
        auth=AuthSchema(savings_auth_manager, AuthConfig(
            scopes=[],
            token_type=OAuthTokenType.AGENT_TOKEN,
            resource="savings_agent"
        )) if savings_auth_manager else None
    )

    active_llm = llm_secured if secured else llm
    logger.info("Session %s using %s gateway", session_id, "secured" if secured else "base")

    # GetAgencies and SuggestSavingsGoal depend on optional config (MCP_CLIENT_ID,
    # SAVINGS_AGENT_CLIENT_ID respectively). When unset, their auth manager is None and
    # SecureLangChainTool falls back to passing token="" (a plain string) — only register
    # them with the LLM when properly configured, so the model can't call a tool that
    # would crash with 'str' object has no attribute 'access_token'.
    tools = [
        get_transactions_tool, analyze_subscriptions_tool, analyze_spending_health_tool,
        get_profile_tool, update_profile_tool,
    ]
    if mcp_auth_manager:
        tools.append(get_agencies_tool)
    if savings_auth_manager:
        tools.append(suggest_savings_goal_tool)

    graph = create_agent(
        active_llm,
        tools,
        system_prompt=agent_system_prompt + _COORDINATOR_ADDENDUM,
    ).with_config(run_name="banking_assistant")

    chat_history: List = []

    await websocket.accept()

    try:
        await websocket.send_json(TextResponse(content=WELCOME_MESSAGE).model_dump())

        await run_agent(graph, websocket, chat_history, session_id, session_context)
    except WebSocketDisconnect:
        logger.info(f"Session {session_id} disconnected")
    except Exception as e:
        logger.error(f"Session {session_id} error: {str(e)}")
        try:
            await websocket.send_json(
                TextResponse(content=_user_friendly_error(e)).model_dump()
            )
        except Exception as send_err:
            logger.debug("Failed to send error response to session %s: %s", session_id, send_err)
    finally:
        auth_managers.pop(session_id, None)
        websocket_connections.pop(session_id, None)


@app.get("/callback")
async def callback(code: str, state: str):
    """OAuth callback — exchanges the authorization code for an OBO token."""
    session_id = state_mapping.pop(state, None)
    scopes = auth_request_scopes.pop(state, [])
    if not session_id:
        raise HTTPException(status_code=400, detail="Invalid state.")

    auth_manager = auth_managers.get(session_id)
    if not auth_manager:
        raise HTTPException(status_code=400, detail="Invalid session.")

    try:
        await auth_manager.process_callback(state, code)

        # Notify the agent session that authorization is complete
        websocket = websocket_connections.get(session_id)
        if websocket:
            try:
                await websocket.send_json(TextResponse(
                    content=auth_completion_message(scopes)
                ).model_dump())
            except Exception as ws_err:
                logger.warning(f"Could not send auth completion message: {ws_err}")

        return HTMLResponse(content=f"""
            <html>
            <head>
                <title>Authorisation Successful</title>
                <script>
                    function communicateAndClose() {{
                        if (window.opener) {{
                            try {{
                                window.opener.postMessage({{
                                    type: 'auth_callback',
                                    state: '{state}'
                                }}, "*");
                                document.getElementById('status').textContent =
                                    'Authorisation successful! Closing window...';
                                setTimeout(function() {{ window.close(); }}, 1500);
                            }} catch (err) {{
                                document.getElementById('status').textContent = 'Error: ' + err.message;
                            }}
                        }} else {{
                            document.getElementById('status').textContent = 'Cannot find opener window.';
                        }}
                    }}
                    window.onload = communicateAndClose;
                </script>
            </head>
            <body>
                <div style="text-align:center;font-family:Arial,sans-serif;margin-top:50px;">
                    <h2>Authorisation Successful</h2>
                    <p id="status">Processing authorisation...</p>
                    <p>You can close this window and return to the Transaction Assistant.</p>
                </div>
            </body>
            </html>
        """)
    except Exception as e:
        logger.error(f"Callback error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Authorization failed. Please try again.")
