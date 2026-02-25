import logging
from typing import Optional, Tuple

from cachetools import TTLCache

from .models import AuthConfig

from asgardeo.models import OAuthToken

logger = logging.getLogger(__name__)

# Configuration constants
DEFAULT_TOKEN_STORE_MAX_SIZE = 1000
DEFAULT_TOKEN_STORE_TTL = 3600  # 1 hour in seconds

class TokenManager:
    """Manages OAuth tokens with caching and automatic expiration handling.

    This class provides token storage with Time-To-Live (TTL) functionality
    and automatic cleanup of expired tokens.
    """

    def __init__(self, maxsize: int = DEFAULT_TOKEN_STORE_MAX_SIZE, ttl: int = DEFAULT_TOKEN_STORE_TTL):
        """Initialize the token manager.

        Args:
            maxsize: Maximum number of tokens to store in cache
            ttl: Time-to-live for cached tokens in seconds
        """
        self.token_store = TTLCache(maxsize=maxsize, ttl=ttl)

    def add_token(self, config: AuthConfig, token: OAuthToken) -> None:
        """Add a token to the cache.

        Args:
            config: Authentication configuration used as cache key
            token: OAuth token to cache
        """
        key = self._create_cache_key(config)
        self.token_store[key] = token

    def get_token(self, config: AuthConfig) -> Optional[OAuthToken]:
        """Retrieve a token from the cache.

        Args:
            config: Authentication configuration to look up

        Returns:
            OAuth token if found and valid, None otherwise
        """
        key = self._create_cache_key(config)
        token = self.token_store.get(key)

        # Clean up expired tokens
        if token and token.is_expired():
            self.token_store.pop(key, None)
            return None

        return token

    def _create_cache_key(self, config: AuthConfig) -> Tuple:
        """Create a cache key from auth configuration.

        Args:
            config: Authentication configuration

        Returns:
            Tuple representing the cache key
        """
        return (frozenset(config.scopes), config.token_type)
