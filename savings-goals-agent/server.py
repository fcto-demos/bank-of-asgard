import json
import logging
import os
import time
from functools import cached_property
from pathlib import Path

import anthropic as _anthropic_sdk
import httpx
import jwt as pyjwt
import uvicorn
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from traceloop.sdk import Traceloop
from pydantic import BaseModel, PrivateAttr
from starlette.middleware.base import BaseHTTPMiddleware

from audit_log import emit_token_event, register_actor_name, set_transaction
from gateway import GatewayTokenManager, GatewayBearerAuth
from projections import project_milestones

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

IDP_BASE_URL = os.environ["IDP_BASE_URL"]
SSL_VERIFY = os.environ.get("SSL_VERIFY", "true").lower() != "false"
EXPECTED_AUDIENCE = os.environ["EXPECTED_AUDIENCE"]

# The resource label "savings_agent" (used as a destination in transactions-agent's
# auth_manager.py) and this service's own name both refer to the same real entity —
# register the synonym so they don't fragment into separate actors in the audit trail.
register_actor_name("savings-goals-agent", "Savings Agent")


class GatewayChatAnthropic(ChatAnthropic):
    """ChatAnthropic subclass that injects gateway Bearer auth via a custom httpx client.

    ChatAnthropic builds its own internal httpx client and does not expose http_client
    as a constructor parameter (passing it gets silently absorbed into model_kwargs and
    never used). This subclass overrides _async_client to inject our GatewayBearerAuth
    handler so tokens are refreshed transparently on each request. Copied from
    transactions-agent/langchain-agent/service.py's identical subclass.
    """

    _gw_auth: GatewayBearerAuth = PrivateAttr()

    def __init__(self, *, gw_auth: GatewayBearerAuth, **data):
        super().__init__(**data)
        self._gw_auth = gw_auth

    @cached_property
    def _async_client(self) -> _anthropic_sdk.AsyncAnthropic:
        http_client = httpx.AsyncClient(auth=self._gw_auth, verify=SSL_VERIFY)
        return _anthropic_sdk.AsyncAnthropic(**self._client_params, http_client=http_client)


# ── Bearer token validation (copied from agencies-mcp-server/server.py — each service
# is independently deployable, so this small block is duplicated rather than shared) ──

_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600  # 1 hour


def _fetch_jwks() -> dict:
    """Fetch JWKS from IDP with a 1-hour TTL cache."""
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache is None or (now - _jwks_fetched_at) > _JWKS_TTL:
        url = f"{IDP_BASE_URL}/oauth2/jwks"
        logger.info("Fetching JWKS from %s", url)
        resp = httpx.get(url, verify=SSL_VERIFY, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
    return _jwks_cache


def _invalidate_jwks_cache() -> None:
    global _jwks_cache
    _jwks_cache = None


def _validate_token(token: str) -> None:
    """Validate a JWT bearer token against the IDP's JWKS. Raises on failure.

    Retries once with a fresh JWKS fetch if all cached keys fail, to handle
    IDP key rotation without requiring a process restart.
    """
    try:
        unverified = pyjwt.decode(token, options={"verify_signature": False})
        logger.info(
            "Token claims — aud=%r  sub=%r  iss=%r  exp=%r",
            unverified.get("aud"),
            unverified.get("sub"),
            unverified.get("iss"),
            unverified.get("exp"),
        )
        emit_token_event(
            service="savings-goals-agent", event="validated_incoming",
            origin=unverified.get("sub"), destination="savings-goals-agent",
            access_token=token, client_id=EXPECTED_AUDIENCE,
            requested_by=unverified.get("sub"), sub=unverified.get("sub"),
            act=unverified.get("act"), aud=unverified.get("aud"), exp=unverified.get("exp"),
        )
    except Exception as peek_err:
        logger.warning("Could not decode token for inspection: %s", peek_err)

    logger.info("Expected audience: %r", EXPECTED_AUDIENCE)

    last_err: Exception | None = None
    for attempt in range(2):
        jwks = _fetch_jwks()
        signing_keys = [k for k in jwks.get("keys", []) if k.get("use") == "sig"]
        if not signing_keys:
            signing_keys = jwks.get("keys", [])
        if not signing_keys:
            raise ValueError("No signing keys found in JWKS")

        last_err = None
        for key_data in signing_keys:
            try:
                public_key = pyjwt.algorithms.RSAAlgorithm.from_jwk(key_data)
                pyjwt.decode(
                    token,
                    public_key,
                    algorithms=["RS256"],
                    audience=EXPECTED_AUDIENCE,
                )
                return
            except Exception as e:
                last_err = e

        if attempt == 0:
            logger.warning("All JWKS keys failed — invalidating cache and retrying once")
            _invalidate_jwks_cache()

    raise last_err or ValueError("Token validation failed")


class BearerAuthMiddleware(BaseHTTPMiddleware):
    """Validates the Authorization header on every request. No SSE/streaming responses
    on this service, so BaseHTTPMiddleware (unlike the agencies MCP server) is fine here."""

    async def dispatch(self, request: Request, call_next):
        # Set from the header (not the body — the body isn't parsed yet at this point)
        # so _validate_token's audit event is tagged with the right transaction_id too.
        set_transaction(request.headers.get("x-transaction-id"))
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            logger.warning("Request rejected — missing or invalid Authorization header")
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        token = auth[len("Bearer "):]
        try:
            _validate_token(token)
        except Exception as exc:
            logger.warning("Request rejected — token validation failed: %s", exc)
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)


