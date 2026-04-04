import asyncio
import inspect
import json
import logging
from typing import Any, Callable, Optional

from pydantic import BaseModel, create_model
from typing_extensions import override

from strands.types.tools import AgentTool, ToolSpec, ToolUse, ToolGenerator, ToolResult

from auth.auth_schema import AuthSchema
from asgardeo.models import OAuthToken

logger = logging.getLogger(__name__)

TOKEN_FIELD = "token"


class SecureStrandsTool(AgentTool):
    """AgentTool that hides the `token: OAuthToken` parameter from the LLM schema
    and injects a live OBO token at call time."""

    def __init__(
        self,
        func: Callable[..., Any],
        description: str,
        name: str,
        auth: Optional[AuthSchema] = None,
    ):
        super().__init__()

        self.auth = auth
        self._func = func
        self._name = name

        # Build the LLM-visible input model with the token parameter stripped
        sig = inspect.signature(func)
        params = dict(sig.parameters)

        token_param = params.pop(TOKEN_FIELD, None)
        if token_param is None or token_param.annotation is not OAuthToken:
            raise ValueError(
                f"Function must have a '{TOKEN_FIELD}: OAuthToken' parameter."
            )

        field_defs: dict[str, Any] = {}
        for pname, p in params.items():
            annotation = p.annotation if p.annotation is not inspect.Parameter.empty else Any
            default = ... if p.default is inspect.Parameter.empty else p.default
            field_defs[pname] = (annotation, default)

        self._input_model: type[BaseModel] = create_model(
            f"{name}Input", **{k: (t, d) for k, (t, d) in field_defs.items()}
        )

        schema = self._input_model.model_json_schema()
        schema.pop("title", None)
        schema.pop("additionalProperties", None)

        self._spec: ToolSpec = ToolSpec(
            name=name,
            description=description,
            inputSchema={"json": schema},
        )

    @property
    def tool_name(self) -> str:
        return self._name

    @property
    def tool_spec(self) -> ToolSpec:
        return self._spec

    @property
    def tool_type(self) -> str:
        return "python"

    @override
    async def stream(
        self,
        tool_use: ToolUse,
        invocation_state: dict[str, Any],
        **kwargs: Any,
    ) -> ToolGenerator:
        tool_use_id = tool_use["toolUseId"]
        tool_input: dict[str, Any] = tool_use.get("input", {})

        try:
            validated = self._input_model(**tool_input).model_dump()

            if self.auth:
                token = await self.auth.manager.get_oauth_token(self.auth.config)
                if not token:
                    raise Exception(f"No OAuth token available for {self.auth.config}")
                validated[TOKEN_FIELD] = token
            else:
                validated[TOKEN_FIELD] = ""

            if inspect.iscoroutinefunction(self._func):
                result = await self._func(**validated)
            else:
                result = await asyncio.to_thread(self._func, **validated)

            if isinstance(result, str):
                text = result
            elif isinstance(result, BaseModel):
                text = result.model_dump_json()
            else:
                try:
                    text = json.dumps(result)
                except (TypeError, ValueError):
                    text = str(result)

            yield ToolResult(
                toolUseId=tool_use_id,
                status="success",
                content=[{"text": text}],
            )

        except Exception as e:
            logger.error("SecureStrandsTool '%s' error: %s", self._name, e)
            yield ToolResult(
                toolUseId=tool_use_id,
                status="error",
                content=[{"text": f"Error: {type(e).__name__} - {e}"}],
            )
