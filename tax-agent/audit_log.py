"""Structured token-lifecycle audit trail — own copy for this independently-deployable
service (same "copy, don't share" convention as gateway.py in this repo).

See transactions-agent/app/audit_log.py for the full design rationale. Both services
append to the SAME shared file at the repo root — single JSON-line writes from separate
processes are safe to interleave, giving cross-process correlation for free.
"""

import hashlib
import json
import logging
import time
from contextvars import ContextVar
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_transaction_id: ContextVar[str | None] = ContextVar("transaction_id", default=None)
_session_id: ContextVar[str | None] = ContextVar("session_id", default=None)

_REPO_ROOT = Path(__file__).parent.parent
_AUDIT_LOG_PATH = _REPO_ROOT / ".demo-logs" / "token-audit.jsonl"


def _load_actor_names() -> dict[str, str]:
    path = _REPO_ROOT / "audit_actor_names.yaml"
    if path.exists():
        with open(path) as f:
            return yaml.safe_load(f) or {}
    logger.warning("audit_actor_names.yaml not found — actor labels will show raw values")
    return {}


_ACTOR_NAMES = _load_actor_names()

# Runtime-registered synonyms — e.g. an agent's own agent_id (a deployment-specific
# secret, never written to the checked-in audit_actor_names.yaml) AND its service name
# both need to resolve to the SAME canonical actor, or the same real entity fragments
# into multiple unrelated-looking participants in the trail/diagram. Each service
# registers its own synonyms at startup (see register_actor_name calls in service.py).
#
# Also persisted to a small shared file: this process's own identity is registered
# in-memory here, but a DIFFERENT process (e.g. this service validating an inbound call
# FROM the Coordinator) needs to resolve the CALLER's identity too — which it never
# registered itself, since it's a separate Python interpreter with no shared memory.
# The shared file is the only thing both processes can see.
_RUNTIME_NAMES: dict[str, str] = {}
_RUNTIME_NAMES_PATH = _REPO_ROOT / ".demo-logs" / "actor-names.json"


def _load_runtime_names_from_disk() -> dict[str, str]:
    if _RUNTIME_NAMES_PATH.exists():
        try:
            with open(_RUNTIME_NAMES_PATH) as f:
                return json.load(f) or {}
        except Exception as exc:
            logger.warning("Failed to read %s: %s", _RUNTIME_NAMES_PATH, exc)
    return {}


def register_actor_name(value: str | None, canonical_name: str) -> None:
    """Register a synonym (e.g. an agent_id value, or a service's own name) that should
    always resolve to the same canonical actor name in the audit trail — both in this
    process's memory and in the shared file other processes can read."""
    if not value:
        return
    _RUNTIME_NAMES[value] = canonical_name
    try:
        _RUNTIME_NAMES_PATH.parent.mkdir(parents=True, exist_ok=True)
        on_disk = _load_runtime_names_from_disk()
        on_disk[value] = canonical_name
        with open(_RUNTIME_NAMES_PATH, "w") as f:
            json.dump(on_disk, f, indent=2)
    except Exception as exc:
        logger.warning("Failed to persist actor name registration: %s", exc)


def friendly(label: str | None) -> str | None:
    """Map an internal identifier (resource label, agent_id, service name, ...) to its
    canonical human-readable actor name, falling back to the raw value if unknown.
    Checks this process's own registrations and audit_actor_names.yaml first (no I/O);
    only falls through to the shared file (registered by OTHER processes) if neither
    has it, so the common case stays fast."""
    if label is None:
        return None
    if label in _RUNTIME_NAMES:
        return _RUNTIME_NAMES[label]
    if label in _ACTOR_NAMES:
        return _ACTOR_NAMES[label]
    return _load_runtime_names_from_disk().get(label, label)


def set_transaction(transaction_id: str | None) -> None:
    _transaction_id.set(transaction_id)


def set_session(session_id: str | None) -> None:
    _session_id.set(session_id)


def _token_hash(access_token: str) -> str:
    """Short, irreversible fingerprint — lets the same token be followed across
    multiple log lines (e.g. a cache hit reusing a token minted earlier) without ever
    logging the real token value."""
    return hashlib.sha256(access_token.encode()).hexdigest()[:12]


def emit_token_event(
    *,
    service: str,
    event: str,
    origin: str,
    destination: str,
    access_token: str | None = None,
    grant_type: str | None = None,
    kind: str | None = None,  # -> "token_type" in the record; renamed to dodge ruff's S106
    client_id: str | None = None,
    resource: str | None = None,
    requested_by: str | None = None,
    sub: str | None = None,
    act: Any = None,
    aud: Any = None,
    exp: int | None = None,
    success: bool = True,
    error: str | None = None,
) -> None:
    record = {
        "epoch": time.time(),
        "transaction_id": _transaction_id.get(),
        "session_id": _session_id.get(),
        "service": service,
        "event": event,
        "origin": friendly(origin),
        "destination": friendly(destination),
        "token_hash": _token_hash(access_token) if access_token else None,
        "grant_type": grant_type,
        "token_type": kind,
        "client_id": client_id,
        "resource": resource,
        # requested_by is metadata we generate (always an agent identity), and sub for
        # agent-token events is that same identity — both go through friendly() so they
        # don't show a raw agent_id while origin/destination show the canonical name.
        # For OBO events sub is the actual end-user's claim (never registered), so
        # friendly() correctly leaves it unchanged — only known agent identities resolve.
        "requested_by": friendly(requested_by),
        "sub": friendly(sub),
        "act": act,
        "aud": aud,
        "exp": exp,
        "success": success,
        "error": error,
    }
    record = {k: v for k, v in record.items() if v is not None}

    try:
        _AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_AUDIT_LOG_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as exc:
        logger.warning("Failed to write token audit event: %s", exc)
