import logging
import os
from typing import Optional

import httpx
from dotenv import load_dotenv

from asgardeo.models import OAuthToken

load_dotenv()

logger = logging.getLogger(__name__)

TRANSACTIONS_API_BASE_URL = os.environ.get("TRANSACTIONS_API_BASE_URL", "http://localhost:8010")


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

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers, params=params, timeout=15.0)
        response.raise_for_status()
        return response.json()
