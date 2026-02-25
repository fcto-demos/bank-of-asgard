from enum import Enum
from typing import List, Literal

from pydantic import BaseModel, Field


class OAuthTokenType(str, Enum):
    """OAuth token types supported by the authentication system."""
    OBO_TOKEN = "authorization_code"
    AGENT_TOKEN = "agent_token"


class AuthConfig(BaseModel):
    """Configuration for authentication requests.

    Attributes:
        scopes: List of OAuth scopes required for the token
        token_type: Type of OAuth token to request
        resource: Target resource for the token
    """
    scopes: List[str] = Field(default_factory=list)
    token_type: OAuthTokenType = OAuthTokenType.AGENT_TOKEN
    resource: str

    class Config:
        frozen = True


class AuthRequestMessage(BaseModel):
    """Message sent to request user authorization.

    Attributes:
        type: Message type identifier
        auth_url: Authorization URL for user to visit
        state: OAuth state parameter for security
        scopes: Required OAuth scopes
    """
    type: Literal["auth_request"] = "auth_request"
    auth_url: str
    state: str
    scopes: List[str]
