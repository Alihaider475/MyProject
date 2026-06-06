from __future__ import annotations

import hashlib
import logging
import time as _time
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.core.config import settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

# ---------------------------------------------------------------------------
# In-memory auth cache — avoids repeated Supabase /auth/v1/user round-trips.
#
# Keys  : SHA-256 hex digest of the raw JWT (never store the token itself).
# Values: (user_dict, expiry_timestamp)
# TTL   : 60 seconds — a revoked token is valid at most 60s after revocation.
# ---------------------------------------------------------------------------
_AUTH_CACHE: dict[str, tuple[dict[str, Any], float]] = {}
_AUTH_CACHE_TTL = 60  # seconds


def _token_hash(token: str) -> str:
    """Return a SHA-256 hex digest of *token* — safe for use as a cache key."""
    return hashlib.sha256(token.encode()).hexdigest()


def _cache_get(token: str) -> dict[str, Any] | None:
    """Return cached user dict if it exists and hasn't expired, else None."""
    key = _token_hash(token)
    entry = _AUTH_CACHE.get(key)
    if entry is None:
        return None
    user_data, expires_at = entry
    if _time.monotonic() > expires_at:
        # Expired — remove stale entry
        _AUTH_CACHE.pop(key, None)
        return None
    return user_data


def _cache_set(token: str, user_data: dict[str, Any]) -> None:
    """Store *user_data* in cache keyed by the SHA-256 hash of *token*."""
    key = _token_hash(token)
    _AUTH_CACHE[key] = (user_data, _time.monotonic() + _AUTH_CACHE_TTL)


async def _verify_remote(token: str) -> dict[str, Any]:
    """Call Supabase /auth/v1/user to verify a JWT remotely."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
            timeout=5.0,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return resp.json()


async def verify_supabase_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Validate a Supabase JWT from the Authorization: Bearer header.

    Uses an in-memory cache (60s TTL) keyed by SHA-256(token) to avoid
    repeated remote round-trips to Supabase.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization header")

    token = credentials.credentials
    t0 = _time.perf_counter()

    # Check cache first
    cached = _cache_get(token)
    if cached is not None:
        elapsed_ms = (_time.perf_counter() - t0) * 1000
        logger.info("[AUTH] cache hit (%.1fms)", elapsed_ms)
        return cached

    # Cache miss — verify remotely
    user_data = await _verify_remote(token)
    _cache_set(token, user_data)

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("[AUTH] remote verification (%.1fms)", elapsed_ms)
    return user_data


async def get_stream_user(token: str | None = Query(None)) -> dict:
    """Auth dependency for streaming endpoints (token delivered as query param).

    Uses the same in-memory auth cache as verify_supabase_token.
    """
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    t0 = _time.perf_counter()

    # Check cache first
    cached = _cache_get(token)
    if cached is not None:
        elapsed_ms = (_time.perf_counter() - t0) * 1000
        logger.info("[AUTH] cache hit (%.1fms)", elapsed_ms)
        return cached

    # Cache miss — verify remotely
    user_data = await _verify_remote(token)
    _cache_set(token, user_data)

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("[AUTH] remote verification (%.1fms)", elapsed_ms)
    return user_data
