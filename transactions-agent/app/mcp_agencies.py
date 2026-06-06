import asyncio
import logging
import os

import httpx
from mcp.client.sse import sse_client
from mcp import ClientSession

logger = logging.getLogger(__name__)

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"
MCP_TIMEOUT = float(os.environ.get("MCP_TIMEOUT", "15"))


async def call_agencies_mcp(town: str, endpoint_url: str, bearer_token: str) -> str:
    """Open a one-shot MCP SSE session, call get_agencies, and return the JSON result.

    A new session is opened per call so the bearer token is always fresh at
    connection time — no mid-session token refresh needed.

    Args:
        town: Town or city name to search near.
        endpoint_url: The MCP SSE endpoint URL (gateway or direct).
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

    def _httpx_factory(**kw) -> httpx.AsyncClient:
        return httpx.AsyncClient(**{**kw, "verify": _ssl_verify})

    try:
        async with sse_client(
            endpoint_url,
            headers=headers,
            timeout=MCP_TIMEOUT,
            sse_read_timeout=MCP_TIMEOUT,
            httpx_client_factory=_httpx_factory,
        ) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=MCP_TIMEOUT)
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
