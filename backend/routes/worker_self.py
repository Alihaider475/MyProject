from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.database.connection import _IS_POSTGRES, get_db
from backend.database.models import Fine, Violation, Worker
from backend.schemas.fine import FineResponse
from backend.schemas.worker_self import WorkerDashboardResponse
from backend.services.invite_tracker_service import update_invite_status
from backend.utils.worker_resolver import resolve_worker_from_user

router = APIRouter(prefix="/worker/me", tags=["worker-self"])

_MONTH_RE = re.compile(r"\d{4}-(0[1-9]|1[0-2])")


def _month_of(column):
    """Dialect-aware YYYY-MM extraction, matching backend/routes/fines.py's convention."""
    if _IS_POSTGRES:
        return func.to_char(column, "YYYY-MM")
    return func.strftime("%Y-%m", column)


def _effective_month_expr():
    """Month a fine counts toward: the explicit deduction_month if set,
    otherwise the month the fine was issued — mirrors fines.py."""
    return func.coalesce(Fine.deduction_month, _month_of(Fine.fine_date))


def _validate_month(month: Optional[str]) -> str:
    if month is None:
        return datetime.utcnow().strftime("%Y-%m")
    if not _MONTH_RE.fullmatch(month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    return month


async def get_current_worker(
    user: dict = Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
) -> Worker:
    role = (user.get("user_metadata") or {}).get("role")
    if role != "worker":
        raise HTTPException(status_code=403, detail="Worker role required")

    worker = await resolve_worker_from_user(user, db)
    if worker is None:
        raise HTTPException(
            status_code=404,
            detail="No worker profile linked to this account. Contact admin.",
        )
    return worker


class TrackInviteBody(BaseModel):
    event: str  # "clicked" | "registered"


@router.post("/track-invite", status_code=200)
async def track_invite_event(
    body: TrackInviteBody,
    worker: Worker = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    if body.event not in ("clicked", "registered"):
        raise HTTPException(status_code=400, detail="event must be 'clicked' or 'registered'")
    try:
        row = await update_invite_status(worker.id, body.event, db)
        return {"status": row.status if row else "no_log_found"}
    except Exception:
        return {"status": "ok"}


@router.get("/dashboard", response_model=WorkerDashboardResponse)
async def worker_dashboard(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    worker: Worker = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    try:
        await update_invite_status(worker.id, "logged_in", db)
    except Exception:
        pass

    target_month = _validate_month(month)

    status_totals = dict(
        (
            await db.execute(
                select(Fine.status, func.coalesce(func.sum(Fine.fine_amount), 0.0))
                .where(Fine.worker_id == worker.id, _effective_month_expr() == target_month)
                .group_by(Fine.status)
            )
        ).all()
    )

    total_violations = (
        await db.execute(
            select(func.count(Violation.id)).where(
                Violation.worker_id == worker.id,
                _month_of(Violation.timestamp) == target_month,
            )
        )
    ).scalar_one()

    deducted = float(status_totals.get("deducted") or 0.0)
    net_salary = max(0.0, worker.base_salary - deducted)

    return WorkerDashboardResponse(
        worker_name=worker.name,
        employee_id=worker.employee_id,
        department=worker.department,
        base_salary=worker.base_salary,
        total_violations=int(total_violations or 0),
        pending_fine_amount=float(status_totals.get("pending") or 0.0),
        paid_fine_amount=float(status_totals.get("paid") or 0.0),
        deducted_fine_amount=deducted,
        waived_fine_amount=float(status_totals.get("waived") or 0.0),
        net_salary=net_salary,
        salary_fully_offset=worker.base_salary > 0 and net_salary == 0.0,
        month=target_month,
    )


@router.get("/violations")
async def my_violations(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    worker: Worker = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    q = (
        select(Violation)
        .where(Violation.worker_id == worker.id)
        .order_by(Violation.timestamp.desc())
    )
    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (await db.execute(q.offset((page - 1) * page_size).limit(page_size))).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": v.id,
                "camera_id": v.camera_id,
                "violation_type": v.violation_type,
                "confidence": v.confidence,
                "timestamp": v.timestamp,
                "frame_path": v.frame_path,
                "fine_amount": v.fine_amount,
                "resolved_at": v.resolved_at,
            }
            for v in items
        ],
    }


@router.get("/fines", response_model=dict)
async def my_fines(
    status: Optional[str] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    worker: Worker = Depends(get_current_worker),
    db: AsyncSession = Depends(get_db),
):
    q = select(Fine).where(Fine.worker_id == worker.id)
    if status is not None:
        q = q.where(Fine.status == status)
    if month is not None:
        if not _MONTH_RE.fullmatch(month):
            raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
        q = q.where(_effective_month_expr() == month)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (
        await db.execute(
            q.order_by(Fine.fine_date.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [FineResponse.model_validate(f) for f in items],
    }
