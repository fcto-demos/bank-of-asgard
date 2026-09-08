import asyncio
import logging
import time

import httpx

from audit_log import emit_token_event

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
                    service="savings-goals-agent", event="cache_hit",
                    origin="savings-goals-agent", destination="wso2-gateway",
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
                service="savings-goals-agent", event="gateway_token_fetch",
                origin="savings-goals-agent", destination="wso2-gateway",
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
                service="savings-goals-agent", event="gateway_token_fresh",
                origin="wso2-gateway", destination="savings-goals-agent",
                access_token=self._token, grant_type="client_credentials", kind="GATEWAY",
                client_id=self._client_id, resource="llm_gateway",
                requested_by=self._client_id,
                exp=int(time.time() + token_data.get("expires_in", 3600) - 30),
            )
            return self._token


class GatewayBearerAuth(httpx.Auth):
    """httpx auth handler that injects a fresh gateway token on every LLM request."""

    def __init__(self, token_manager: GatewayTokenManager):
        self._manager = token_manager

    async def async_auth_flow(self, request):
        token = await self._manager.get_token()
        request.headers["Authorization"] = f"Bearer {token}"
        # The actual LLM call this token authenticates — without this, the trail shows
        # tokens being minted/cached but never makes the real request they were for
        # visible (this is the Savings Agent's own /suggest-goal LLM call).
        emit_token_event(
            service="savings-goals-agent", event="llm_call",
            origin="savings-goals-agent", destination="wso2-gateway",
            access_token=token, resource="llm_gateway", requested_by="savings-goals-agent",
        )
        yield request
