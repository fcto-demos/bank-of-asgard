"""Ministry of Finance — Tax Filing Agent.

A deliberately *cross-organisation* agent: it is not part of Bank of Asgard. The bank's
Coordinator calls it with a token audienced for this service, carrying only the
aggregate deduction figures the citizen consented to share — never the underlying
transactions. See tax_rules.py for the arithmetic, which never goes near the LLM.

Structurally a sibling of savings-goals-agent/server.py (same bearer validation, same
gateway LLM construction); the interesting difference is what crosses the boundary.
"""

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
from tax_rules import assess

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

IDP_BASE_URL = os.environ["IDP_BASE_URL"]
SSL_VERIFY = os.environ.get("SSL_VERIFY", "true").lower() != "false"
EXPECTED_AUDIENCE = os.environ["EXPECTED_AUDIENCE"]

# The resource label "tax_agent" (used as a destination in transactions-agent's
# service.py) and this service's own name both refer to the same real entity —
# register the synonym so they don't fragment into separate actors in the audit trail.
register_actor_name("tax-agent", "Tax Agent")


class GatewayChatAnthropic(ChatAnthropic):
    """ChatAnthropic subclass that injects gateway Bearer auth via a custom httpx client.

    ChatAnthropic builds its own internal httpx client and does not expose http_client
    as a constructor parameter (passing it gets silently absorbed into model_kwargs and
    never used). This subclass overrides _async_client to inject our GatewayBearerAuth
    handler so tokens are refreshed transparently on each request. Copied from
    savings-goals-agent/server.py's identical subclass.
    """

    _gw_auth: GatewayBearerAuth = PrivateAttr()

    def __init__(self, *, gw_auth: GatewayBearerAuth, **data):
        super().__init__(**data)
        self._gw_auth = gw_auth

    @cached_property
    def _async_client(self) -> _anthropic_sdk.AsyncAnthropic:
        http_client = httpx.AsyncClient(auth=self._gw_auth, verify=SSL_VERIFY)
        return _anthropic_sdk.AsyncAnthropic(**self._client_params, http_client=http_client)


# ── Bearer token validation (copied from savings-goals-agent/server.py — each service
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
            service="tax-agent", event="validated_incoming",
            origin=unverified.get("sub"), destination="tax-agent",
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
        if request.url.path == "/health":
            return await call_next(request)
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


# ── LLM construction — trimmed copy of savings-goals-agent/server.py's gateway logic.
# Always uses GATEWAY_BASE_URL (v1/unsecured): this service never sees raw user chat
# input, only structured aggregates, so it's not subject to the AI guardrails toggle. ──

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


TAX_SUMMARY_PROMPT = """You are the Tax Filing agent for the Kingdom of Asgard's Ministry of Finance.

You are given a completed assessment: gross income, the reliefs granted under the published
rules, total deductions, taxable income, tax before and after reliefs, and the estimated
saving. Every number has already been computed under the published rules — do not
recompute, adjust, or invent any figure. Quote them exactly as given.

Write a short, plain-language summary (4-6 sentences) for the citizen that:
- States which reliefs were applied and what they are worth in total.
- Gives the taxable income and the estimated tax saving, exactly as provided.
- Names any relief marked as needing evidence, and says receipts must be attached before filing.
- States the filing deadline.
- Is factual and neutral in tone — this is a government service, not a sales pitch.
  Never promise an outcome, and never advise the citizen how to reduce tax further.

Write figures as plain numbers with no currency symbol — the amounts are notional units
and attaching the wrong currency to a tax figure is worse than attaching none.

Respond with a raw JSON object: {"headline": str, "message": str}. No other text, and no
markdown code fences around it."""


def _parse_llm_json(content: str | list) -> dict:
    """Parse the model's JSON reply, tolerating a ```json fence around it.

    Models wrap structured replies in a fence often enough that treating it as a parse
    failure would silently downgrade every response to the fallback text. `content` is
    typed as a union because LangChain messages can carry content blocks rather than a
    plain string; anything but a string goes to the caller's fallback.
    """
    if not isinstance(content, str):
        raise TypeError(f"expected string content, got {type(content).__name__}")
    text = content.strip()
    if text.startswith("```"):
        # Drop the opening fence (with or without a language tag) and the closing one.
        text = text.split("\n", 1)[-1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[: -len("```")]
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise TypeError(f"expected a JSON object, got {type(parsed).__name__}")
    return parsed


class PrepareReturnRequest(BaseModel):
    """The whole payload the ministry receives.

    Note what is *absent*: no transaction list, no merchant names, no dates, no account
    identifiers. The bank classifies spend into the published relief categories on its
    own side and sends only per-category totals — the data-minimisation point the demo
    is built to make.
    """

    gross_income: float
    # Per-category qualifying spend, keyed by the buckets in tax_rules.RELIEF_RULES.
    qualifying_spend: dict[str, float]
    tax_id: str | None = None
    # Decoded server-side by the Coordinator from the user's OBO token (never LLM-supplied)
    # — ties this call back to whose consented data is being delegated, for audit purposes.
    user_sub: str | None = None
    # The Coordinator's session_id, forwarded so this agent's spans share the same
    # Traceloop association property — OTEL context doesn't cross the process boundary.
    transaction_id: str | None = None


app = FastAPI(title="Ministry of Finance — Tax Filing Agent", version="1.0.0")
app.add_middleware(BearerAuthMiddleware)


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/prepare-return")
async def prepare_return(req: PrepareReturnRequest):
    set_transaction(req.transaction_id)

    if req.transaction_id:
        Traceloop.set_association_properties({"transaction_id": req.transaction_id})

    assessment = assess(req.gross_income, req.qualifying_spend)

    logger.info(
        "Preparing return — user_sub=%r tax_id=%r categories=%s total_deductions=%.2f",
        req.user_sub, req.tax_id, sorted(req.qualifying_spend), assessment["total_deductions"],
    )

    response = await llm.ainvoke([
        SystemMessage(content=TAX_SUMMARY_PROMPT),
        HumanMessage(content=json.dumps(assessment)),
    ])
    try:
        parsed = _parse_llm_json(response.content)
        headline = parsed.get("headline", "Draft tax return prepared")
        message = parsed.get("message", response.content)
    except (json.JSONDecodeError, TypeError, AttributeError) as exc:
        logger.warning("Could not parse LLM reply as JSON (%s) — using raw text", exc)
        headline = "Draft tax return prepared"
        message = response.content

    return {
        "headline": headline,
        "message": message,
        "assessment": assessment,
        "reference": f"ASG-{assessment['tax_year']}-DRAFT",
    }


if __name__ == "__main__":
    logger.info("Starting Tax Filing agent on port 8014 (IDP: %s)", IDP_BASE_URL)
    uvicorn.run(app, host="0.0.0.0", port=8014)  # noqa: S104
