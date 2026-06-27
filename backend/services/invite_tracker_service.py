from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.logging import get_logger
from backend.database.models import WorkerInviteLog

logger = get_logger(__name__)

_STATUS_ORDER: dict[str, int] = {
    "invited": 0,
    "clicked": 1,
    "registered": 2,
    "logged_in": 3,
}


async def create_or_update_invite_log(
    worker_id: int, email: str, full_name: str, db: AsyncSession
) -> WorkerInviteLog:
    """Create or upsert an invite log row when a magic link email is sent."""
    now = datetime.utcnow()
    row = (
        await db.execute(
            select(WorkerInviteLog).where(WorkerInviteLog.worker_id == worker_id)
        )
    ).scalar_one_or_none()

    if row is None:
        row = WorkerInviteLog(
            worker_id=worker_id,
            email=email,
            full_name=full_name,
            status="invited",
            invited_at=now,
            resend_count=0,
            updated_at=now,
        )
        db.add(row)
    else:
        row.email = email
        row.full_name = full_name
        row.invited_at = now
        row.status = "invited"
        row.resend_count = (row.resend_count or 0) + 1
        row.last_resend_at = now
        row.updated_at = now

    await db.commit()
    await db.refresh(row)
    return row


async def update_invite_status(
    worker_id: int, new_status: str, db: AsyncSession
) -> Optional[WorkerInviteLog]:
    """Advance invite status; never downgrades an already-higher status.

    For logged_in: first_login_at is set only on the first call and never overwritten.
    """
    row = (
        await db.execute(
            select(WorkerInviteLog).where(WorkerInviteLog.worker_id == worker_id)
        )
    ).scalar_one_or_none()

    if row is None:
        return None

    current_order = _STATUS_ORDER.get(row.status, 0)
    new_order = _STATUS_ORDER.get(new_status, 0)

    if new_order <= current_order:
        return row

    now = datetime.utcnow()
    row.status = new_status
    row.updated_at = now

    if new_status == "clicked" and row.clicked_at is None:
        row.clicked_at = now
    elif new_status == "registered" and row.registered_at is None:
        row.registered_at = now
    elif new_status == "logged_in" and row.first_login_at is None:
        row.first_login_at = now

    await db.commit()
    await db.refresh(row)
    return row
