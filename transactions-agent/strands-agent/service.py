import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Dict

import botocore
import httpx
import openai
import yaml
from botocore.config import Config as BotocoreConfig
from fastapi.responses import HTMLResponse
from strands import Agent, tool as strands_tool
from strands.models import AnthropicModel, BedrockModel, OpenAIModel
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from app.prompt import agent_system_prompt, WELCOME_MESSAGE
from app.tools import get_my_transactions, get_agencies as _get_agencies, set_agencies_token_provider
from tool import SecureStrandsTool
from auth import AuthRequestMessage, AutogenAuthManager, AuthSchema, AuthConfig, OAuthTokenType

from asgardeo_ai import AgentConfig
from asgardeo.models import AsgardeoConfig

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Suppress verbose third-party INFO logs
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)
logging.getLogger("anthropic").setLevel(logging.WARNING)
logging.getLogger("strands").setLevel(logging.WARNING)

# Suppress known strands/pydantic incompatibility warning for ParsedTextBlock (citations)
import warnings
warnings.filterwarnings("ignore", message=".*PydanticSerializationUnexpectedValue.*", category=UserWarning)
warnings.filterwarnings("ignore", message=".*ParsedTextBlock.*", category=UserWarning)

load_dotenv()

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"


# Traceloop / AMP tracing — imported lazily so the service starts even if the
# packages are absent or AMP is not configured.
def _noop_decorator(*_a, **_kw):
    def _passthrough(f):
        return f
    return _passthrough


try:
    from traceloop.sdk.decorators import agent as _agent_decorator
    from traceloop.sdk import Traceloop as _Traceloop
    _HAS_TRACELOOP = True
except ImportError:
    _HAS_TRACELOOP = False
    _Traceloop = None
    _agent_decorator = _noop_decorator


class GatewayTokenManager:
    """Fetches and caches an OAuth2 client-credentials token for the WSO2 API Gateway."""

    def __init__(
        self,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
    ):
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def cached_token(self) -> str | None:
        """Return the in-memory cached token without triggering a refresh."""
        return self._token

    async def get_token(self) -> str:
        async with self._lock:
            if self._token and time.monotonic() < self._expires_at:
                return self._token
            data: dict = {"grant_type": "client_credentials"}
            if self._scope:
                data["scope"] = self._scope
            async with httpx.AsyncClient(verify=_ssl_verify) as client:
                resp = await client.post(
                    self._token_endpoint,
                    data=data,
                    auth=(self._client_id, self._client_secret),
                )
                resp.raise_for_status()
                token_data = resp.json()
            self._token = token_data["access_token"]
            self._expires_at = time.monotonic() + token_data.get("expires_in", 3600) - 30
            logger.info("Gateway access token refreshed (expires in %ss)", token_data.get("expires_in", 3600))
            return self._token


class GatewayBearerAuth(httpx.Auth):
    """httpx auth handler that injects a fresh gateway token on every LLM request."""

    def __init__(self, token_manager: GatewayTokenManager):
        self._manager = token_manager

    async def async_auth_flow(self, request):
        token = await self._manager.get_token()
        request.headers["Authorization"] = f"Bearer {token}"
        yield request


# IDP configuration
client_id = os.environ.get('IDP_CLIENT_ID')
base_url = os.environ.get('IDP_BASE_URL')
redirect_uri = os.environ.get('IDP_REDIRECT_URI', 'http://localhost:8011/callback')

# Agent credentials
agent_id = os.environ.get('AGENT_ID')
agent_secret = os.environ.get('AGENT_SECRET')

asgardeo_config = AsgardeoConfig(
    base_url=base_url,
    client_id=client_id,
    redirect_uri=redirect_uri
)

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
logger.info(
    "LLM config: provider=%s model=%s gateway_enabled=%s",
    llm_provider, llm_model, _llm_cfg.get("gateway", {}).get("enabled", False),
)

openai_api_key = os.environ.get('OPENAI_API_KEY')
gemini_api_key = os.environ.get('GEMINI_API_KEY')
anthropic_api_key = os.environ.get('ANTHROPIC_API_KEY')
mistral_api_key = os.environ.get('MISTRAL_API_KEY')

