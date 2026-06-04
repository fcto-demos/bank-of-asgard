import logging
import os

from mcp.client.sse import sse_client
from mcp import ClientSession

logger = logging.getLogger(__name__)

_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"


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
    logger.debug("Calling agencies MCP tool get_agencies(town=%r) at %s", town, endpoint_url)

    async with sse_client(endpoint_url, headers=headers) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool("get_agencies", {"town": town})

    content = result.content
    if content and hasattr(content[0], "text"):
        return content[0].text
    return "[]"
