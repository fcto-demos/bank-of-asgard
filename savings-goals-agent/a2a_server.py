"""A2A 1.0 server for the Savings Goals agent (a2a-sdk 1.x).

Mounted on server.py's FastAPI app, next to the REST `/suggest-goal` route, so both share
the same auth middleware, trace propagation and port. What it serves:

    GET  /.well-known/agent-card.json   the Agent Card — public, as A2A discovery requires
    POST /                              JSON-RPC binding (SendMessage, ...)
    POST /v1/message:send               HTTP+JSON binding (and the rest of /v1/...)

A caller sends one Message with a single data part carrying the same JSON fields as the
REST body (subscription_summary, spending_summary, monthly_recoverable, optional user_sub
and transaction_id), and gets one Message back: a data part with the same JSON the REST
route returns, plus a text part with the recommendation. No tasks — the agent answers in
one shot, so it never enqueues a Task and the card advertises no streaming.

The card text mirrors description.md, the copy's source of truth: change both together.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from a2a.helpers import get_data_parts, get_text_parts, new_data_part, new_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    add_a2a_routes_to_fastapi, create_agent_card_routes, create_jsonrpc_routes, create_rest_routes,
)
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import (
    AgentCapabilities, AgentCard, AgentInterface, AgentProvider, AgentSkill, APIKeySecurityScheme,
    HTTPAuthSecurityScheme, Message, Role, SecurityRequirement, SecurityScheme, StringList,
)
from a2a.utils.constants import AGENT_CARD_WELL_KNOWN_PATH, PROTOCOL_VERSION_1_0, TransportProtocol
from a2a.utils.errors import InvalidParamsError
from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Paths the bindings are served on, relative to the agent's base URL. The WSO2 AI Gateway's
# agent proxy uses the same prefixes (gateway-setup/provision.py, A2A_TRANSPORTS), so a
# gateway path maps onto the same path here once the proxy's context is stripped.
JSONRPC_PATH = "/"
REST_PATH_PREFIX = "/v1"
AGENT_CARD_PATH = AGENT_CARD_WELL_KNOWN_PATH

SuggestGoal = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

_DESCRIPTION = (
    "Turns money a customer could stop spending into a concrete, named savings goal. Given a "
    "summary of recurring subscriptions, a summary of spending health, and the total monthly "
    "amount recoverable, it names a goal, projects what that amount becomes after 1, 5 and 10 "
    "years of monthly saving, and writes a short encouraging recommendation the customer can "
    "act on. The projections are computed arithmetically (3% APY, compounded monthly), never by "
    "the language model. The agent is stateless and sees only the summaries the caller passes in."
)

_SKILL = AgentSkill(
    id="suggest-savings-goal",
    name="Suggest a savings goal",
    description=(
        "Proposes a named savings goal from an amount the customer could redirect into savings "
        "each month, with projected balances at 1, 5 and 10 years and a short motivating "
        "recommendation. Send one data part with subscription_summary (string), "
        "spending_summary (string) and monthly_recoverable (number), optionally user_sub and "
        "transaction_id; the reply's data part carries status, goal_name, "
        "suggested_monthly_amount, projected_balances (1y, 5y, 10y) and message."
    ),
    tags=["personal-finance", "savings", "goal-setting", "projections", "financial-wellbeing"],
    examples=[
        "Three forgotten subscriptions come to 47.97 a month and spending is up 8% on dining — "
        "what savings goal should we suggest?",
        "The customer can free up 120 a month. Name a goal and show what it's worth over ten years.",
        "Give me a goal, the 1/5/10-year projections, and a message I can show the customer.",
    ],
    input_modes=["application/json"],
    output_modes=["application/json", "text/plain"],
)


def build_agent_card(
    *, public_url: str, version: str, token_url: str, api_key_header: str | None,
) -> AgentCard:
    """The Agent Card. `public_url` is the base URL callers reach this agent on directly;
    a gateway proxy in passthrough mode rewrites these URLs to its own when it serves the card.

    Security mirrors BearerAuthMiddleware: a bearer JWT from the IDP whose audience is this
    agent's client ID, or, when INBOUND_API_KEY is set, a static key. Either one is enough,
    hence two separate requirement entries. HTTP bearer rather than an oauth2 scheme: no
    scopes are checked (the audience is the access decision), and an oauth2 flow with an
    empty scope map is flagged as non-compliant by the SDK."""
    base = public_url.rstrip("/")
    schemes = {
        "agentToken": SecurityScheme(http_auth_security_scheme=HTTPAuthSecurityScheme(
            scheme="Bearer", bearer_format="JWT",
            description=(f"Agent token issued by {token_url} whose audience is this agent's "
                         "client ID (EXPECTED_AUDIENCE). No scopes are required."),
        )),
    }
    requirements = [SecurityRequirement(schemes={"agentToken": StringList()})]
    if api_key_header:
        schemes["apiKey"] = SecurityScheme(api_key_security_scheme=APIKeySecurityScheme(
            description="Static key for callers that cannot be issued OAuth client credentials.",
            location="header", name=api_key_header,
        ))
        requirements.append(SecurityRequirement(schemes={"apiKey": StringList()}))
    return AgentCard(
        name="Savings Goals Agent",
        description=_DESCRIPTION,
        version=version,
        provider=AgentProvider(organization="Bank of Asgard", url=base),
        supported_interfaces=[
            AgentInterface(protocol_binding=TransportProtocol.JSONRPC.value,
                           url=f"{base}{JSONRPC_PATH.rstrip('/')}", protocol_version=PROTOCOL_VERSION_1_0),
            AgentInterface(protocol_binding=TransportProtocol.HTTP_JSON.value,
                           url=f"{base}{REST_PATH_PREFIX}", protocol_version=PROTOCOL_VERSION_1_0),
        ],
        capabilities=AgentCapabilities(streaming=False, push_notifications=False),
        security_schemes=schemes,
        security_requirements=requirements,
        default_input_modes=["application/json"],
        default_output_modes=["application/json", "text/plain"],
        skills=[_SKILL],
    )


def request_data(message: Message | None) -> dict[str, Any]:
    """The JSON object a caller sent: the first data part that is an object, or else a text
    part holding a JSON object (handy for hand-written curl calls). Raises InvalidParamsError
    — a JSON-RPC -32602 to the caller — when there is neither."""
    if message is None:
        raise InvalidParamsError("SendMessage carried no message")
    for data in get_data_parts(message.parts):
        if isinstance(data, dict):
            return data
    for text in get_text_parts(message.parts):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise InvalidParamsError(
        "Expected a data part with subscription_summary, spending_summary and monthly_recoverable"
    )


class SavingsGoalExecutor(AgentExecutor):
    """Answers each SendMessage with a single Message: the same dict the REST route returns,
    as a data part, plus the recommendation as text."""

    def __init__(self, suggest_goal: SuggestGoal):
        self._suggest_goal = suggest_goal

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        data = request_data(context.message)
        # The Coordinator sends X-Transaction-Id as a header too (the auth middleware tags
        # its audit events from it); fall back to it when the body has none.
        if not data.get("transaction_id"):
            header = context.call_context.state.get("headers", {}).get("x-transaction-id")
            if header:
                data = {**data, "transaction_id": header}
        try:
            result = await self._suggest_goal(data)
        except ValueError as e:  # pydantic's ValidationError is a ValueError
            raise InvalidParamsError(f"Invalid savings-goal request: {e}") from e
        parts = [new_data_part(result, media_type="application/json")]
        if isinstance(result.get("message"), str) and result["message"]:
            parts.append(new_text_part(result["message"], media_type="text/plain"))
        await event_queue.enqueue_event(
            new_message(parts, context_id=context.context_id, role=Role.ROLE_AGENT)
        )

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        # Nothing to cancel: there are no long-running tasks, each request answers at once.
        raise InvalidParamsError("This agent runs no tasks, so there is nothing to cancel")


def mount_a2a(app: FastAPI, suggest_goal: SuggestGoal, card: AgentCard) -> None:
    """Adds the card, JSON-RPC and HTTP+JSON routes to `app`. Tasks are never created, so the
    in-memory task store stays empty; it is only there because the handler requires one."""
    handler = DefaultRequestHandler(
        agent_executor=SavingsGoalExecutor(suggest_goal),
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card, card_url=AGENT_CARD_PATH),
        jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url=JSONRPC_PATH),
        rest_routes=create_rest_routes(handler, path_prefix=REST_PATH_PREFIX),
    )
    endpoints = ", ".join(f"{i.protocol_binding} {i.url}" for i in card.supported_interfaces)
    logger.info("A2A %s endpoints: %s (card %s)", PROTOCOL_VERSION_1_0, endpoints, AGENT_CARD_PATH)
