from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.models import Fine, SafetyActionEffectivenessLog, SafetyActionTask, Violation, Worker, WorkerInviteLog
from backend.database.connection import get_db
from backend.schemas.worker import WorkerCreate, WorkerUpdate, WorkerResponse
from backend.storage import supabase_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workers", tags=["workers"])

MAX_FACE_PHOTO_BYTES = 10 * 1024 * 1024  # 10 MB — same cap as /detect/image


def _worker_to_response(worker: Worker, violation_count: int, total_fines: float) -> WorkerResponse:
    return WorkerResponse(
        id=worker.id,
        employee_id=worker.employee_id,
        name=worker.name,
        department=worker.department,
        phone_number=worker.phone_number,
        email=worker.email,
        base_salary=worker.base_salary,
        has_face_enrolled=worker.face_encoding is not None,
        has_face_photo=bool(worker.face_image_path),
        is_active=worker.is_active,
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
        base_salary=body.base_salary,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return _worker_to_response(worker, 0, 0.0)


@router.get("", response_model=list[WorkerResponse])
async def list_workers(
    active_only: bool = Query(False, description="If true, exclude deactivated workers"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    q = select(Worker).order_by(Worker.name)
    if active_only:
        q = q.where(Worker.is_active.is_(True))
    workers = (await db.execute(q)).scalars().all()

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
    if body.base_salary is not None:
        worker.base_salary = body.base_salary
    if body.is_active is not None:
        worker.is_active = body.is_active

    await db.commit()
    await db.refresh(worker)

    row = (await db.execute(
        select(
            func.count(Violation.id).label("violation_count"),
            func.coalesce(func.sum(Violation.fine_amount), 0.0).label("total_fines"),
        ).where(Violation.worker_id == worker_id)
    )).one()

    return _worker_to_response(worker, int(row.violation_count or 0), float(row.total_fines or 0.0))


@router.delete("/{worker_id}")
async def delete_worker(
    worker_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Hard delete: permanently removes the worker row and all dependent records."""
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    # Nullify violation links (violations are preserved but no longer tied to a worker)
    violations = (await db.execute(select(Violation).where(Violation.worker_id == worker_id))).scalars().all()
    for v in violations:
        v.worker_id = None

    # Delete effectiveness logs attached to safety tasks for this worker
    tasks = (await db.execute(select(SafetyActionTask).where(SafetyActionTask.worker_id == worker_id))).scalars().all()
    for task in tasks:
        eff = (await db.execute(select(SafetyActionEffectivenessLog).where(SafetyActionEffectivenessLog.task_id == task.id))).scalar_one_or_none()
        if eff:
            await db.delete(eff)

    # Delete safety action tasks
    for task in tasks:
        await db.delete(task)

    # Delete fines
    fines = (await db.execute(select(Fine).where(Fine.worker_id == worker_id))).scalars().all()
    for fine in fines:
        await db.delete(fine)

    # Delete invite log (also covered by ondelete=CASCADE but explicit for clarity)
    invite_log = (await db.execute(select(WorkerInviteLog).where(WorkerInviteLog.worker_id == worker_id))).scalar_one_or_none()
    if invite_log:
        await db.delete(invite_log)

    await db.flush()
    await db.delete(worker)
    await db.commit()

    logger.info("Worker %d (%s) permanently deleted", worker_id, worker.employee_id)
    return {"deleted": True, "worker_id": worker_id}


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

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image, got {file.content_type!r}")

    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(contents) > MAX_FACE_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_FACE_PHOTO_BYTES // 1024 // 1024} MB)")

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
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Face encoding failed: {exc}")

    # Persist the enrolled photo to the private worker-photos bucket so it can be
    # viewed later via the authenticated /workers/{id}/face-photo endpoint (signed
    # URL, never a public link — these are biometric photos). Always stored as
    # .jpg from the already-decoded, already-validated image — re-enrolling
    # overwrites the same object (upsert).
    ok, jpeg_bytes = cv2.imencode(".jpg", image)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode face photo")
    photo_path = f"{worker_id}.jpg"
    await supabase_storage.upload(settings.SUPABASE_WORKER_PHOTOS_BUCKET, photo_path, jpeg_bytes.tobytes())

    worker.face_encoding = json.dumps(encoding)
    worker.face_image_path = photo_path
    await db.commit()

    # Update in-memory store and reload all known faces from DB
    face_recognizer.register_worker(worker_id, encoding)
    await request.app.state.camera_manager.reload_known_faces()

    logger.info("Worker %d (%s) face enrolled", worker.id, worker.employee_id)
    return {"message": "Face enrolled successfully", "worker_id": worker_id}


@router.get("/{worker_id}/face-photo")
async def get_worker_face_photo(
    worker_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    worker = await db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")
    if not worker.face_image_path:
        raise HTTPException(status_code=404, detail="No photo on file for this worker")

    signed = await supabase_storage.signed_url(settings.SUPABASE_WORKER_PHOTOS_BUCKET, worker.face_image_path)
    photo_bytes = await supabase_storage.fetch_bytes(signed) if signed else None
    if photo_bytes is None:
        raise HTTPException(status_code=404, detail="No photo on file for this worker")

    return Response(content=photo_bytes, media_type="image/jpeg")


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
