from __future__ import annotations

import httpx
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.core.config import settings

_bearer = HTTPBearer(auto_error=False)


async def verify_supabase_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Validate a Supabase JWT from the Authorization: Bearer header."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    token = credentials.credentials
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


async def get_stream_user(token: str | None = Query(None)) -> dict:
    """Auth dependency for streaming endpoints (token delivered as query param)."""
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
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
