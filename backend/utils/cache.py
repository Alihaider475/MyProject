from __future__ import annotations

import hashlib
import logging
from typing import Any, Callable

from fastapi import Request, Response
from fastapi_cache import FastAPICache
from fastapi_cache.coder import JsonCoder
from starlette.requests import Request as StarletteRequest

logger = logging.getLogger(__name__)


def stable_key_builder(
    func: Callable[..., Any],
    namespace: str = "",
    *,
    request: Request | StarletteRequest | None = None,
    response: Response | None = None,
    args: tuple[Any, ...] = (),
    kwargs: dict[str, Any] | None = None,
) -> str:
    """Build a deterministic cache key from function name + query params only.

    The default fastapi-cache2 key builder hashes ``Request`` / ``Response``
    objects, which differ on every call and cause 100% cache misses.  This
    builder ignores ephemeral objects (Request, Response, AsyncSession, user
    dicts) and derives the key from:

    * The function's qualified name
    * Sorted query parameters (from the Request, if available)
    * The namespace prefix configured in FastAPICache.init()

    This produces stable, reproducible keys for the same logical request.
    """
    if kwargs is None:
        kwargs = {}

    prefix = FastAPICache.get_prefix()
    func_name = func.__module__ + "." + func.__qualname__

    # Extract query params from the Request, if available
    query_parts: str = ""
    if request is not None and hasattr(request, "query_params"):
        # Sort query params for deterministic ordering
        sorted_params = sorted(request.query_params.items())
        query_parts = "&".join(f"{k}={v}" for k, v in sorted_params)

    # Build a short, stable hash
    raw_key = f"{func_name}:{query_parts}"
    key_hash = hashlib.md5(raw_key.encode()).hexdigest()

    cache_key = f"{prefix}:{namespace}:{key_hash}"
    return cache_key


async def invalidate_backend_cache() -> None:
    """Clear all keys in the FastAPI Cache storage (both Redis and InMemory).

    Called reactively on DB writes/mutations so summary endpoints (which are
    cached for 30s) are invalidated instantly.
    """
    try:
        # FastAPICache.clear() will clear the entire configured cache backend
        await FastAPICache.clear()
        logger.info("[CACHE] Backend HTTP cache invalidated successfully")
    except Exception as exc:
        logger.warning("[CACHE] Failed to invalidate backend HTTP cache: %s", exc)


def build_manual_cache_key(endpoint_name: str, params: dict[str, Any]) -> str:
    """Build a stable, deterministic cache key from endpoint name and params.

    Safely excludes raw JWT tokens, request, response, database session, or user objects.
    """
    unsafe_keys = {
        "request",
        "response",
        "db",
        "session",
        "_user",
        "user",
        "credentials",
        "token",
        "jwt",
        "authorization",
        "auth",
    }
    filtered_params = {}
    for k, v in params.items():
        if k.lower() in unsafe_keys:
            continue
        if v is None:
            continue
        # Convert datetime to string for stable key hashing
        if hasattr(v, "isoformat"):
            filtered_params[k] = v.isoformat()
        else:
            filtered_params[k] = str(v)

    # Deterministic query string representation
    sorted_items = sorted(filtered_params.items())
    query_str = "&".join(f"{k}={v}" for k, v in sorted_items)

    prefix = FastAPICache.get_prefix() or "fastapi-cache"
    raw_key = f"manual:{endpoint_name}:{query_str}"
    key_hash = hashlib.md5(raw_key.encode()).hexdigest()
    return f"{prefix}:manual:{endpoint_name}:{key_hash}"


async def get_manual_cache(key: str) -> Any | None:
    """Retrieve and decode JSON value from cache backend."""
    backend = FastAPICache.get_backend()
    if backend is None:
        logger.info("[CACHE] miss (backend unavailable)")
        return None
    try:
        data = await backend.get(key)
        if data:
            logger.info("[CACHE] hit (%s)", key)
            return JsonCoder.decode(data)
        logger.info("[CACHE] miss (%s)", key)
    except Exception as exc:
        logger.warning("[CACHE] failed get (%s): %s", key, exc)
    return None


async def set_manual_cache(key: str, value: Any, expire: int = 30) -> None:
    """Encode value to JSON and store in cache backend with TTL."""
    backend = FastAPICache.get_backend()
    if backend is None:
        logger.info("[CACHE] skip set (backend unavailable)")
        return
    try:
        encoded = JsonCoder.encode(value)
        await backend.set(key, encoded, expire=expire)
        logger.info("[CACHE] set (%s, %ds)", key, expire)
    except Exception as exc:
        logger.warning("[CACHE] failed set (%s): %s", key, exc)
