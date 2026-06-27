from __future__ import annotations

import httpx

from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

_STORAGE_API = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1"
_SERVICE_HEADERS = {
    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
}


async def upload(bucket: str, path: str, data: bytes, content_type: str = "image/jpeg") -> str:
    """Upload bytes to a Supabase Storage bucket. Returns the bucket-relative path.

    Uses upsert so re-saving the same path (e.g. worker re-enrollment) overwrites
    cleanly instead of erroring on conflict.
    """
    url = f"{_STORAGE_API}/object/{bucket}/{path}"
    headers = {**_SERVICE_HEADERS, "Content-Type": content_type, "x-upsert": "true"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, headers=headers, content=data)
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase Storage upload failed ({resp.status_code}): {resp.text[:300]}")
    return path


def public_url(bucket: str, path: str) -> str:
    return f"{_STORAGE_API}/object/public/{bucket}/{path}"


async def signed_url(bucket: str, path: str, expires_in: int = 300) -> str | None:
    """Generate a short-lived signed URL for a private bucket object."""
    url = f"{_STORAGE_API}/object/sign/{bucket}/{path}"
    headers = {**_SERVICE_HEADERS, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, headers=headers, json={"expiresIn": expires_in})
    if resp.status_code >= 400:
        logger.warning("Supabase signed-url failed for %s/%s: %s", bucket, path, resp.status_code)
        return None
    signed_path = resp.json().get("signedURL")
    if not signed_path:
        return None
    return f"{_STORAGE_API}{signed_path}" if signed_path.startswith("/") else signed_path


def fetch_bytes_sync(url: str) -> bytes | None:
    """Blocking variant of fetch_bytes — only for call sites already running
    inside a thread-pool executor (e.g. the synchronous PDF generator)."""
    try:
        resp = httpx.get(url, timeout=15.0)
        if resp.status_code != 200:
            logger.warning("Supabase Storage fetch failed (%s): %s", resp.status_code, url)
            return None
        return resp.content
    except Exception as exc:
        logger.warning("Supabase Storage fetch error for %s: %s", url, exc)
        return None


async def fetch_bytes(url: str) -> bytes | None:
    """Fetch object bytes from a public or signed Supabase Storage URL."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
        if resp.status_code != 200:
            logger.warning("Supabase Storage fetch failed (%s): %s", resp.status_code, url)
            return None
        return resp.content
    except Exception as exc:
        logger.warning("Supabase Storage fetch error for %s: %s", url, exc)
        return None


async def delete(bucket: str, paths: list[str]) -> None:
    if not paths:
        return
    url = f"{_STORAGE_API}/object/{bucket}"
    headers = {**_SERVICE_HEADERS, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.request("DELETE", url, headers=headers, json={"prefixes": paths})
    if resp.status_code >= 400:
        logger.warning("Supabase Storage delete failed (%s): %s", resp.status_code, resp.text[:200])
