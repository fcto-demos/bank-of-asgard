import logging
import os
from typing import Optional, Callable, Awaitable

import httpx
from dotenv import load_dotenv

from asgardeo.models import OAuthToken
from app.mcp_agencies import call_agencies_mcp

load_dotenv()

logger = logging.getLogger(__name__)

TRANSACTIONS_API_BASE_URL = os.environ.get("TRANSACTIONS_API_BASE_URL", "http://localhost:8010")
_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"

# MCP endpoint — gateway URL when enabled, direct URL otherwise.
# Resolved at call time so the env var can be set after module import.
_use_mcp_gateway = os.environ.get("MCP_GATEWAY_ENABLED", "").lower() == "true"
MCP_GATEWAY_URL = os.environ.get("MCP_GATEWAY_URL", "")
AGENCIES_MCP_URL = os.environ.get("AGENCIES_MCP_URL", "http://agencies-mcp-server:8012/sse")

# Token provider injected by each service.py at startup.
_agencies_token_provider: Callable[[], Awaitable[str]] | None = None


def set_agencies_token_provider(provider: Callable[[], Awaitable[str]]) -> None:
    """Register an async callable that returns a fresh bearer token for MCP calls."""
    global _agencies_token_provider
    _agencies_token_provider = provider


async def get_my_transactions(
    token: OAuthToken,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    type: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Fetch the authenticated user's bank transactions from the Transactions API.

    The OBO token carries the user's identity — the backend returns only that
    user's transactions. The `token` parameter is injected by SecureFunctionTool
    and is never exposed to the LLM.

    Args:
        token: OBO OAuth token (injected transparently — not visible to LLM)
        start_date: Filter transactions from this date (YYYY-MM-DD), inclusive
        end_date: Filter transactions up to this date (YYYY-MM-DD), inclusive
        type: Filter by transaction type: "debit", "credit", or "transfer"
        limit: Maximum number of transactions to return (default 20, max 50)

    Returns:
        Dictionary with 'transactions' list, 'total' count, and 'user_sub'
    """
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token.access_token}",
    }

    params: dict = {"limit": limit}
    if start_date:
        params["start_date"] = start_date
    if end_date:
        params["end_date"] = end_date
    if type:
        params["type"] = type

    url = f"{TRANSACTIONS_API_BASE_URL}/transactions"

    async with httpx.AsyncClient(verify=_ssl_verify) as client:
        response = await client.get(url, headers=headers, params=params, timeout=15.0)
        response.raise_for_status()
        return response.json()


async def get_agencies(town: str) -> str:
    """Find Bank of Asgard branches and agencies near a given town.

    Calls the agencies MCP server via the WSO2 AI Gateway when gateway is enabled,
    or directly otherwise.

    Args:
        town: The name of the town or city to search near (e.g. "Paris", "London").

    Returns:
        JSON string — a list of agency objects with name, address, phone,
        opening_hours, and services fields.
    """
    if _agencies_token_provider is None:
        logger.warning("get_agencies called but no token provider is set — skipping MCP call")
        return "[]"

    token = await _agencies_token_provider()
    endpoint_url = MCP_GATEWAY_URL if (_use_mcp_gateway and MCP_GATEWAY_URL) else AGENCIES_MCP_URL
    return await call_agencies_mcp(town, endpoint_url, token)
