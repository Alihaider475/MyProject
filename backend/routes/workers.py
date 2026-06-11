from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.database.models import Violation, Worker
from backend.database.connection import get_db
from backend.schemas.worker import WorkerCreate, WorkerUpdate, WorkerResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workers", tags=["workers"])


def _worker_to_response(worker: Worker, violation_count: int, total_fines: float) -> WorkerResponse:
    return WorkerResponse(
        id=worker.id,
        employee_id=worker.employee_id,
        name=worker.name,
        department=worker.department,
        phone_number=worker.phone_number,
        email=worker.email,
        has_face_enrolled=worker.face_encoding is not None,
        created_at=worker.created_at,
        violation_count=violation_count,
        total_fines=total_fines,
    )


@router.post("", response_model=WorkerResponse, status_code=201)
async def create_worker(
    body: WorkerCreate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    existing = (await db.execute(
        select(Worker).where(Worker.employee_id == body.employee_id)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Employee ID already exists")

    worker = Worker(
        employee_id=body.employee_id,
        name=body.name,
        department=body.department,
        phone_number=body.phone_number,
        email=body.email,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return _worker_to_response(worker, 0, 0.0)


@router.get("", response_model=list[WorkerResponse])
async def list_workers(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    workers = (await db.execute(select(Worker).order_by(Worker.name))).scalars().all()

    stats_result = await db.execute(
        select(
            Violation.worker_id,
            func.count(Violation.id).label("violation_count"),
            func.coalesce(func.sum(Violation.fine_amount), 0.0).label("total_fines"),
        )
        .where(Violation.worker_id.isnot(None))
        .group_by(Violation.worker_id)
    )
    stats_map = {
        row.worker_id: (int(row.violation_count), float(row.total_fines))
        for row in stats_result
    }

    return [_worker_to_response(w, *stats_map.get(w.id, (0, 0.0))) for w in workers]


@router.get("/{worker_id}", response_model=WorkerResponse)
async def get_worker(
    worker_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    row = (await db.execute(
        select(
            func.count(Violation.id).label("violation_count"),
            func.coalesce(func.sum(Violation.fine_amount), 0.0).label("total_fines"),
        ).where(Violation.worker_id == worker_id)
    )).one()

    return _worker_to_response(worker, int(row.violation_count or 0), float(row.total_fines or 0.0))


@router.put("/{worker_id}", response_model=WorkerResponse)
async def update_worker(
    worker_id: int,
    body: WorkerUpdate,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    if body.name is not None:
        worker.name = body.name
    if body.department is not None:
        worker.department = body.department
    if body.phone_number is not None:
        worker.phone_number = body.phone_number
    if body.email is not None:
        worker.email = body.email

    await db.commit()
    await db.refresh(worker)

    row = (await db.execute(
        select(
            func.count(Violation.id).label("violation_count"),
            func.coalesce(func.sum(Violation.fine_amount), 0.0).label("total_fines"),
        ).where(Violation.worker_id == worker_id)
    )).one()

    return _worker_to_response(worker, int(row.violation_count or 0), float(row.total_fines or 0.0))


@router.post("/{worker_id}/enroll-face")
async def enroll_face(
    worker_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    contents = await file.read()
    img_array = np.frombuffer(contents, np.uint8)
    image = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="Could not decode image file")

    face_recognizer = request.app.state.camera_manager._face_recognizer
    try:
        import asyncio
        loop = asyncio.get_running_loop()
        encoding = await loop.run_in_executor(None, face_recognizer.encode_face, image)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Face encoding failed: {exc}")

    worker.face_encoding = json.dumps(encoding)
    await db.commit()

    # Update in-memory store and reload all known faces from DB
    face_recognizer.register_worker(worker_id, encoding)
    await request.app.state.camera_manager.reload_known_faces()

    logger.info("Worker %d (%s) face enrolled", worker.id, worker.employee_id)
    return {"message": "Face enrolled successfully", "worker_id": worker_id}


@router.get("/{worker_id}/violations")
async def worker_violations(
    worker_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    if await db.get(Worker, worker_id) is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    q = (
        select(Violation)
        .where(Violation.worker_id == worker_id)
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


@router.get("/{worker_id}/fines")
async def worker_fines(
    worker_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    if await db.get(Worker, worker_id) is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    items = (await db.execute(
        select(Violation)
        .where(Violation.worker_id == worker_id, Violation.fine_amount.isnot(None))
        .order_by(Violation.timestamp.desc())
    )).scalars().all()

    total_fines = sum(v.fine_amount for v in items if v.fine_amount)

    return {
        "worker_id": worker_id,
        "total_fines": total_fines,
        "fine_count": len(items),
        "fines": [
            {
                "id": v.id,
                "violation_type": v.violation_type,
                "fine_amount": v.fine_amount,
                "timestamp": v.timestamp,
                "camera_id": v.camera_id,
            }
            for v in items
        ],
    }
