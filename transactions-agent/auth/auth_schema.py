import logging

from .models import AuthConfig, OAuthTokenType
from .auth_manager import AutogenAuthManager


logger = logging.getLogger(__name__)

class AuthSchema:
    """Schema for validating authentication manager configuration.

    This class ensures that the authentication manager is properly configured
    for the requested token type and validates required components.
    """

    def __init__(self, manager: AutogenAuthManager, config: AuthConfig):
        """Initialize the authentication schema validator.

        Args:
            manager: Authentication manager instance to validate
            config: Authentication configuration to validate against

        Raises:
            ValueError: If manager configuration is invalid for the token type
        """
        self.manager = manager
        self.config = config
        self._validate_manager()

    def _validate_manager(self) -> None:
        """Validate the manager configuration based on the token type.

        Raises:
            ValueError: If required components are missing for the token type
        """
        if self.config.token_type == OAuthTokenType.OBO_TOKEN:
            if not self.manager.get_message_handler():
                raise ValueError(
                    "Message handler is required for OBO token authentication. "
                    "Please provide a message_handler when initializing AutogenAuthManager."
                )