# Captured at startup — used by the Bedrock botocore event handler to fetch
# a fresh OAuth token from the worker thread that boto3 runs in.
_main_loop: asyncio.AbstractEventLoop | None = None


@asynccontextmanager
async def _lifespan(_: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    logger.info("Event loop captured for Bedrock gateway token injection")

    yield


app = FastAPI(
    title="Bank of Asgard — Transactions Agent",
    version="1.0.0",
    lifespan=_lifespan,
)


class TextResponse(BaseModel):
    type: Literal["message"] = "message"
    content: str


# Build model client based on configured provider
_gateway_cfg = _llm_cfg.get("gateway", {})
_use_gateway = _gateway_cfg.get("enabled", False)

_default_models = {
    "gemini": "gemini-2.5-flash-lite",
    "anthropic": "claude-sonnet-4-5-20250929",
    "bedrock": "eu.anthropic.claude-sonnet-4-6",
    "openai": "gpt-4o-mini",
    "mistral": "mistral-small-latest",
}

_bedrock_region = os.environ.get("AWS_DEFAULT_REGION", "eu-north-1")


def _build_gateway_model(gw_url: str, token_manager: GatewayTokenManager):
    """Build a Strands model client routed via the WSO2 API Gateway."""
    if llm_provider == 'bedrock':
        # Use BedrockModel with the Converse API format over the gateway.
        # SigV4 signing is disabled; the gateway OAuth bearer token is injected
        # via a botocore before-send event so it's always fresh at request time.
        logger.info(
            "Building Bedrock Converse gateway model (endpoint=%s, model=%s)",
            gw_url, llm_model or _default_models["bedrock"],
        )

        def _inject_bearer(request, **__):  # noqa: ANN003
            # _stream() runs in asyncio.to_thread — use run_coroutine_threadsafe
            # to fetch a fresh token from the main event loop.
            if _main_loop and _main_loop.is_running():
                token = asyncio.run_coroutine_threadsafe(
                    token_manager.get_token(), _main_loop
                ).result(timeout=10)
            else:
                token = token_manager.cached_token or ""
            if token:
                request.headers['Authorization'] = f'Bearer {token}'

        model = BedrockModel(
            endpoint_url=gw_url,
            region_name=_bedrock_region,
            boto_client_config=BotocoreConfig(
                signature_version=botocore.UNSIGNED,
                read_timeout=120,
            ),
            model_id=llm_model or _default_models["bedrock"],
            max_tokens=4096,
            streaming=False,
        )
        model.client.meta.events.register('before-send.bedrock-runtime.*', _inject_bearer)
        return model
    elif llm_provider == 'anthropic':
        http_client = httpx.AsyncClient(auth=GatewayBearerAuth(token_manager), verify=_ssl_verify)
        return AnthropicModel(
            client_args={"base_url": gw_url, "api_key": "unused", "http_client": http_client},
            model_id=llm_model or _default_models["anthropic"],
            max_tokens=4096,
        )
    else:
        http_client = httpx.AsyncClient(auth=GatewayBearerAuth(token_manager), verify=_ssl_verify)
        gw_openai_client = openai.AsyncOpenAI(
            base_url=gw_url,
            api_key="unused",
            http_client=http_client,
        )
        return OpenAIModel(
            client=gw_openai_client,
            model_id=llm_model or _default_models.get(llm_provider, "gpt-4o-mini"),
        )


if _use_gateway:
    logger.info("LLM routing via WSO2 API Gateway (provider=%s)", llm_provider)
    _gw_token_manager = GatewayTokenManager(
        token_endpoint=os.environ["GATEWAY_TOKEN_ENDPOINT"],
        client_id=os.environ["GATEWAY_CLIENT_ID"],
        client_secret=os.environ["GATEWAY_CLIENT_SECRET"],
    )
    model_client = _build_gateway_model(os.environ["GATEWAY_BASE_URL"], _gw_token_manager)
    model_client_secured = _build_gateway_model(os.environ["GATEWAY_BASE_URL_SECURED"], _gw_token_manager)
    logger.info("Gateway base URL: %s", os.environ["GATEWAY_BASE_URL"])
    logger.info("Gateway secured URL: %s", os.environ["GATEWAY_BASE_URL_SECURED"])
else:
    match llm_provider:
        case 'bedrock':
            model_client = BedrockModel(
                model_id=llm_model or _default_models["bedrock"],
                region_name=_bedrock_region,
            )
            logger.info(
                "Using AWS Bedrock Converse API directly (region=%s, model=%s)",
                _bedrock_region, llm_model or _default_models["bedrock"],
            )
        case 'gemini':
            model_client = OpenAIModel(
                client_args={
                    "api_key": gemini_api_key,
                    "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
                },
                model_id=llm_model or _default_models["gemini"],
            )
        case 'anthropic':
            model_client = AnthropicModel(
                client_args={"api_key": anthropic_api_key},
                model_id=llm_model or _default_models["anthropic"],
                max_tokens=4096,
            )
        case 'mistral':
            model_client = OpenAIModel(
                client_args={
                    "api_key": mistral_api_key,
                    "base_url": "https://api.mistral.ai/v1",
                },
                model_id=llm_model or _default_models["mistral"],
            )
        case _:  # default: openai
            model_client = OpenAIModel(
                client_args={"api_key": openai_api_key},
                model_id=llm_model or _default_models["openai"],
                params={"temperature": 0.1, "max_tokens": 2000},
            )
    model_client_secured = model_client

# MCP token manager — uses the agent's own client credentials (AGENT_ID/AGENT_SECRET)
# to obtain a bearer token for the agencies-mcp-server JWT check.
# This is separate from the LLM gateway credentials.
_mcp_token_manager: GatewayTokenManager | None = None
if agent_id and agent_secret and base_url:
    _mcp_token_manager = GatewayTokenManager(
        token_endpoint=f"{base_url}/oauth2/token",
        client_id=agent_id,
        client_secret=agent_secret,
        scope=os.environ.get("MCP_TOKEN_SCOPE"),
    )
    set_agencies_token_provider(_mcp_token_manager.get_token)
    logger.info("MCP token manager initialised (scope=%s)", os.environ.get("MCP_TOKEN_SCOPE", "default"))
else:
    logger.warning("AGENT_ID/AGENT_SECRET/IDP_BASE_URL not set — GetAgencies tool will not authenticate to MCP server")


@strands_tool
async def GetAgencies(town: str) -> str:
    """Find Bank of Asgard branches and agencies near a given town.

    Args:
        town: The name of the town or city to search near (e.g. "Paris", "London").

    Returns:
        A JSON list of agency objects with name, address, phone, opening_hours, and services.
    """
    return await _get_agencies(town)


# Per-session state — each WebSocket gets its own auth manager and token cache
auth_managers: Dict[str, AutogenAuthManager] = {}
state_mapping: Dict[str, str] = {}
websocket_connections: Dict[str, WebSocket] = {}


def _describe_guardrail(msg: dict) -> str:
    """Turn a Bedrock guardrail assessment dict into a demo-friendly message."""
    assessments = msg.get("assessments") or {}
    parts = []

    content = assessments.get("contentPolicy") or {}
    for f in content.get("filters", []):
        if f.get("detected") and f.get("action") == "BLOCKED":
            label = f.get("type", "unknown").lower().replace("_", " ")
            conf = f.get("confidence", "").lower()
            parts.append(f"content policy ({label}, {conf} confidence)" if conf else f"content policy ({label})")

    topic = assessments.get("topicPolicy") or {}
    for t in topic.get("topics", []):
        if t.get("action") == "BLOCKED":
            parts.append(f"topic policy ({t.get('name', 'restricted topic')})")

    if assessments.get("wordPolicy"):
        parts.append("word policy (custom blocked word)")

    pii = assessments.get("sensitiveInformationPolicy") or {}
    for p in pii.get("piiEntities", []):
        if p.get("action") == "BLOCKED":
            parts.append(f"sensitive information policy ({p.get('type', 'PII')})")

    direction = msg.get("direction", "").upper()
    suffix = " in your message" if direction == "REQUEST" else " in the response" if direction == "RESPONSE" else ""

    if parts:
        return f"Your request was blocked by a guardrail — {', '.join(parts)} triggered{suffix}."
    return msg.get("actionReason") or "Your request was blocked by an AI guardrail policy."


def _handle_httpx_error(cause: httpx.HTTPStatusError) -> str | None:
    status = cause.response.status_code
    if status == 446:
        logger.warning("Guardrail triggered (446): %s", cause.response.text)
        try:
            data = cause.response.json()
            msg = data.get("description") or data.get("message") or data.get("detail")
            if isinstance(msg, dict):
                msg = msg.get("actionReason") or msg.get("action") or str(msg)
            return msg or cause.response.text or "Your request was blocked by an AI guardrail policy."
        except Exception:
            return cause.response.text or "Your request was blocked by an AI guardrail policy."
    if status == 429:
        logger.warning("Rate limit hit (429): %s", cause.response.text)
        return "I'm currently busy — the AI service is at capacity. Please try again in a moment."
    return None


def _handle_botocore_error(cause: botocore.exceptions.ClientError) -> str | None:
    status = cause.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if status == 446:
        logger.warning("Guardrail triggered (446) via Bedrock: %s", cause.response)
        try:
            error = cause.response.get("Error", {})
            msg = error.get("Message") or error.get("message") or ""
            if isinstance(msg, str):
                try:
                    msg = json.loads(msg)
                except Exception:  # noqa: S110
                    pass
            if isinstance(msg, dict):
                return _describe_guardrail(msg)
            return msg or "Your request was blocked by an AI guardrail policy."
        except Exception:
            return "Your request was blocked by an AI guardrail policy."
    if status == 429:
        logger.warning("Rate limit hit (429) via Bedrock")
        return "I'm currently busy — the AI service is at capacity. Please try again in a moment."
    return None


def _extract_gateway_error(e: Exception) -> str | None:
    """Walk the exception chain looking for known gateway HTTP errors and return a user-friendly message."""
    cause = e
    while cause is not None:
        if isinstance(cause, httpx.HTTPStatusError):
            if result := _handle_httpx_error(cause):
                return result
        if isinstance(cause, botocore.exceptions.ClientError):
            if result := _handle_botocore_error(cause):
                return result
        cause = getattr(cause, "__cause__", None) or getattr(cause, "__context__", None)

    msg = str(e)
    if "446" in msg or "900514" in msg:
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


@_agent_decorator(name="banking_assistant")
async def _invoke_agent(assistant: Agent, user_input: str) -> str:
    """Single-turn agent invocation — traced as an agent span when AMP is active."""
    result = await assistant.invoke_async(user_input)
    return str(result)


async def run_agent(assistant: Agent, websocket: WebSocket):
    """Run the chat loop — receive user messages and stream agent responses."""
    while True:
        user_input = await websocket.receive_text()

        if user_input.strip().lower() == "exit":
            await websocket.close()
            break

        try:
            result = await _invoke_agent(assistant, user_input)
            await websocket.send_json(
                TextResponse(content=result).model_dump()
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
async def websocket_endpoint(websocket: WebSocket, session_id: str, secured: bool = False):
    """WebSocket endpoint for the Transaction Assistant chat."""

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
    get_transactions_tool = SecureStrandsTool(
        func=get_my_transactions,
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

    active_model = model_client_secured if secured else model_client
    logger.info("Session %s using %s gateway", session_id, "secured" if secured else "base")

    if _HAS_TRACELOOP and _Traceloop:
        _Traceloop.set_association_properties({"session_id": session_id})

    banking_assistant = Agent(
        model=active_model,
        tools=[get_transactions_tool, GetAgencies],
        system_prompt=agent_system_prompt,
        callback_handler=None,
    )

    await websocket.accept()

    try:
        await websocket.send_json(TextResponse(content=WELCOME_MESSAGE).model_dump())

        await run_agent(banking_assistant, websocket)
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
        raise HTTPException(status_code=500, detail=str(e))
