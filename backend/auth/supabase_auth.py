from __future__ import annotations

from dataclasses import dataclass

import httpx
import jwt
from fastapi import Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.core.config import settings

_bearer = HTTPBearer(auto_error=False)

ROLE_ADMIN = "admin"
ROLE_SAFETY_MANAGER = "safety_manager"


@dataclass(frozen=True)
class AuthUser:
    """Authenticated Supabase user extracted from a verified access token."""

    user_id: str
    email: str | None
    role: str  # normalized: "admin" | "safety_manager"
    raw_role: str | None = None  # original metadata role ('user', 'admin', None, ...)

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN


def _normalize_role(raw: str | None) -> str:
    return ROLE_ADMIN if raw == ROLE_ADMIN else ROLE_SAFETY_MANAGER


def _extract_role(meta_user: dict, meta_app: dict) -> str | None:
    # Role lives in user/app metadata; the top-level JWT "role" claim is the
    # Postgres role ("authenticated") for every user and must not be used.
    return meta_user.get("role") or meta_app.get("role")


def _decode_local(token: str) -> AuthUser:
    try:
        claims = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            leeway=30,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired") from None
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None
    raw_role = _extract_role(claims.get("user_metadata") or {}, claims.get("app_metadata") or {})
    return AuthUser(
        user_id=claims["sub"],
        email=claims.get("email"),
        role=_normalize_role(raw_role),
        raw_role=raw_role,
    )


async def _fetch_user_via_api(token: str) -> AuthUser:
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
    data = resp.json()
    raw_role = _extract_role(data.get("user_metadata") or {}, data.get("app_metadata") or {})
    return AuthUser(
        user_id=data["id"],
        email=data.get("email"),
        role=_normalize_role(raw_role),
        raw_role=raw_role,
    )


async def authenticate_token(token: str) -> AuthUser:
    """Verify a Supabase access token and return the authenticated user.

    Fast path: local HS256 verification with SUPABASE_JWT_SECRET. Falls back to
    the Supabase /auth/v1/user API when the secret is unset or the token uses
    asymmetric signing (ES256/RS256 projects).
    """
    if settings.SUPABASE_JWT_SECRET:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid or expired token") from None
        if header.get("alg") == "HS256":
            return _decode_local(token)
    return await _fetch_user_via_api(token)


async def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),  # noqa: B008
) -> AuthUser:
    """Validate the Authorization: Bearer header and return the user (401 otherwise)."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    return await authenticate_token(credentials.credentials)


async def require_admin_user(
    user: AuthUser = Depends(require_authenticated_user),  # noqa: B008
) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_safety_manager_or_admin(
    user: AuthUser = Depends(require_authenticated_user),  # noqa: B008
) -> AuthUser:
    if user.role not in (ROLE_ADMIN, ROLE_SAFETY_MANAGER):
        raise HTTPException(status_code=403, detail="Safety manager or admin access required")
    return user


async def get_stream_user(token: str | None = Query(None)) -> AuthUser:
    """Auth dependency for endpoints whose URLs carry the token as a query param

    (MJPEG <img> streams, WebSocket URLs, challan PDF links).
    """
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    return await authenticate_token(token)


async def require_admin_stream_user(
    user: AuthUser = Depends(get_stream_user),  # noqa: B008
) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