# ── LLM construction — trimmed copy of langchain-agent/service.py's gateway logic.
# Always uses GATEWAY_BASE_URL (v1/unsecured): this service never sees raw user chat
# input, only structured summaries, so it's not subject to the AI guardrails toggle. ──

def _load_llm_config() -> dict:
    """Load LLM config from llm_config.yaml.

    LLM_CONFIG_PATH overrides the search entirely — point it at a mounted file (a
    directory is also accepted, and llm_config.yaml is read from inside it). An explicit
    path that doesn't exist is a deployment error, not a reason to guess: falling back to
    the openai/gpt-4o-mini default would silently bypass the gateway, so raise instead.

    With no override, searches: service dir (Docker mount), repo root (native
    development), then /etc/config (the conventional mount point on hosts that project
    config files into it).
    """
    override = os.environ.get("LLM_CONFIG_PATH")
    if override:
        path = Path(override).expanduser()
        if path.is_dir():
            path = path / "llm_config.yaml"
        if not path.is_file():
            raise FileNotFoundError(
                f"LLM_CONFIG_PATH is set to {override!r} but no config file was found "
                f"at {path} — refusing to fall back to defaults."
            )
        logger.info("Loading LLM config from %s (LLM_CONFIG_PATH)", path)
        with open(path) as f:
            return yaml.safe_load(f) or {}

    candidates = [
        Path(__file__).parent / "llm_config.yaml",
        Path(__file__).parent.parent / "llm_config.yaml",
        Path("/etc/config/llm_config.yaml"),
    ]
    for path in candidates:
        if path.is_file():
            logger.info("Loading LLM config from %s", path)
            with open(path) as f:
                return yaml.safe_load(f) or {}
    logger.warning("llm_config.yaml not found — falling back to openai/gpt-4o-mini")
    return {}


_llm_cfg = _load_llm_config()
_llm_provider = _llm_cfg.get("provider", "openai").lower()
_llm_model = _llm_cfg.get("model")
_gateway_cfg = _llm_cfg.get("gateway", {})
_use_gateway = _gateway_cfg.get("enabled", False)

_default_models = {
    "gemini": "gemini-2.5-flash-lite",
    "anthropic": "claude-haiku-4-5",
    "openai": "gpt-4o-mini",
    "mistral": "mistral-small-latest",
}

