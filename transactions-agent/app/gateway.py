import asyncio
import json
import logging
import os
import time
from typing import Any

import httpx

from app.audit_log import emit_token_event

logger = logging.getLogger(__name__)


class GatewayTokenManager:
    """Fetches and caches an OAuth2 client-credentials token for the WSO2 API Gateway."""

    def __init__(
        self,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        scope: str | None = None,
        ssl_verify: bool = True,
    ):
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._scope = scope
        self._ssl_verify = ssl_verify
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
                emit_token_event(
                    service="transactions-agent", event="cache_hit",
                    origin="transactions-agent", destination="wso2-gateway",
                    access_token=self._token, kind="GATEWAY",
                    client_id=self._client_id, resource="llm_gateway",
                    requested_by=self._client_id,
                )
                return self._token
            data: dict = {"grant_type": "client_credentials"}
            if self._scope:
                data["scope"] = self._scope
            logger.info(
                "Requesting client-credentials token from %s (client_id=%s)",
                self._token_endpoint, self._client_id,
            )
            emit_token_event(
                service="transactions-agent", event="gateway_token_fetch",
                origin="transactions-agent", destination="wso2-gateway",
                grant_type="client_credentials", kind="GATEWAY",
                client_id=self._client_id, resource="llm_gateway",
                requested_by=self._client_id,
            )
            async with httpx.AsyncClient(verify=self._ssl_verify) as client:
                resp = await client.post(
                    self._token_endpoint,
                    data=data,
                    auth=(self._client_id, self._client_secret),
                )
                if not resp.is_success:
                    logger.error(
                        "Token request failed: %s %s — body: %s",
                        resp.status_code, resp.reason_phrase, resp.text,
                    )
                resp.raise_for_status()
                token_data = resp.json()
            self._token = token_data["access_token"]
            self._expires_at = time.monotonic() + token_data.get("expires_in", 3600) - 30
            logger.info(
                "Gateway access token refreshed (expires in %ss)",
                token_data.get("expires_in", 3600),
            )
            emit_token_event(
                service="transactions-agent", event="gateway_token_fresh",
                origin="wso2-gateway", destination="transactions-agent",
                access_token=self._token, grant_type="client_credentials", kind="GATEWAY",
                client_id=self._client_id, resource="llm_gateway",
                requested_by=self._client_id,
                # self._expires_at is a monotonic-clock deadline, not a real epoch — derive
                # a proper wall-clock exp for the audit record instead of logging that.
                exp=int(time.time() + token_data.get("expires_in", 3600) - 30),
            )
            return self._token


MESSAGE_KIND_HEADER = "x-boa-message"


def message_kind(body: bytes | str | None) -> str:
    """What the last message of an LLM request is, for the gateway's guardrails:

      user-text       plain text — what the user typed (Anthropic/OpenAI string content)
      tool-result     a tool's output handed back to the model (Anthropic tool_result
                      blocks, an OpenAI "tool" message, a Bedrock toolResult)
      content-blocks  anything else in block form, e.g. strands sending typed text as
                      [{"type": "text", ...}]

    Guardrails that read the last message's text (semantic-prompt-guard, content safety)
    can only read a string — on anything else they reject the whole request. The gateway
    runs them only on user-text, via an executionCondition on this header (see
    gateway-setup/resources.json), so tool follow-ups in an agent loop get through.
    """
    try:
        data = json.loads(body or b"")
        last = data["messages"][-1]
    except (ValueError, KeyError, IndexError, TypeError):
        return "content-blocks"
    content = last.get("content") if isinstance(last, dict) else None
    if isinstance(last, dict) and last.get("role") == "tool":
        return "tool-result"
    if isinstance(content, str):
        return "user-text"
    blocks = content if isinstance(content, list) else []
    if any(isinstance(b, dict) and (b.get("type") == "tool_result" or "toolResult" in b) for b in blocks):
        return "tool-result"
    return "content-blocks"


class GatewayBearerAuth(httpx.Auth):
    """httpx auth handler that injects a fresh gateway token on every LLM request."""

    requires_request_body = True  # message_kind() reads the body

    def __init__(self, token_manager: GatewayTokenManager):
        self._manager = token_manager

    async def auth_headers(self) -> dict[str, str]:
        """The headers to present to the gateway, refreshing the token if needed."""
        return {"Authorization": f"Bearer {await self._manager.get_token()}"}

    def cached_auth_headers(self) -> dict[str, str]:
        """Same as auth_headers() without a refresh — for callers off the event loop."""
        token = self._manager.cached_token
        return {"Authorization": f"Bearer {token}"} if token else {}

    async def async_auth_flow(self, request):
        token = await self._manager.get_token()
        request.headers["Authorization"] = f"Bearer {token}"
        request.headers[MESSAGE_KIND_HEADER] = message_kind(request.content)
        # The actual LLM call this token authenticates — without this, the trail shows
        # tokens being minted/cached but never makes the real request they were for
        # visible (every chat turn and every sub-agent's own LLM call goes through here).
        emit_token_event(
            service="transactions-agent", event="llm_call",
            origin="transactions-agent", destination="wso2-gateway",
            access_token=token, resource="llm_gateway", requested_by="transactions-agent",
        )
        yield request


