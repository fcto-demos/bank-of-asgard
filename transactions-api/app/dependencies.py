import os
import json
import time
import logging
import requests
from typing import Dict, Any, Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, SecurityScopes
import jwt

from pydantic import BaseModel

from dotenv import load_dotenv
load_dotenv()

logger = logging.getLogger(__name__)

security = HTTPBearer()

class Actor(BaseModel):
    sub: str | None = None

class TokenData(BaseModel):
    sub: str | None = None
    act: Actor = None
    scopes: list[str] = []


class JWKSClient:
    """JWKS client for fetching and caching JSON Web Key Sets"""

    def __init__(self, jwks_url: str, cache_ttl: int = 3600):
        self.jwks_url = jwks_url
        self.cache_ttl = cache_ttl
        self._jwks_cache: Optional[Dict[str, Any]] = None
        self._cache_timestamp: float = 0

    def _fetch_jwks(self) -> Dict[str, Any]:
        """Fetch JWKS from the JWKS URL"""
        try:
            response = requests.get(self.jwks_url, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            raise HTTPException(
                status_code=503,
                detail=f"Unable to fetch JWKS from {self.jwks_url}: {str(e)}"
            )

    def get_jwks(self) -> Dict[str, Any]:
        """Get JWKS with caching"""
        current_time = time.time()

        if (self._jwks_cache is None or
            current_time - self._cache_timestamp > self.cache_ttl):
            self._jwks_cache = self._fetch_jwks()
            self._cache_timestamp = current_time

        return self._jwks_cache

    def get_signing_key(self, kid: str) -> str:
        """Get the signing key for a given key ID"""
        jwks = self.get_jwks()

        for key in jwks.get('keys', []):
            if key.get('kid') == kid:
                if key.get('kty') == 'RSA':
                    return self._jwk_to_pem(key)
                else:
                    raise HTTPException(
                        status_code=401,
                        detail=f"Unsupported key type: {key.get('kty')}"
                    )

        raise HTTPException(
            status_code=401,
            detail=f"Unable to find key with kid: {kid}"
        )

    def _jwk_to_pem(self, jwk: Dict[str, Any]) -> str:
        """Convert JWK to PEM format"""
        try:
            from jwt.algorithms import RSAAlgorithm
            return RSAAlgorithm.from_jwk(json.dumps(jwk))
        except Exception as e:
            raise HTTPException(
                status_code=401,
                detail=f"Invalid JWK format: {str(e)}"
            )


# Initialize JWKS client
def get_jwks_client() -> JWKSClient:
    """Get JWKS client instance"""
    jwks_url = os.getenv('JWKS_URL')
    if not jwks_url:
        raise HTTPException(
            status_code=500,
            detail="JWKS_URL environment variable not set"
        )

    cache_ttl = int(os.getenv('JWKS_CACHE_TTL', '3600'))
    return JWKSClient(jwks_url, cache_ttl)


async def validate_token(
    security_scopes: SecurityScopes,
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> TokenData:
    """
    Decode and validate JWT using JWKS for signature verification.
    """
    token = credentials.credentials
    jwks_client = get_jwks_client()
    issuer = os.getenv('JWT_ISSUER')

    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get('kid')

        if not kid:
            raise HTTPException(
                status_code=401,
                detail="Token missing 'kid' in header"
            )

        signing_key = jwks_client.get_signing_key(kid)

        decode_options = {
            "verify_signature": True,
            "verify_iss": bool(issuer),
            "verify_aud": False,
            "verify_exp": True,
            "verify_nbf": True,
            "verify_iat": True,
        }

        payload = jwt.decode(
            token,
            signing_key,
            algorithms=['RS256', 'RS384', 'RS512'],
            issuer=issuer if issuer else None,
            options=decode_options,
            leeway=30,  # tolerate up to 30s clock skew
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token validation failed: {str(e)}")

    sub = payload.get("sub")
    if sub is None:
        raise HTTPException(status_code=401, detail="Missing 'sub' claim in token")

    act_claim = payload.get("act")
    if act_claim is None:
        act = Actor(sub=None)
    elif isinstance(act_claim, dict):
        try:
            act = Actor(sub=act_claim.get("sub"))
        except Exception as e:
            logger.warning(f"Could not parse act claim {act_claim}: {e}")
            act = Actor(sub=None)
    else:
        logger.warning(f"act claim is not a dict: {act_claim}")
        act = Actor(sub=None)

    raw_scope = payload.get("scope")
    if raw_scope is None:
        logger.warning("Token for sub '%s' has no 'scope' claim", sub)
        raise HTTPException(
            status_code=403,
            detail="Token is missing the 'scope' claim. Ensure the application has the required API permissions configured."
        )

    token_scopes = raw_scope if isinstance(raw_scope, list) else raw_scope.split()
    logger.info("Token scopes for sub '%s': %s", sub, token_scopes)

    for scope in security_scopes.scopes:
        if scope not in token_scopes:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required: '{scope}'. Token scopes: {token_scopes}"
            )

    return TokenData(sub=sub, act=act, scopes=token_scopes)
