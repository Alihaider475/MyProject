from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import get_stream_user, verify_supabase_token
from backend.core.config import settings
from backend.core.violation_checker import ViolationEvent
from backend.db.models import Fine, FineConfig, Worker
from backend.db.session import get_db
from backend.reports import challan_generator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fines", tags=["fines"])


# ── Schemas ──────────────────────────────────────────────────────────────────


class FineConfigResponse(BaseModel):
    id: int
    violation_type: str
    fine_amount: float
    currency: str
    is_active: bool
    updated_at: datetime

    model_config = {"from_attributes": True}


class FineConfigUpdate(BaseModel):
    fine_amount: Optional[float] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None


class FineResponse(BaseModel):
    id: int
    worker_id: int
    violation_id: int
    fine_amount: float
    currency: str
    fine_date: datetime
    challan_number: str
    status: str
    deduction_month: Optional[str]
    waive_reason: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WaiveBody(BaseModel):
    reason: Optional[str] = None


class WorkerFineTotal(BaseModel):
    worker_id: int
    worker_name: str
    employee_id: str
    total_fines: float
    fine_count: int
    currency: str


class MonthlyReport(BaseModel):
    month: str
    total_amount: float
    workers: list[WorkerFineTotal]


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
        q = q.where(Fine.deduction_month == month)

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

    # Single query with JOIN — eliminates N+1 per-worker lookups
    rows = (
        await db.execute(
            select(
                Fine.worker_id,
                Worker.name.label("worker_name"),
                Worker.employee_id.label("employee_id"),
                func.sum(Fine.fine_amount).label("total"),
                func.count(Fine.id).label("count"),
            )
            .outerjoin(Worker, Fine.worker_id == Worker.id)
            .where(Fine.deduction_month == month, Fine.status != "waived")
            .group_by(Fine.worker_id, Worker.name, Worker.employee_id)
        )
    ).all()

    workers_data: list[WorkerFineTotal] = [
        WorkerFineTotal(
            worker_id=row.worker_id,
            worker_name=row.worker_name or "Unknown",
            employee_id=row.employee_id or "",
            total_fines=float(row.total),
            fine_count=int(row.count),
            currency=settings.FINES_CURRENCY,
        )
        for row in rows
    ]

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("monthly_report(%s) completed in %.1fms (%d workers)", month, elapsed_ms, len(workers_data))

    return MonthlyReport(
        month=month,
        total_amount=sum(w.total_fines for w in workers_data),
        workers=workers_data,
    )


# ── Challan download routes ──────────────────────────────────────────────────


@router.get("/violation/{violation_id}/challan")
async def challan_by_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_stream_user),
):
    fine = (
        await db.execute(select(Fine).where(Fine.violation_id == violation_id))
    ).scalar_one_or_none()
    if fine is None:
        raise HTTPException(status_code=404, detail="No challan for this violation")
    return await _serve_challan_pdf(fine, db)


@router.get("/{fine_id}/challan")
async def download_challan(
    fine_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(get_stream_user),
):
    fine = await db.get(Fine, fine_id)
    if fine is None:
        raise HTTPException(status_code=404, detail="Fine not found")
    return await _serve_challan_pdf(fine, db)


async def _serve_challan_pdf(fine: Fine, db: AsyncSession) -> FileResponse:
    path = os.path.join(settings.CHALLANS_DIR, f"{fine.challan_number}.pdf")
    if not os.path.exists(path):
        from backend.db.models import Violation as ViolationModel

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