class GatewayApiKeyAuth(httpx.Auth):
    """httpx auth handler that injects a static gateway API key on every LLM request.

    The alternative to GatewayBearerAuth for gateways that issue API keys per LLM proxy
    (the WSO2 AI Gateway's default, see gateway-setup/). Copied from
    savings-goals-agent/gateway.py. The key itself is never logged — audit_log
    fingerprints it the same way it does a token.
    """

    requires_request_body = True  # message_kind() reads the body

    def __init__(self, api_key: str, header_name: str = "X-API-Key"):
        self._api_key = api_key
        self._header_name = header_name

    async def auth_headers(self) -> dict[str, str]:
        return {self._header_name: self._api_key}

    def cached_auth_headers(self) -> dict[str, str]:
        return {self._header_name: self._api_key}

    async def async_auth_flow(self, request):
        request.headers[self._header_name] = self._api_key
        request.headers[MESSAGE_KIND_HEADER] = message_kind(request.content)
        emit_token_event(
            service="transactions-agent", event="llm_call",
            origin="transactions-agent", destination="wso2-gateway",
            access_token=self._api_key, kind="API_KEY",
            resource="llm_gateway", requested_by="transactions-agent",
        )
        yield request


GatewayAuth = GatewayBearerAuth | GatewayApiKeyAuth


def build_gateway_auths(ssl_verify: bool = True) -> tuple[GatewayAuth, GatewayAuth]:
    """(v1 auth, v2 auth) for the two gateway endpoints, per GATEWAY_AUTH_MODE.

    oauth (default): one client-credentials token manager shared by both endpoints.
    apikey: GATEWAY_API_KEY for v1 and GATEWAY_API_KEY_SECURED for v2 — the WSO2 AI
    Gateway issues keys per LLM proxy, so the two endpoints usually need different keys.
    GATEWAY_API_KEY_SECURED falls back to GATEWAY_API_KEY for gateways with one key for
    both. A missing key or unknown mode fails at startup, not on the first LLM call.
    """
    mode = os.environ.get("GATEWAY_AUTH_MODE", "oauth").strip().lower()
    if mode == "apikey":
        api_key = os.environ.get("GATEWAY_API_KEY")
        if not api_key:
            raise ValueError(
                "GATEWAY_AUTH_MODE=apikey but GATEWAY_API_KEY is not set — "
                "set the key, or use GATEWAY_AUTH_MODE=oauth."
            )
        api_key_secured = os.environ.get("GATEWAY_API_KEY_SECURED") or api_key
        header_name = os.environ.get("GATEWAY_API_KEY_HEADER", "X-API-Key")
        logger.info("Gateway auth: API key (header %r)", header_name)
        return (GatewayApiKeyAuth(api_key, header_name=header_name),
                GatewayApiKeyAuth(api_key_secured, header_name=header_name))
    if mode != "oauth":
        raise ValueError(
            f"GATEWAY_AUTH_MODE={mode!r} is not recognised — use 'oauth' or 'apikey'."
        )
    logger.info("Gateway auth: OAuth2 client credentials")
    auth = GatewayBearerAuth(GatewayTokenManager(
        token_endpoint=os.environ["GATEWAY_TOKEN_ENDPOINT"],
        client_id=os.environ["GATEWAY_CLIENT_ID"],
        client_secret=os.environ["GATEWAY_CLIENT_SECRET"],
        ssl_verify=ssl_verify,
    ))
    return auth, auth


_GUARDRAIL_DEFAULT_MESSAGE = "Your request was blocked by an AI guardrail policy."


def guardrail_reason(status: int, body: Any) -> str | None:
    """The user-facing reason when a gateway response is an AI guardrail block, else None.

    APIM 4.x guardrails answer 446. The WSO2 AI Gateway's guardrail policies have no fixed
    status; they answer a 4xx whose body is {"message": {"action": "GUARDRAIL_INTERVENED",
    "actionReason": ...}} — so the body is the signal there, whatever the status.
    `body` is the parsed JSON when the caller has it, else the raw text.
    """
    data = body
    if isinstance(body, (str, bytes)):
        try:
            data = json.loads(body)
        except ValueError:
            data = None
    message = None
    if isinstance(data, dict):
        message = data.get("message") or data.get("description") or data.get("detail")
    intervened = isinstance(message, dict) and message.get("action") == "GUARDRAIL_INTERVENED"
    if status != 446 and not (400 <= status < 500 and intervened):
        return None
    if isinstance(message, dict):
        message = message.get("actionReason") or message.get("action")
    if isinstance(message, str) and message:
        return message
    return (body if isinstance(body, str) and body else None) or _GUARDRAIL_DEFAULT_MESSAGE
