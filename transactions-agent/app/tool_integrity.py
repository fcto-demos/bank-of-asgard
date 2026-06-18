import hashlib
import json
import logging

logger = logging.getLogger(__name__)


class ToolSchemaError(RuntimeError):
    """Raised when a tool's schema changes after the baseline was established."""


class ToolSchemaChecksum:
    """Detects MCP rug-pull attacks by hashing tool definitions and comparing against a baseline.

    The baseline is captured on the first call to verify(). Every subsequent call must
    produce an identical hash — any drift raises ToolSchemaError and blocks the tool call.
    """

    def __init__(self, name: str):
        self.name = name
        self._baseline: str | None = None

    @staticmethod
    def _hash(data: object) -> str:
        serialized = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
        return hashlib.sha256(serialized.encode()).hexdigest()

    def verify(self, schema: object) -> None:
        """Hash schema and compare to baseline.

        Sets the baseline on the first call. Raises ToolSchemaError on any subsequent
        call where the hash differs.
        """
        current = self._hash(schema)
        if self._baseline is None:
            self._baseline = current
            logger.info(
                "[tool-integrity] Baseline established for '%s': %s…",
                self.name,
                current[:16],
            )
            return
        if current != self._baseline:
            logger.critical(
                "[tool-integrity] SECURITY ALERT: schema drift detected for '%s' — "
                "possible rug-pull attack! baseline=%s… current=%s…",
                self.name,
                self._baseline[:16],
                current[:16],
            )
            raise ToolSchemaError(
                f"Tool schema integrity check failed for '{self.name}': "
                f"schema changed from baseline={self._baseline[:16]}… "
                f"to current={current[:16]}…"
            )
        logger.debug(
            "[tool-integrity] Schema OK for '%s' (%s…)", self.name, current[:16]
        )
