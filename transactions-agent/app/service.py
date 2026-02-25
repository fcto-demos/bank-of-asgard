import logging
import os
from pathlib import Path
from typing import Literal, Dict

import yaml
from fastapi.responses import HTMLResponse
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.messages import TextMessage
from autogen_core import CancellationToken
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core.models import ModelFamily, ModelInfo
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect

from app.prompt import agent_system_prompt
from app.tools import get_my_transactions
from autogen.tool import SecureFunctionTool
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
logging.getLogger("autogen_core.events").setLevel(logging.WARNING)
logging.getLogger("autogen_core").setLevel(logging.WARNING)
logging.getLogger("autogen_agentchat").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

load_dotenv()

# Asgardeo configuration
client_id = os.environ.get('ASGARDEO_CLIENT_ID')
base_url = os.environ.get('ASGARDEO_BASE_URL')
redirect_uri = os.environ.get('ASGARDEO_REDIRECT_URI', 'http://localhost:8011/callback')

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
if llm_provider == 'gemini':
    model_client = OpenAIChatCompletionClient(
        model=llm_model or "gemini-2.5-flash-lite",
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=gemini_api_key,
        model_info=ModelInfo(
            vision=True,
            function_calling=True,
            json_output=True,
            structured_output=True,
            family=ModelFamily.UNKNOWN,
        ),
    )
elif llm_provider == 'anthropic':
    model_client = OpenAIChatCompletionClient(
        model=llm_model or "claude-sonnet-4-5-20250929",
        base_url="https://api.anthropic.com/v1/",
        api_key=anthropic_api_key,
        model_info=ModelInfo(
            vision=True,
            function_calling=True,
            json_output=True,
            structured_output=True,
            family=ModelFamily.UNKNOWN,
        ),
    )
else:  # default: openai
    model_client = OpenAIChatCompletionClient(
        model=llm_model or "gpt-4o-mini",
        api_key=openai_api_key,
        model_kwargs={
            "temperature": 0.1,
            "max_tokens": 2000,
        }
    )

# Per-session state — each WebSocket gets its own auth manager and token cache
auth_managers: Dict[str, AutogenAuthManager] = {}
state_mapping: Dict[str, str] = {}
websocket_connections: Dict[str, WebSocket] = {}


def _user_friendly_error(e: Exception) -> str:
    msg = str(e)
    if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
        return "I'm currently unavailable due to API rate limits. Please try again shortly."
    if "401" in msg or "authentication" in msg.lower() or "api key" in msg.lower():
        return "There is a configuration problem with the AI service. Please contact the administrator."
    if "timeout" in msg.lower():
        return "The request timed out. Please try again."
    return "An unexpected error occurred. Please try again."


async def run_agent(assistant: AssistantAgent, websocket: WebSocket):
    """Run the chat loop — receive user messages and stream agent responses."""
    while True:
        user_input = await websocket.receive_text()

        if user_input.strip().lower() == "exit":
            await websocket.close()
            break

        try:
            response = await assistant.on_messages(
                [TextMessage(content=user_input, source="user")],
                cancellation_token=CancellationToken()
            )

            for i, msg in enumerate(response.inner_messages):
                logger.debug(f"[Agent Step {i + 1}] {msg.content}")

            await websocket.send_json(
                TextResponse(content=response.chat_message.content).model_dump()
            )
        except Exception as e:
            logger.error(f"Agent error processing message: {e}")
            await websocket.send_json(
                TextResponse(content=_user_friendly_error(e)).model_dump()
            )


@app.websocket("/chat")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
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
    get_transactions_tool = SecureFunctionTool(
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

    banking_assistant = AssistantAgent(
        "banking_assistant",
        model_client=model_client,
        tools=[get_transactions_tool],
        reflect_on_tool_use=True,
        system_message=agent_system_prompt,
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
