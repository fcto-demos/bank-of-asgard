import logging
import os
from typing import List, Optional

import httpx
from dotenv import load_dotenv

from asgardeo.models import OAuthToken
from app.audit_log import emit_token_event
from app.mcp_agencies import call_agencies_mcp
from auth import AuthConfig, OAuthTokenType

load_dotenv()

logger = logging.getLogger(__name__)

TRANSACTIONS_API_BASE_URL = os.environ.get("TRANSACTIONS_API_BASE_URL", "http://localhost:8010")
IDP_BASE_URL = os.environ.get("IDP_BASE_URL", "")
SCIM2_BASE_URL = f"{IDP_BASE_URL}/scim2"
_ssl_verify = os.environ.get("SSL_VERIFY", "true").lower() != "false"

_SCIM_WSO2_SCHEMA = "urn:scim:wso2:schema"
_SCIM_CUSTOM_SCHEMA = "urn:scim:schemas:extension:custom:User"
_SCIM_PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp"

# Shared auth config + tool descriptions for GetMyProfile/UpdateMyProfile — defined
# once here and imported by all three service.py files, rather than each framework
# re-typing the same scopes/token_type/resource and description strings.
#
# GetMyProfile only reads the profile, so it requests the claim scopes needed to
# read those attributes. UpdateMyProfile writes via PATCH /scim2/Me, which is
# gated by the self-service `internal_login` scope — the right the user already
# holds over their own record. We deliberately do NOT use `internal_user_mgt_update`
# (the /scim2/Users admin scope): that would let the delegated token modify other
# users, and the agent must never hold more than the user's own self-service right.
# Because the token cache key is scope-based (see auth/token_manager.py), the
# distinct scope set makes the update mint its own OBO token instead of reusing the
# read-only one.
PROFILE_AUTH_CONFIG = AuthConfig(
    scopes=["profile", "phone"],
    token_type=OAuthTokenType.OBO_TOKEN,
    resource="scim2_me",
)

UPDATE_PROFILE_AUTH_CONFIG = AuthConfig(
    scopes=["profile", "phone", "internal_login"],
    token_type=OAuthTokenType.OBO_TOKEN,
    resource="scim2_me",
)

# The transactions tool requests this scope; the profile tools do not. We key off
# it to tell the two OBO flows apart when picking the post-authorisation status
# message (see auth_completion_message).
READ_TRANSACTIONS_SCOPE = "read_transactions"


def auth_completion_message(scopes: List[str]) -> str:
    """Pick the "authorisation complete" status message for an OBO callback.

    GetMyTransactions and the profile tools trigger separate consent prompts, so
    after the user returns from the IDP we key off the scopes they authorised to
    show a message that matches the action actually being performed.
    """
    if READ_TRANSACTIONS_SCOPE in scopes:
        return "Authorisation complete! Fetching your transactions now..."
    return "Authorisation complete! Fetching your profile now..."

GET_MY_PROFILE_DESCRIPTION = (
    "Fetch the current user's basic profile information: first name, last name, "
    "email, mobile number, country, date of birth, and account type. Call this "
    "when the user asks to see or confirm any of these details, including their "
    "date of birth."
)

UPDATE_MY_PROFILE_DESCRIPTION = (
    "Update the current user's first name, last name, country, and/or mobile "
    "number. Only these four fields can be changed — email requires a separate "
    "verification flow and date of birth/account type cannot be changed via "
    "this assistant. Only pass the fields the user actually asked to change."
)

# DEMO_VERSION — see app/prompt.py for context. v2 also regresses GetMyTransactions
# to always over-fetch (ignoring the limit the model actually asked for), mirroring
# a real-world regression where a "just in case" change drops a tool's pagination.
_DEMO_VERSION = os.environ.get("DEMO_VERSION", "v1")
_V2_OVERFETCH_LIMIT = 200

# MCP endpoint — gateway URL when enabled, direct URL otherwise.
_use_mcp_gateway = os.environ.get("MCP_GATEWAY_ENABLED", "").lower() == "true"
MCP_GATEWAY_URL = os.environ.get("MCP_GATEWAY_URL", "")
AGENCIES_MCP_URL = os.environ.get("AGENCIES_MCP_URL", "http://agencies-mcp-server:8012/sse")


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

    effective_limit = _V2_OVERFETCH_LIMIT if _DEMO_VERSION == "v2" else limit
    params: dict = {"limit": effective_limit}
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
        # The actual invocation, not just the token that made it possible — without
        # this, the trail shows tokens being minted/cached but never makes the real
        # API call they were for visible.
        emit_token_event(
            service="transactions-agent", event="api_call",
            origin="transactions-agent", destination="transactions_api",
            access_token=token.access_token, resource="transactions_api",
            requested_by="transactions-agent",
        )
        return response.json()