if _use_gateway:
    logger.info("LLM routing via WSO2 API Gateway (provider=%s, v1/unsecured)", _llm_provider)
    _gw_token_manager = GatewayTokenManager(
        token_endpoint=os.environ["GATEWAY_TOKEN_ENDPOINT"],
        client_id=os.environ["GATEWAY_CLIENT_ID"],
        client_secret=os.environ["GATEWAY_CLIENT_SECRET"],
        ssl_verify=SSL_VERIFY,
    )
    _gw_auth = GatewayBearerAuth(_gw_token_manager)
    if _llm_provider == "anthropic":
        llm = GatewayChatAnthropic(
            model=_llm_model or _default_models["anthropic"],
            anthropic_api_url=os.environ["GATEWAY_BASE_URL"],
            anthropic_api_key="unused",
            gw_auth=_gw_auth,
        )
    else:
        llm = ChatOpenAI(
            model=_llm_model or _default_models.get(_llm_provider, "gpt-4o-mini"),
            base_url=os.environ["GATEWAY_BASE_URL"],
            api_key="unused",
            http_async_client=httpx.AsyncClient(auth=_gw_auth, verify=SSL_VERIFY),
        )
else:
    match _llm_provider:
        case "anthropic":
            llm = ChatAnthropic(
                model=_llm_model or _default_models["anthropic"],
                anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY"),
            )
        case "gemini":
            llm = ChatOpenAI(
                model=_llm_model or _default_models["gemini"],
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                api_key=os.environ.get("GEMINI_API_KEY"),
            )
        case "mistral":
            llm = ChatOpenAI(
                model=_llm_model or _default_models["mistral"],
                base_url="https://api.mistral.ai/v1",
                api_key=os.environ.get("MISTRAL_API_KEY"),
            )
        case _:
            llm = ChatOpenAI(
                model=_llm_model or _default_models["openai"],
                api_key=os.environ.get("OPENAI_API_KEY"),
            )


SAVINGS_GOAL_PROMPT = """You are the Savings Goals agent for Bank of Asgard.

You are given: a subscription summary, a spending-health summary, the recoverable monthly
amount, and projected balances if that amount were saved monthly at a steady rate over 1,
5, and 10 years (already computed — do not recompute or alter these numbers).

Write a short, encouraging recommendation (3-5 sentences) that:
- Proposes a concrete savings goal name (e.g. "Asgard Vault — Rainy Day Fund").
- States the recoverable monthly amount.
- Cites the 1, 5, and 10 year projected balances exactly as given, to make the case tangible.
- Is warm and motivating, never preachy.

Respond with a JSON object: {"goal_name": str, "message": str}. No other text."""


class SuggestGoalRequest(BaseModel):
    subscription_summary: str
    spending_summary: str
    monthly_recoverable: float
    # Decoded server-side by the Coordinator from the user's OBO token (never LLM-supplied)
    # — ties this call back to whose consented data is being delegated, for audit purposes.
    user_sub: str | None = None
    # The Coordinator's session_id, forwarded so this agent's spans share the same
    # Traceloop association property — OTEL context doesn't cross the process boundary.
    transaction_id: str | None = None


app = FastAPI(title="Bank of Asgard — Savings Goals Agent", version="1.0.0")
app.add_middleware(BearerAuthMiddleware)


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/suggest-goal")
async def suggest_goal(req: SuggestGoalRequest):
    set_transaction(req.transaction_id)

    if req.transaction_id:
        Traceloop.set_association_properties({"transaction_id": req.transaction_id})

    projected_balances = project_milestones(req.monthly_recoverable)

    prompt_input = {
        "subscription_summary": req.subscription_summary,
        "spending_summary": req.spending_summary,
        "monthly_recoverable": req.monthly_recoverable,
        "projected_balances": projected_balances,
    }
    logger.info(
        "Suggesting savings goal — user_sub=%r monthly_recoverable=%.2f",
        req.user_sub, req.monthly_recoverable,
    )

    response = await llm.ainvoke([
        SystemMessage(content=SAVINGS_GOAL_PROMPT),
        HumanMessage(content=json.dumps(prompt_input)),
    ])
    try:
        parsed = json.loads(response.content)
        goal_name = parsed.get("goal_name", "Savings Goal")
        message = parsed.get("message", response.content)
    except (json.JSONDecodeError, TypeError):
        goal_name = "Savings Goal"
        message = response.content

    return {
        "goal_name": goal_name,
        "suggested_monthly_amount": req.monthly_recoverable,
        "projected_balances": projected_balances,
        "message": message,
    }


if __name__ == "__main__":
    logger.info("Starting Savings Goals agent on port 8013 (IDP: %s)", IDP_BASE_URL)
    uvicorn.run(app, host="0.0.0.0", port=8013)  # noqa: S104
