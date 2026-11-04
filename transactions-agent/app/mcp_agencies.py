import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any
from urllib.parse import urlparse

import httpx
import mcp.shared._httpx_utils as _mcp_httpx_utils
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp import ClientSession

from app.tool_integrity import ToolSchemaChecksum

logger = logging.getLogger(__name__)

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"
MCP_TIMEOUT = float(os.environ.get("MCP_TIMEOUT", "15"))

# The httpx module the installed mcp package builds its clients with: httpx up to mcp
# 1.x, the separate httpx2 package from mcp 2.x. streamable_http_client takes a ready
# client, which must come from that same module.
_mcp_httpx: Any = getattr(_mcp_httpx_utils, "httpx2", None) or getattr(_mcp_httpx_utils, "httpx", httpx)


def _uses_streamable_http(endpoint_url: str) -> bool:
    """Streamable HTTP for a URL ending in /mcp — the transport the WSO2 AI Gateway's MCP
    proxy speaks (spec 2025-06-18) and agencies-mcp-server also serves; legacy SSE for
    anything else (agencies-mcp-server's /sse, or an older gateway's SSE proxy)."""
    return urlparse(endpoint_url).path.rstrip("/").endswith("/mcp")


@asynccontextmanager
async def _streamable_http_transport(endpoint_url: str, headers: dict[str, str]) -> AsyncIterator[Any]:
    # A client passed in is the caller's to close — streamable_http_client leaves it open.
    async with _mcp_httpx.AsyncClient(
        headers=headers,
        timeout=_mcp_httpx.Timeout(MCP_TIMEOUT),
        verify=_ssl_verify,
    ) as client:
        async with streamable_http_client(endpoint_url, http_client=client) as streams:
            yield streams


def _open_transport(endpoint_url: str, headers: dict[str, str]) -> AbstractAsyncContextManager[Any]:
    if _uses_streamable_http(endpoint_url):
        return _streamable_http_transport(endpoint_url, headers)

    def _httpx_factory(
        headers: dict[str, str] | None = None,
        timeout: httpx.Timeout | None = None,
        auth: httpx.Auth | None = None,
    ) -> httpx.AsyncClient:
        return httpx.AsyncClient(headers=headers, timeout=timeout, auth=auth, verify=_ssl_verify)

    return sse_client(
        endpoint_url,
        headers=headers,
        timeout=MCP_TIMEOUT,
        sse_read_timeout=MCP_TIMEOUT,
        httpx_client_factory=_httpx_factory,
    )

# Module-level singleton — baseline is captured on the first successful call and
# held for the lifetime of the process.
_checksum = ToolSchemaChecksum("agencies_mcp")


async def call_agencies_mcp(town: str, endpoint_url: str, bearer_token: str) -> str:
    """Open a one-shot MCP session, call get_agencies, and return the JSON result.

    A new session is opened per call so the bearer token is always fresh at
    connection time — no mid-session token refresh needed.

    Args:
        town: Town or city name to search near.
        endpoint_url: The MCP endpoint URL (gateway or direct) — `.../mcp` for
            Streamable HTTP, otherwise SSE (see _uses_streamable_http).
        bearer_token: A valid OAuth bearer token for the endpoint.

    Returns:
        JSON string — a list of agency objects.

    Raises:
        ValueError: If bearer_token is empty.
    """
    if not bearer_token:
        raise ValueError("Bearer token is required for the agencies MCP endpoint")

    headers = {"Authorization": f"Bearer {bearer_token}"}
    logger.info(
        "Calling agencies MCP get_agencies(town=%r) at %s (token prefix=%s...)",
        town, endpoint_url, bearer_token[:12],
    )

    try:
        async with _open_transport(endpoint_url, headers) as streams:
            read, write = streams[0], streams[1]  # Streamable HTTP adds a session-id getter
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=MCP_TIMEOUT)

                # Verify tool definitions haven't changed since the baseline was
                # established — guards against MCP rug-pull / tool-poisoning attacks.
                tools_response = await asyncio.wait_for(
                    session.list_tools(), timeout=MCP_TIMEOUT
                )
                _checksum.verify([t.model_dump() for t in tools_response.tools])

                result = await asyncio.wait_for(
                    session.call_tool("get_agencies", {"town": town}),
                    timeout=MCP_TIMEOUT,
                )
    except BaseException as e:
        if hasattr(e, 'exceptions'):
            for sub in e.exceptions:  # type: ignore[attr-defined]
                logger.error("MCP sub-exception: %s: %s", type(sub).__name__, sub)
        else:
            logger.error("MCP call failed: %s: %s", type(e).__name__, e)
        raise

    content = result.content
    if content and hasattr(content[0], "text"):
        return content[0].text
    return "[]"
