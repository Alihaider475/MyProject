from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.auth.supabase_auth import verify_supabase_token
from backend.database.connection import get_db
from backend.database.models import AlertLog
from backend.schemas.alert import AlertLogItem, AlertLogListResponse
from backend.utils.helpers import naive_utc as _naive_utc

router = APIRouter(prefix="/alert-logs", tags=["alert-logs"])

# error_msg may embed webhook URLs via httpx exception text; never expose them.
_URL_RE = re.compile(r"https?://\S+")


def _derive_status(log: AlertLog) -> str:
    if not log.success:
        return "failed"
    if log.error_msg and log.error_msg.startswith("skipped:"):
        return "skipped"
    return "sent"


def _to_item(log: AlertLog) -> AlertLogItem:
    error_msg = log.error_msg
    if error_msg:
        error_msg = _URL_RE.sub("[url redacted]", error_msg)

    violation_type: Optional[str] = None
    camera_id: Optional[int] = None
    try:
        if log.violation is not None:
            violation_type = log.violation.violation_type
            camera_id = log.violation.camera_id
    except Exception:
        pass

    return AlertLogItem(
        id=log.id,
        violation_id=log.violation_id,
        handler_type=log.handler_type,
        sent_at=log.sent_at,
        success=log.success,
        error_msg=error_msg,
        status=_derive_status(log),
        violation_type=violation_type,
        camera_id=camera_id,
    )


@router.get("", response_model=AlertLogListResponse)
async def list_alert_logs(
    handler_type: Optional[str] = Query(None, description="email | mqtt | webhook"),
    status: Optional[str] = Query(None, pattern="^(sent|skipped|failed)$"),
    violation_id: Optional[int] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    from_dt = _naive_utc(from_dt)
    to_dt = _naive_utc(to_dt)

    q = (
        select(AlertLog)
        .options(selectinload(AlertLog.violation))
        .order_by(AlertLog.sent_at.desc(), AlertLog.id.desc())
    )
    if handler_type is not None:
        q = q.where(AlertLog.handler_type == handler_type)
    if status == "sent":
        q = q.where(AlertLog.success.is_(True), AlertLog.error_msg.is_(None))
    elif status == "skipped":
        q = q.where(AlertLog.success.is_(True), AlertLog.error_msg.like("skipped:%"))
    elif status == "failed":
        q = q.where(AlertLog.success.is_(False))
    if violation_id is not None:
        q = q.where(AlertLog.violation_id == violation_id)
    if from_dt is not None:
        q = q.where(AlertLog.sent_at >= from_dt)
    if to_dt is not None:
        q = q.where(AlertLog.sent_at <= to_dt)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()

    return AlertLogListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[_to_item(log) for log in items],
    )
