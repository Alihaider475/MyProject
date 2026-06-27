from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Worker


async def resolve_worker_from_user(user: dict, db: AsyncSession) -> Optional[Worker]:
    """Resolve the Worker row tied to a verified Supabase user.

    Prefers the worker_id stamped into user_metadata at invite time (durable
    across later email edits); falls back to a case-insensitive email match
    for accounts that predate/lack that claim.
    """
    worker_id = user.get("user_metadata", {}).get("worker_id")
    if worker_id is not None:
        try:
            return await db.get(Worker, int(worker_id))
        except (TypeError, ValueError):
            pass

    email = (user.get("email") or "").strip().lower()
    if not email:
        return None

    try:
        return (
            await db.execute(
                select(Worker).where(func.lower(func.trim(Worker.email)) == email)
            )
        ).scalar_one_or_none()
    except MultipleResultsFound:
        raise HTTPException(
            status_code=409,
            detail="Multiple worker records share this email. Contact admin to resolve.",
        )
