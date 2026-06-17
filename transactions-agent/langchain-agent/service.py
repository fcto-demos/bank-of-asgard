import anthropic as _anthropic_sdk
import logging
import os
import uuid
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
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from pydantic import BaseModel, PrivateAttr
from starlette.websockets import WebSocketDisconnect

from app.gateway import GatewayTokenManager, GatewayBearerAuth
from app.prompt import agent_system_prompt, WELCOME_MESSAGE
from app.tools import get_my_transactions, get_agencies as _get_agencies
from tool import SecureLangChainTool
from auth import AuthRequestMessage, AutogenAuthManager, AuthSchema, AuthConfig, OAuthTokenType

from asgardeo_ai import AgentConfig
from asgardeo.models import AsgardeoConfig

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

# Agent credentials
agent_id = os.environ.get('AGENT_ID')
agent_secret = os.environ.get('AGENT_SECRET')

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

agent_config = AgentConfig(
    agent_id=agent_id,
    agent_secret=agent_secret,
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


# Per-session state — each WebSocket gets its own auth manager and token cache
auth_managers: Dict[str, AutogenAuthManager] = {}
state_mapping: Dict[str, str] = {}
websocket_connections: Dict[str, WebSocket] = {}


def _extract_gateway_error(e: Exception) -> str | None:
    """Walk the exception chain looking for known gateway HTTP errors and return a user-friendly message."""
    cause = e
    while cause is not None:
        if isinstance(cause, httpx.HTTPStatusError):
            status = cause.response.status_code
            if status == 446:
                logger.warning("Guardrail triggered (446): %s", cause.response.text)
                try:
                    data = cause.response.json()
                    msg = data.get("message") or data.get("detail")
                    if isinstance(msg, dict):
                        msg = msg.get("actionReason") or msg.get("action") or str(msg)
                    return msg or cause.response.text or "Your request was blocked by an AI guardrail policy."
                except Exception:
                    return cause.response.text or "Your request was blocked by an AI guardrail policy."
            if status == 429:
                logger.warning("Rate limit hit (429): %s", cause.response.text)
                return "I'm currently busy — the AI service is at capacity. Please try again in a moment."
        cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)
    # Fallback: check string representation in case the lib swallowed the original exception
    msg = str(e)
    if "446" in msg:
        return "Your request was blocked by an AI guardrail policy."
    if "429" in msg:
        return "I'm currently busy — the AI service is at capacity. Please try again in a moment."
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


async def run_agent(graph: Any, websocket: WebSocket, chat_history: List, session_id: str = ""):
    """Run the chat loop — receive user messages and return agent responses."""
    while True:
        user_input = await websocket.receive_text()

        if user_input.strip().lower() == "exit":
            await websocket.close()
            break

        try:
            messages = chat_history + [HumanMessage(content=user_input)]
            result = await graph.ainvoke({"messages": messages})

            # The last message in the result is the AI's final response
            output = result["messages"][-1].content

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

    async def message_handler(message: AuthRequestMessage):
        """Send OBO auth request to the frontend over this session's WebSocket."""
        state_mapping[message.state] = session_id
        await websocket.send_json(message.model_dump())

    auth_manager = AutogenAuthManager(
        config=asgardeo_config,
        agent_config=agent_config,
        message_handler=message_handler,
    )

    auth_managers[session_id] = auth_manager
    websocket_connections[session_id] = websocket

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

    active_llm = llm_secured if secured else llm
    logger.info("Session %s using %s gateway", session_id, "secured" if secured else "base")

    graph = create_agent(
        active_llm,
        [get_transactions_tool, get_agencies_tool],
        system_prompt=agent_system_prompt,
    )

    chat_history: List = []

    await websocket.accept()

    try:
        await websocket.send_json(TextResponse(content=WELCOME_MESSAGE).model_dump())

        await run_agent(graph, websocket, chat_history, session_id)
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
                    content="Authorisation complete! Fetching your transactions now..."
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
