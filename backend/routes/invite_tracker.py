from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.database.connection import get_db
from backend.database.models import Worker, WorkerInviteLog
from backend.services.invite_tracker_service import create_or_update_invite_log

router = APIRouter(prefix="/admin/worker-invites", tags=["invite-tracker"])


def _require_admin(user: dict = Depends(verify_supabase_token)) -> dict:
    role = (user.get("user_metadata") or {}).get("role")
    if role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


class CreateInviteLogBody(BaseModel):
    email: str
    full_name: str


@router.get("/tracker")
async def get_invite_tracker(
    status: Optional[str] = Query(None),
    view: Optional[str] = Query(None, description="pending | completed"),
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(_require_admin),
):
    q = select(WorkerInviteLog)

    # Filters:
    # - invited/clicked use exact status (workers still at that stage).
    # - registered/logged_in use milestone timestamps so workers who have
    #   advanced further still appear (e.g. a logged_in worker also shows
    #   under the registered filter because registered_at is set).
    if view == "pending":
        q = q.where(WorkerInviteLog.status.in_(["invited", "clicked"]))
    elif view == "completed":
        q = q.where(WorkerInviteLog.registered_at.isnot(None))
    elif status == "registered":
        q = q.where(WorkerInviteLog.registered_at.isnot(None))
    elif status == "logged_in":
        q = q.where(WorkerInviteLog.first_login_at.isnot(None))
    elif status is not None:
        q = q.where(WorkerInviteLog.status == status)

    rows = (await db.execute(q.order_by(WorkerInviteLog.invited_at.desc()))).scalars().all()

    # Summary counts use milestone timestamps so each stage accumulates:
    # a logged_in worker is also counted in registered, clicked, and invited.
    all_rows = (await db.execute(select(WorkerInviteLog))).scalars().all()
    total        = len(all_rows)
    clicked_cnt  = sum(1 for r in all_rows if r.clicked_at    is not None)
    reg_cnt      = sum(1 for r in all_rows if r.registered_at is not None)
    login_cnt    = sum(1 for r in all_rows if r.first_login_at is not None)
    pending_cnt  = sum(1 for r in all_rows if r.status in ("invited", "clicked"))
    completed_cnt = reg_cnt  # completed = has at least registered

    return {
        "summary": {
            "total":      total,
            "invited":    total,        # every row has been invited
            "clicked":    clicked_cnt,
            "registered": reg_cnt,
            "logged_in":  login_cnt,
            "pending":    pending_cnt,
            "completed":  completed_cnt,
        },
        "items": [
            {
                "worker_id": r.worker_id,
                "worker_name": r.full_name,
                "email": r.email,
                "status": r.status,
                "invited_at": r.invited_at,
                "clicked_at": r.clicked_at,
                "registered_at": r.registered_at,
                "first_login_at": r.first_login_at,
                "resend_count": r.resend_count,
                "last_resend_at": r.last_resend_at,
                "updated_at": r.updated_at,
            }
            for r in rows
        ],
    }


@router.post("/{worker_id}", status_code=200)
async def create_invite_log(
    worker_id: int,
    body: CreateInviteLogBody,
    db: AsyncSession = Depends(get_db),
    _admin: dict = Depends(_require_admin),
):
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    try:
        row = await create_or_update_invite_log(
            worker_id=worker_id,
            email=body.email,
            full_name=body.full_name,
            db=db,
        )
        return {
            "status": row.status,
            "invited_at": row.invited_at,
            "resend_count": row.resend_count,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to log invite: {exc}")
