"""Calling a remote agent over A2A 1.0 (a2a-sdk 1.x), JSON-RPC binding.

The agent is addressed by its base URL: the Agent Card is fetched from
<base>/.well-known/agent-card.json once and cached, and messages go to the JSON-RPC
endpoint the card advertises. Behind the WSO2 AI Gateway's agent proxy, the base URL is
the proxy's and the card it serves already points back at the gateway, so every message
passes through the proxy's policies.

The a2a-sdk client sends `A2A-Version: 1.0` on every request; the gateway rejects
operation requests without it.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from a2a.client import A2ACardResolver, ClientCallContext, ClientConfig, ClientFactory
from a2a.client.errors import A2AClientError, A2AClientTimeoutError, AgentCardResolutionError
from a2a.helpers import get_data_parts, get_text_parts, new_data_part, new_message
from a2a.types import AgentCard, Role, SendMessageRequest, StreamResponse
from a2a.utils.constants import TransportProtocol

logger = logging.getLogger(__name__)


class A2AUnreachableError(Exception):
    """The agent could not be reached at all (timeout, connection refused, DNS) — as
    opposed to answering with an error, which is raised as the SDK's own exception."""


def http_status(exc: BaseException) -> int | None:
    """The HTTP status behind an exception, if any: the a2a-sdk wraps httpx's
    HTTPStatusError (as __cause__), and card fetches carry it as status_code."""
    seen: BaseException | None = exc
    while seen is not None:
        if isinstance(seen, httpx.HTTPStatusError):
            return seen.response.status_code
        if isinstance(seen, AgentCardResolutionError) and seen.status_code:
            return seen.status_code
        seen = seen.__cause__
    return None


def _unreachable(exc: A2AClientError) -> bool:
    return isinstance(exc, A2AClientTimeoutError) or isinstance(exc.__cause__, httpx.TransportError)


def _reply_data(event: StreamResponse) -> dict[str, Any]:
    """The reply as a dict: the first data part that is an object — on the reply Message,
    or on a Task's artifacts / final status message — else the text parts as `message`."""
    if event.HasField("message"):
        parts = list(event.message.parts)
    elif event.HasField("task"):
        parts = [p for artifact in event.task.artifacts for p in artifact.parts]
        parts += list(event.task.status.message.parts)
    else:
        parts = []
    for data in get_data_parts(parts):
        if isinstance(data, dict):
            return data
    return {"message": "\n".join(get_text_parts(parts))}


class A2AAgentClient:
    """One remote agent. Safe to share across sessions: the only state is the cached card."""

    def __init__(self, base_url: str, *, name: str, timeout: httpx.Timeout, verify: bool = True):
        self.base_url = base_url.rstrip("/")
        self.name = name
        self._timeout = timeout
        self._verify = verify
        self._card: AgentCard | None = None
        self._card_lock = asyncio.Lock()

    async def _agent_card(self, http: httpx.AsyncClient) -> AgentCard:
        async with self._card_lock:
            if self._card is None:
                card = await A2ACardResolver(http, self.base_url).get_agent_card()
                endpoints = ", ".join(f"{i.protocol_binding} {i.url}" for i in card.supported_interfaces)
                logger.info("%s agent card from %s: %s %s — %s",
                            self.name, self.base_url, card.name, card.version, endpoints)
                self._card = card
            return self._card

    async def send_data(
        self, data: dict[str, Any], *, headers: dict[str, str], context_id: str | None = None,
    ) -> dict[str, Any]:
        """SendMessage with one data part; returns the reply's data part.

        `headers` go on the message request only (credentials, traceparent, ...), not on the
        public card fetch. Raises A2AUnreachableError when the agent can't be reached —
        the cached card is dropped then, in case the agent moved — and the SDK's
        A2AClientError / A2AError subclasses for HTTP and JSON-RPC errors."""
        async with httpx.AsyncClient(verify=self._verify, timeout=self._timeout) as http:
            try:
                card = await self._agent_card(http)
                client = ClientFactory(ClientConfig(
                    streaming=False, httpx_client=http,
                    supported_protocol_bindings=[TransportProtocol.JSONRPC.value],
                )).create(card)
                request = SendMessageRequest(message=new_message(
                    [new_data_part(data, media_type="application/json")],
                    context_id=context_id, role=Role.ROLE_USER,
                ))
                async for event in client.send_message(
                    request, context=ClientCallContext(service_parameters=dict(headers)),
                ):
                    return _reply_data(event)
            except A2AClientError as e:
                if _unreachable(e):
                    self._card = None
                    raise A2AUnreachableError(f"{self.name} unreachable at {self.base_url}: {e}") from e
                raise
        raise A2AClientError(f"{self.name} sent no reply")