async def get_my_profile(token: OAuthToken) -> dict:
    """Fetch the authenticated user's SCIM2 profile from the Identity Server.

    The OBO token carries the user's identity — the IS returns only that
    user's own profile via `/scim2/Me`. The `token` parameter is injected by
    the secure tool wrapper and is never exposed to the LLM.

    Deliberately returns the full profile, including `dateOfBirth`, unredacted:
    this tool result is the payload the WSO2 AI Gateway's guardrail is meant to
    redact on the secured endpoint — no filtering happens here in Python.

    Args:
        token: OBO OAuth token (injected transparently — not visible to LLM)

    Returns:
        Flat dict with givenName, familyName, email, mobile, country,
        dateOfBirth, accountType, businessName
    """
    headers = {
        "Accept": "application/scim+json",
        "Authorization": f"Bearer {token.access_token}",
    }

    url = f"{SCIM2_BASE_URL}/Me"

    async with httpx.AsyncClient(verify=_ssl_verify) as client:
        response = await client.get(url, headers=headers, timeout=15.0)
        response.raise_for_status()
        emit_token_event(
            service="transactions-agent", event="api_call",
            origin="transactions-agent", destination="scim2_me",
            access_token=token.access_token, resource="scim2_me",
            requested_by="transactions-agent",
        )
        scim_user = response.json()

    name = scim_user.get("name", {})
    emails = scim_user.get("emails", [])
    phone_numbers = scim_user.get("phoneNumbers", [])
    wso2_schema = scim_user.get(_SCIM_WSO2_SCHEMA, {})
    custom_schema = scim_user.get(_SCIM_CUSTOM_SCHEMA, {})

    return {
        "givenName": name.get("givenName"),
        "familyName": name.get("familyName"),
        "email": emails[0] if emails else None,
        "mobile": phone_numbers[0].get("value") if phone_numbers else None,
        "country": wso2_schema.get("country"),
        "dateOfBirth": wso2_schema.get("dateOfBirth"),
        "accountType": custom_schema.get("accountType"),
        "businessName": custom_schema.get("businessName"),
    }


async def update_my_profile(
    token: OAuthToken,
    given_name: Optional[str] = None,
    family_name: Optional[str] = None,
    country: Optional[str] = None,
    mobile: Optional[str] = None,
) -> dict:
    """Update a safe subset of the authenticated user's SCIM2 profile.

    Only first name, last name, country, and mobile number can be changed here.
    There are no parameters for dateOfBirth, email, accountType, or businessName —
    the LLM-visible tool schema (built from this function's signature) makes them
    impossible to pass, regardless of what the user asks for.

    Args:
        token: OBO OAuth token (injected transparently — not visible to LLM)
        given_name: New first name, if changing
        family_name: New last name, if changing
        country: New country, if changing
        mobile: New mobile number, if changing

    Returns:
        Dict describing which fields were updated
    """
    value_payload: dict = {}
    updated_fields = []

    if given_name is not None or family_name is not None:
        name: dict = {}
        if given_name is not None:
            name["givenName"] = given_name
            updated_fields.append("givenName")
        if family_name is not None:
            name["familyName"] = family_name
            updated_fields.append("familyName")
        value_payload["name"] = name

    if mobile is not None:
        value_payload["phoneNumbers"] = [{"type": "mobile", "value": mobile}]
        updated_fields.append("mobile")

    if country is not None:
        value_payload[_SCIM_WSO2_SCHEMA] = {"country": country}
        updated_fields.append("country")

    if not value_payload:
        return {"updated": False, "message": "No fields provided to update."}

    payload = {
        "schemas": [_SCIM_PATCH_SCHEMA],
        "Operations": [{"op": "replace", "value": value_payload}],
    }
    headers = {
        "Accept": "application/scim+json",
        "Content-Type": "application/scim+json",
        "Authorization": f"Bearer {token.access_token}",
    }

    url = f"{SCIM2_BASE_URL}/Me"

    async with httpx.AsyncClient(verify=_ssl_verify) as client:
        response = await client.patch(url, headers=headers, json=payload, timeout=15.0)
        response.raise_for_status()
        emit_token_event(
            service="transactions-agent", event="api_call",
            origin="transactions-agent", destination="scim2_me",
            access_token=token.access_token, resource="scim2_me",
            requested_by="transactions-agent",
        )

    return {"updated": True, "updated_fields": updated_fields}


async def get_agencies(town: str, token: OAuthToken) -> str:
    """Find Bank of Asgard branches and agencies near a given town.

    Calls the agencies MCP server via the WSO2 AI Gateway when gateway is enabled,
    or directly otherwise. The agent token is injected transparently by the secure
    tool wrapper and is never exposed to the LLM.

    Args:
        town: The name of the town or city to search near (e.g. "Paris", "London").
        token: Agent OAuth token (injected transparently — not visible to LLM).

    Returns:
        JSON string — a list of agency objects with name, address, phone,
        opening_hours, and services fields.
    """
    if _use_mcp_gateway and not MCP_GATEWAY_URL:
        logger.warning("MCP_GATEWAY_ENABLED=true but MCP_GATEWAY_URL is not set — falling back to direct endpoint")
    endpoint_url = MCP_GATEWAY_URL if (_use_mcp_gateway and MCP_GATEWAY_URL) else AGENCIES_MCP_URL
    logger.info("get_agencies routing to %s (gateway=%s)", endpoint_url, _use_mcp_gateway)
    return await call_agencies_mcp(town, endpoint_url, token.access_token)
