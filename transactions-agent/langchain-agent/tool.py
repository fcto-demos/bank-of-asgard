import inspect
import logging
from enum import Enum
from typing import Any, Callable, Optional, get_type_hints

from langchain_core.tools import BaseTool
from opentelemetry import trace
from pydantic import PrivateAttr, create_model

from auth.auth_schema import AuthSchema
from asgardeo.models import OAuthToken

logger = logging.getLogger(__name__)

TOKEN_FIELD = "token"  # noqa: S105


class ToolKind(str, Enum):
    """What a tool calls. Shown as a prefix on the tool's trace span name only — the name
    the LLM sees (and gen_ai.tool.name) stays unprefixed."""

    API = "API"
    MCP = "MCP"
    AGENT = "Agent"
    SUBAGENT = "SubAgent"


class SecureLangChainTool(BaseTool):
    """LangChain tool wrapper that injects OAuth tokens transparently.

    Strips the token parameter from the schema exposed to the LLM, then injects
    the OAuth token at execution time via the auth manager. The LLM never sees
    or can manipulate authentication credentials.
    """

    _func: Callable[..., Any] = PrivateAttr()
    _auth: Optional[AuthSchema] = PrivateAttr(default=None)
    _kind: ToolKind = PrivateAttr()

    def __init__(
        self,
        func: Callable[..., Any],
        description: str,
        name: Optional[str] = None,
        auth: Optional[AuthSchema] = None,
        *,
        kind: ToolKind,
    ):
        sig = inspect.signature(func)
        hints = get_type_hints(func)

        # Validate that the function has a token: OAuthToken parameter
        if TOKEN_FIELD not in sig.parameters:
            available = ", ".join(f"{p}: {hints.get(p)}" for p in sig.parameters)
            raise Exception(
                f"Expected a parameter named '{TOKEN_FIELD}' with type 'OAuthToken' in tool arguments, "
                f"but got: {available or 'no parameters'}.\n"
                f"Ensure your function signature includes '{TOKEN_FIELD}: OAuthToken'."
            )
        if hints.get(TOKEN_FIELD) is not OAuthToken:
            raise Exception(
                f"Parameter '{TOKEN_FIELD}' must have type OAuthToken, "
                f"got {hints.get(TOKEN_FIELD)}."
            )

        # Build args_schema excluding the token field — this is the schema the LLM sees
        fields: dict = {}
        for param_name, param in sig.parameters.items():
            if param_name == TOKEN_FIELD:
                continue
            annotation = hints.get(param_name, Any)
            if param.default is inspect.Parameter.empty:
                fields[param_name] = (annotation, ...)
            else:
                fields[param_name] = (annotation, param.default)

        args_schema = create_model(f"{name or func.__name__}Args", **fields)

        super().__init__(
            name=name or func.__name__,
            description=description,
            args_schema=args_schema,
        )
        self._func = func
        self._auth = auth
        self._kind = kind

    def _label_trace_span(self) -> None:
        """Prefix this tool's kind onto its execute_tool span (e.g. "execute_tool [MCP]
        GetAgencies") so traces show what each tool calls at a glance.

        While the tool runs, the current span is the one the LangChain instrumentation
        opened for it; it is only renamed if it still carries that exact name, so no other
        span can ever be relabelled. No-op when tracing is off."""
        span = trace.get_current_span()
        if span.is_recording() and getattr(span, "name", None) == f"execute_tool {self.name}":
            span.update_name(f"execute_tool [{self._kind.value}] {self.name}")

    def _run(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError("This tool only supports async execution via _arun.")

    async def _arun(self, *args: Any, run_manager=None, **kwargs: Any) -> Any:
        self._label_trace_span()
        if not self._auth:
            kwargs[TOKEN_FIELD] = ""
            return await self._func(**kwargs)

        token = await self._auth.manager.get_oauth_token(self._auth.config)
        if not token:
            raise Exception(f"No OAuth token found for {self._auth.config}")

        kwargs[TOKEN_FIELD] = token
        return await self._func(**kwargs)
