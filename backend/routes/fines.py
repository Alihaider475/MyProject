from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import get_stream_user, verify_supabase_token
from backend.core.config import settings
from backend.detection.violation_checker import ViolationEvent
from backend.database.models import Fine, FineConfig, Violation, Worker
from backend.database.connection import get_db, _IS_POSTGRES
from backend.reports import challan_generator
from backend.schemas.fine import (
    FinalizeMonthResponse,
    FineConfigResponse,
    FineConfigUpdate,
    FineResponse,
    MonthlyReport,
    SettleFineRequest,
    ViolationBreakdown,
    WaiveBody,
    WorkerFineTotal,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fines", tags=["fines"])


def _effective_month_expr():
    """Month a fine counts toward: the explicit deduction_month if set,
    otherwise the month the fine was issued — so pending fines show up in
    payroll immediately."""
    if _IS_POSTGRES:
        return func.coalesce(Fine.deduction_month, func.to_char(Fine.fine_date, "YYYY-MM"))
    return func.coalesce(Fine.deduction_month, func.strftime("%Y-%m", Fine.fine_date))


# ── Fine config routes ────────────────────────────────────────────────────────


@router.get("/config", response_model=list[FineConfigResponse])
async def list_fine_configs(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    rows = (
        await db.execute(select(FineConfig).order_by(FineConfig.violation_type))
    ).scalars().all()
    return rows


@router.put("/config/{violation_type}", response_model=FineConfigResponse)
async def update_fine_config(
    violation_type: str,
    body: FineConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    config = (
        await db.execute(
            select(FineConfig).where(FineConfig.violation_type == violation_type)
        )
    ).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="Fine config not found")

    if body.fine_amount is not None:
        config.fine_amount = body.fine_amount
    if body.currency is not None:
        config.currency = body.currency
    if body.is_active is not None:
        config.is_active = body.is_active
    config.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(config)
    return config


# ── Fine record routes ────────────────────────────────────────────────────────


@router.get("", response_model=dict)
async def list_fines(
    worker_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    q = select(Fine)
    if worker_id is not None:
        q = q.where(Fine.worker_id == worker_id)
    if status is not None:
        q = q.where(Fine.status == status)
    if month is not None:
        q = q.where(_effective_month_expr() == month)

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    items = (
        await db.execute(
            q.order_by(Fine.fine_date.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [FineResponse.model_validate(f) for f in items],
    }


@router.get("/monthly-report", response_model=MonthlyReport)
async def monthly_report(
    month: str = Query(..., description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    import time as _time

    t0 = _time.perf_counter()

    # Single query with JOIN — eliminates N+1 per-worker lookups. Joining
    # Violation additionally gives us the violation_type needed for the
    # per-type fine breakdown without a second round trip.
    rows = (
        await db.execute(
            select(
                Fine.worker_id,
                Worker.name.label("worker_name"),
                Worker.employee_id.label("employee_id"),
                Violation.violation_type.label("violation_type"),
                func.sum(Fine.fine_amount).label("amount"),
                func.count(Fine.id).label("count"),
            )
            .join(Violation, Fine.violation_id == Violation.id)
            .outerjoin(Worker, Fine.worker_id == Worker.id)
            .where(_effective_month_expr() == month, Fine.status != "waived")
            .group_by(Fine.worker_id, Worker.name, Worker.employee_id, Violation.violation_type)
        )
    ).all()

    by_worker: dict[int, dict] = {}
    for row in rows:
        entry = by_worker.setdefault(row.worker_id, {
            "worker_name": row.worker_name or "Unknown",
            "employee_id": row.employee_id or "",
            "total": 0.0,
            "count": 0,
            "breakdown": [],
        })
        entry["total"] += float(row.amount)
        entry["count"] += int(row.count)
        entry["breakdown"].append(
            ViolationBreakdown(violation_type=row.violation_type, count=int(row.count), amount=float(row.amount))
        )

    workers_data: list[WorkerFineTotal] = [
        WorkerFineTotal(
            worker_id=worker_id,
            worker_name=entry["worker_name"],
            employee_id=entry["employee_id"],
            total_fines=entry["total"],
            fine_count=entry["count"],
            currency=settings.FINES_CURRENCY,
            breakdown=entry["breakdown"],
        )
        for worker_id, entry in by_worker.items()
    ]

    pending_count = (
        await db.execute(
            select(func.count(Fine.id)).where(
                _effective_month_expr() == month, Fine.status == "pending"
            )
        )
    ).scalar_one()

    # Per-status totals for the month — deliberately unfiltered by status (unlike
    # the worker breakdown above) so "waived" totals are included here.
    status_totals = dict(
        (await db.execute(
            select(Fine.status, func.sum(Fine.fine_amount))
            .where(_effective_month_expr() == month)
            .group_by(Fine.status)
        )).all()
    )

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("monthly_report(%s) completed in %.1fms (%d workers)", month, elapsed_ms, len(workers_data))

    return MonthlyReport(
        month=month,
        total_amount=sum(w.total_fines for w in workers_data),
        workers=workers_data,
        pending_count=pending_count,
        total_pending=status_totals.get("pending") or 0.0,
        total_paid=status_totals.get("paid") or 0.0,
        total_deducted=status_totals.get("deducted") or 0.0,
        total_waived=status_totals.get("waived") or 0.0,
    )


# ── Challan download routes ──────────────────────────────────────────────────


@router.get("/violation/{violation_id}/challan", response_class=FileResponse)
async def challan_by_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_stream_user),
):
    fine = (
        await db.execute(select(Fine).where(Fine.violation_id == violation_id))
    ).scalar_one_or_none()
    if fine is None:
        raise HTTPException(status_code=404, detail="No challan for this violation")
    return await _serve_challan_pdf(fine, db, user)


@router.get("/{fine_id}/challan", response_class=FileResponse)
async def download_challan(
    fine_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_stream_user),
):
    fine = await db.get(Fine, fine_id)
    if fine is None:
        raise HTTPException(status_code=404, detail="Fine not found")
    return await _serve_challan_pdf(fine, db, user)


async def _serve_challan_pdf(fine: Fine, db: AsyncSession, user: dict):
    # Workers only get their own challans — everyone else (admin/safety manager)
    # keeps unrestricted access, matching existing behavior.
    if (user.get("user_metadata") or {}).get("role") == "worker":
        from backend.utils.worker_resolver import resolve_worker_from_user

        requester = await resolve_worker_from_user(user, db)
        if requester is None or fine.worker_id != requester.id:
            raise HTTPException(status_code=403, detail="Not authorized to access this challan")

    path = os.path.join(settings.CHALLANS_DIR, f"{fine.challan_number}.pdf")
    if not os.path.exists(path):
        from backend.database.models import Violation as ViolationModel

        worker = await db.get(Worker, fine.worker_id)
        violation_row = await db.get(ViolationModel, fine.violation_id)
        evt = ViolationEvent(
            camera_id=violation_row.camera_id if violation_row else 0,
            violation_type=violation_row.violation_type if violation_row else "Unknown",
            confidence=violation_row.confidence if violation_row else 0.0,
            frame_path=violation_row.frame_path if violation_row else None,
            worker_id=fine.worker_id,
            violation_id=fine.violation_id,
        )
        loop = asyncio.get_running_loop()
        pdf_bytes = await loop.run_in_executor(
            None, challan_generator.create_challan_pdf, fine, worker, evt
        )
        os.makedirs(settings.CHALLANS_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(pdf_bytes)
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fine.challan_number}.pdf"'},
    )


# ── Status mutation routes ────────────────────────────────────────────────────


@router.put("/{fine_id}/waive", response_model=FineResponse)
async def waive_fine(
    fine_id: int,
    body: WaiveBody = WaiveBody(),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    fine = await db.get(Fine, fine_id)
    if fine is None:
        raise HTTPException(status_code=404, detail="Fine not found")
    if fine.status == "deducted":
        raise HTTPException(status_code=409, detail="Cannot waive a fine that has already been deducted")

    fine.status = "waived"
    if body.reason:
        fine.waive_reason = body.reason
    await db.commit()
    await db.refresh(fine)
    return fine


@router.put("/{fine_id}/deduct", response_model=FineResponse)
async def deduct_fine(
    fine_id: int,
    deduction_month: str = Query(..., description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    fine = await db.get(Fine, fine_id)
    if fine is None:
        raise HTTPException(status_code=404, detail="Fine not found")
    if fine.status == "waived":
        raise HTTPException(status_code=409, detail="Cannot deduct a waived fine")

    fine.status = "deducted"
    fine.deduction_month = deduction_month
    await db.commit()
    await db.refresh(fine)
    return fine


_MONTH_RE = re.compile(r"\d{4}-(0[1-9]|1[0-2])")


@router.patch("/{fine_id}/settle", response_model=FineResponse)
async def settle_fine(
    fine_id: int,
    body: SettleFineRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_supabase_token),
):
    """Unified settlement action: mark a pending fine as paid, deducted, or waived."""
    fine = await db.get(Fine, fine_id)
    if fine is None:
        raise HTTPException(status_code=404, detail="Fine not found")
    if fine.status != "pending":
        raise HTTPException(status_code=409, detail=f"Fine is already settled (status={fine.status})")

    now = datetime.utcnow()
    if body.status == "paid":
        if not body.payment_method:
            raise HTTPException(status_code=400, detail="payment_method is required when status is 'paid'")
        fine.payment_method = body.payment_method
        fine.paid_at = now
    elif body.status == "deducted":
        if not body.deduction_month or not _MONTH_RE.fullmatch(body.deduction_month):
            raise HTTPException(status_code=400, detail="deduction_month (YYYY-MM) is required when status is 'deducted'")
        fine.deduction_month = body.deduction_month
    else:  # waived
        if not body.waive_reason:
            raise HTTPException(status_code=400, detail="waive_reason is required when status is 'waived'")
        fine.waive_reason = body.waive_reason

    fine.status = body.status
    fine.settlement_notes = body.notes
    fine.settled_at = now
    fine.settled_by = user.get("email") or user.get("id") or user.get("sub")

    await db.commit()
    await db.refresh(fine)
    return fine


@router.put("/finalize-month", response_model=FinalizeMonthResponse)
async def finalize_month(
    month: str = Query(..., description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Bulk-transition all pending fines for the month to 'deducted'. Separate
    from PDF/CSV export so generating/re-downloading a report never mutates
    fine status — only this explicit action does."""
    pending_ids = (
        await db.execute(
            select(Fine.id).where(_effective_month_expr() == month, Fine.status == "pending")
        )
    ).scalars().all()

    if not pending_ids:
        raise HTTPException(status_code=404, detail="No pending fines found for the selected period.")

    try:
        await db.execute(
            update(Fine)
            .where(Fine.id.in_(pending_ids))
            .values(status="deducted", deduction_month=month)
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to finalize month.")

    return FinalizeMonthResponse(month=month, updated_count=len(pending_ids))
