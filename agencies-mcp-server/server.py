import os
import logging
import time

import httpx
import jwt as pyjwt
import uvicorn
from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.middleware import Middleware

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

IDP_BASE_URL = os.environ["IDP_BASE_URL"]
SSL_VERIFY = os.environ.get("SSL_VERIFY", "true").lower() != "false"
EXPECTED_AUDIENCE = os.environ["EXPECTED_AUDIENCE"]


def _agency(name: str, address: str, phone: str, hours: str, services: list[str]) -> dict:
    return {"name": name, "address": address, "phone": phone, "opening_hours": hours, "services": services}


AGENCIES: dict[str, list[dict]] = {
    "paris": [
        _agency("Asgard Paris - Opéra", "12 Boulevard des Capucines, 75009 Paris",
                "+33 1 42 00 01 01", "Mon-Fri 09:00-17:30, Sat 09:00-12:00",
                ["Current accounts", "Mortgages", "Wealth management"]),
        _agency("Asgard Paris - Marais", "34 Rue de Bretagne, 75003 Paris",
                "+33 1 42 00 02 02", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Business banking", "Foreign exchange"]),
        _agency("Asgard Paris - Nation", "78 Avenue du Trône, 75011 Paris",
                "+33 1 42 00 03 03", "Mon-Fri 09:00-17:00, Sat 10:00-12:00",
                ["Current accounts", "Savings", "Insurance"]),
        _agency("Asgard Paris - La Défense", "15 Parvis de la Défense, 92800 Puteaux",
                "+33 1 42 00 04 04", "Mon-Fri 08:30-18:00",
                ["Business banking", "Corporate finance", "Trade finance"]),
        _agency("Asgard Paris - Montparnasse", "56 Rue du Départ, 75014 Paris",
                "+33 1 42 00 05 05", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Mortgages", "Student banking"]),
    ],
    "london": [
        _agency("Asgard London - City", "10 Bishopsgate, EC2N 4AY London",
                "+44 20 7000 1001", "Mon-Fri 08:30-17:30",
                ["Business banking", "Corporate finance", "Wealth management"]),
        _agency("Asgard London - Canary Wharf", "25 Canada Square, E14 5LQ London",
                "+44 20 7000 1002", "Mon-Fri 08:30-18:00",
                ["Business banking", "Trade finance", "Foreign exchange"]),
        _agency("Asgard London - Kensington", "82 Kensington High Street, W8 4SG London",
                "+44 20 7000 1003", "Mon-Fri 09:00-17:00, Sat 09:30-13:00",
                ["Current accounts", "Mortgages", "Savings"]),
        _agency("Asgard London - Shoreditch", "47 Old Street, EC1V 9HX London",
                "+44 20 7000 1004", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Business banking", "Insurance"]),
        _agency("Asgard London - Victoria", "3 Victoria Street, SW1H 0JL London",
                "+44 20 7000 1005", "Mon-Fri 09:00-17:00, Sat 10:00-13:00",
                ["Current accounts", "Mortgages", "Student banking"]),
    ],
    "new york": [
        _agency("Asgard New York - Midtown", "350 Fifth Avenue, NY 10118",
                "+1 212 000 1001", "Mon-Fri 08:00-18:00",
                ["Business banking", "Corporate finance", "Wealth management"]),
        _agency("Asgard New York - Wall Street", "11 Wall Street, NY 10005",
                "+1 212 000 1002", "Mon-Fri 08:00-17:00",
                ["Business banking", "Trade finance", "Foreign exchange"]),
        _agency("Asgard New York - Brooklyn", "225 Flatbush Avenue, Brooklyn NY 11217",
                "+1 718 000 1003", "Mon-Fri 09:00-17:00, Sat 09:00-13:00",
                ["Current accounts", "Mortgages", "Savings"]),
        _agency("Asgard New York - Upper West Side", "2400 Broadway, NY 10024",
                "+1 212 000 1004", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Insurance", "Student banking"]),
    ],
    "stockholm": [
        _agency("Asgard Stockholm - Gamla Stan", "Köpmangatan 8, 111 31 Stockholm",
                "+46 8 000 1001", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Mortgages", "Wealth management"]),
        _agency("Asgard Stockholm - Södermalm", "Götgatan 22, 118 46 Stockholm",
                "+46 8 000 1002", "Mon-Fri 09:00-17:00, Sat 10:00-13:00",
                ["Current accounts", "Savings", "Insurance"]),
        _agency("Asgard Stockholm - Kungsholmen", "Hantverkargatan 15, 112 21 Stockholm",
                "+46 8 000 1003", "Mon-Fri 09:00-16:30",
                ["Business banking", "Foreign exchange", "Trade finance"]),
    ],
    "__default__": [
        _agency("Asgard Central Branch", "1 Yggdrasil Square, Asgard City",
                "+00 0 000 0001", "Mon-Fri 09:00-17:00",
                ["Current accounts", "Savings", "Mortgages"]),
        _agency("Asgard North Branch", "99 Bifrost Road, Asgard City",
                "+00 0 000 0002", "Mon-Fri 09:00-17:00, Sat 09:00-12:00",
                ["Current accounts", "Business banking", "Insurance"]),
        _agency("Asgard South Branch", "42 Valhalla Avenue, Asgard City",
                "+00 0 000 0003", "Mon-Fri 09:00-16:30",
                ["Current accounts", "Foreign exchange", "Wealth management"]),
    ],
}


_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0
_JWKS_TTL = 3600  # 1 hour


def _fetch_jwks() -> dict:
    """Fetch JWKS from IDP with a 1-hour TTL cache."""
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if _jwks_cache is None or (now - _jwks_fetched_at) > _JWKS_TTL:
        url = f"{IDP_BASE_URL}/oauth2/jwks"
        logger.info("Fetching JWKS from %s", url)
        resp = httpx.get(url, verify=SSL_VERIFY, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        _jwks_fetched_at = now
    return _jwks_cache


def _invalidate_jwks_cache() -> None:
    global _jwks_cache
    _jwks_cache = None


def _validate_token(token: str) -> None:
    """Validate a JWT bearer token against the IDP's JWKS. Raises on failure.

    Retries once with a fresh JWKS fetch if all cached keys fail, to handle
    IDP key rotation without requiring a process restart.
    """
    try:
        unverified = pyjwt.decode(token, options={"verify_signature": False})
        logger.info(
            "Token claims — aud=%r  sub=%r  iss=%r  exp=%r",
            unverified.get("aud"),
            unverified.get("sub"),
            unverified.get("iss"),
            unverified.get("exp"),
        )
    except Exception as peek_err:
        logger.warning("Could not decode token for inspection: %s", peek_err)

    logger.info("Expected audience: %r", EXPECTED_AUDIENCE)

    last_err: Exception | None = None
    for attempt in range(2):
        jwks = _fetch_jwks()
        signing_keys = [k for k in jwks.get("keys", []) if k.get("use") == "sig"]
        if not signing_keys:
            signing_keys = jwks.get("keys", [])
        if not signing_keys:
            raise ValueError("No signing keys found in JWKS")

        last_err = None
        for key_data in signing_keys:
            try:
                public_key = pyjwt.algorithms.RSAAlgorithm.from_jwk(key_data)
                pyjwt.decode(
                    token,
                    public_key,
                    algorithms=["RS256"],
                    audience=EXPECTED_AUDIENCE,
                )
                return
            except Exception as e:
                last_err = e

        if attempt == 0:
            logger.warning("All JWKS keys failed — invalidating cache and retrying once")
            _invalidate_jwks_cache()

    raise last_err or ValueError("Token validation failed")


_UNAUTHORIZED = (
    b'{"error":"Unauthorized"}',
    [(b"content-type", b"application/json"), (b"content-length", b"23")],
)


class BearerAuthMiddleware:
    """Pure ASGI bearer-token middleware — compatible with SSE streaming responses.

    BaseHTTPMiddleware buffers the response body and breaks SSE streams.
    This implementation operates at the raw ASGI level so the SSE stream
    passes through untouched once the token is validated.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] == "http":
            headers = {k.lower(): v for k, v in scope.get("headers", [])}
            auth = headers.get(b"authorization", b"").decode()
            if not auth.startswith("Bearer "):
                logger.warning("Request rejected — missing or invalid Authorization header")
                await self._send_401(send)
                return
            token = auth[len("Bearer "):]
            try:
                _validate_token(token)
            except Exception as exc:
                logger.warning("Request rejected — token validation failed: %s", exc)
                await self._send_401(send)
                return
        await self.app(scope, receive, send)

    @staticmethod
    async def _send_401(send) -> None:
        body, headers = _UNAUTHORIZED
        await send({"type": "http.response.start", "status": 401, "headers": headers})
        await send({"type": "http.response.body", "body": body})


mcp = FastMCP("Bank of Asgard — Agencies")


@mcp.tool()
def get_agencies(town: str) -> list[dict]:
    """Find Bank of Asgard branches and agencies near a given town.

    Args:
        town: The name of the town or city to search near (e.g. "Paris", "London").

    Returns:
        A list of agency objects, each with name, address, phone, opening_hours, and services.
    """
    result = AGENCIES.get(town.strip().lower(), AGENCIES["__default__"])
    logger.info("get_agencies(%r) → %d results", town, len(result))
    return result


if __name__ == "__main__":
    logger.info("Starting Agencies MCP server on port 8012 (IDP: %s)", IDP_BASE_URL)
    app = mcp.http_app(transport="sse", middleware=[Middleware(BearerAuthMiddleware)])
    uvicorn.run(app, host="0.0.0.0", port=8012)  # noqa: S104
