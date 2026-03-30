import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Literal, Dict

import httpx
import openai
import yaml
from fastapi.responses import HTMLResponse
from strands import Agent
from strands.models import AnthropicModel, OpenAIModel
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from app.prompt import agent_system_prompt
from app.tools import get_my_transactions
from strands.tool import SecureStrandsTool
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

load_dotenv()


class GatewayTokenManager:
    """Fetches and caches an OAuth2 client-credentials token for the WSO2 API Gateway."""

    def __init__(self, token_endpoint: str, client_id: str, client_secret: str):
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def get_token(self) -> str:
        async with self._lock:
            if self._token and time.monotonic() < self._expires_at:
                return self._token
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    self._token_endpoint,
                    data={"grant_type": "client_credentials"},
                    auth=(self._client_id, self._client_secret),
                )
                resp.raise_for_status()
                data = resp.json()
            self._token = data["access_token"]
            self._expires_at = time.monotonic() + data.get("expires_in", 3600) - 30
            logger.info("Gateway access token refreshed (expires in %ss)", data.get("expires_in", 3600))
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
        Path(__file__).parent.parent / "llm_config.yaml",        # Docker: /app/llm_config.yaml
        Path(__file__).parent.parent.parent / "llm_config.yaml", # native: repo root
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

app = FastAPI(
    title="Bank of Asgard — Transactions Agent",
    version="1.0.0",
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
    "openai": "gpt-4o-mini",
}


def _build_gateway_model(gw_url: str, token_manager: GatewayTokenManager):
    """Build a Strands model client routed via the WSO2 API Gateway."""
    http_client = httpx.AsyncClient(auth=GatewayBearerAuth(token_manager))
    if llm_provider == 'anthropic':
        return AnthropicModel(
            client_args={"base_url": gw_url, "api_key": "unused", "http_client": http_client},
            model_id=llm_model or _default_models["anthropic"],
            max_tokens=4096,
        )
    else:
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
elif llm_provider == 'gemini':
    model_client = OpenAIModel(
        client_args={
            "api_key": gemini_api_key,
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        },
        model_id=llm_model or _default_models["gemini"],
    )
    model_client_secured = model_client
elif llm_provider == 'anthropic':
    model_client = AnthropicModel(
        client_args={"api_key": anthropic_api_key},
        model_id=llm_model or _default_models["anthropic"],
        max_tokens=4096,
    )
    model_client_secured = model_client
else:  # default: openai
    model_client = OpenAIModel(
        client_args={"api_key": openai_api_key},
        model_id=llm_model or _default_models["openai"],
        params={"temperature": 0.1, "max_tokens": 2000},
    )
    model_client_secured = model_client

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


async def run_agent(assistant: Agent, websocket: WebSocket):
    """Run the chat loop — receive user messages and stream agent responses."""
    while True:
        user_input = await websocket.receive_text()

        if user_input.strip().lower() == "exit":
            await websocket.close()
            break

        try:
            result = await assistant.invoke_async(user_input)
            await websocket.send_json(
                TextResponse(content=str(result)).model_dump()
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

    banking_assistant = Agent(
        model=active_model,
        tools=[get_transactions_tool],
        system_prompt=agent_system_prompt,
        callback_handler=None,
    )

    await websocket.accept()

    try:
        await websocket.send_json(TextResponse(
            content=(
                "Welcome to Bank of Asgard! I'm your Transaction Assistant. "
                "I can help you review your transaction history, analyse your spending, "
                "and answer questions about your account activity. "
                "What would you like to know?"
            )
        ).model_dump())

        await run_agent(banking_assistant, websocket)
    except WebSocketDisconnect:
        logger.info(f"Session {session_id} disconnected")
    except Exception as e:
        logger.error(f"Session {session_id} error: {str(e)}")
        try:
            await websocket.send_json(
                TextResponse(content=_user_friendly_error(e)).model_dump()
            )
        except Exception:
            pass
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
        token = await auth_manager.process_callback(state, code)

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
