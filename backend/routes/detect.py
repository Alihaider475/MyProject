from __future__ import annotations

import asyncio
import base64
import json
import os
import tempfile
import uuid
from datetime import datetime

import cv2
import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi_cache.decorator import cache
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.alerts.dispatch_helpers import dispatch_alerts_background
from backend.auth.supabase_auth import verify_supabase_token
from backend.routes.health import readiness_payload
from backend.core.config import settings
from backend.detection.detector import PPEDetector
from backend.detection.frame_annotator import annotate_frame
from backend.detection.frame_violations import build_violations, compress
from backend.storage import supabase_storage
from backend.detection.video_jobs import run_video_job
from backend.detection.violation_checker import ViolationEvent
from backend.core.logging import get_logger
from backend.database.models import Camera, Violation, VideoJob
from backend.database.connection import get_db

logger = get_logger(__name__)
router = APIRouter(prefix="/detect", tags=["detect"])

MAX_IMAGE_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_VIDEO_BYTES = 200 * 1024 * 1024  # 200 MB


async def _get_or_create_upload_camera(db: AsyncSession) -> int:
    """Return the id of the 'Image Upload' camera, creating it if needed."""
    result = await db.execute(
        select(Camera.id).where(Camera.source_uri == "upload").limit(1)
    )
    camera_id = result.scalar_one_or_none()
    if camera_id is None:
        cam = Camera(name="Image Upload", source_type="file", source_uri="upload")
        db.add(cam)
        await db.commit()
        await db.refresh(cam)
        camera_id = cam.id
    return camera_id


async def _auto_identify_uploaded(violation_ids, frame, person_boxes, face_recognizer) -> None:
    """Background task: auto-identify the worker for freshly uploaded violations.

    Resolves the worker ONCE from the already-decoded frame and the person boxes YOLO
    already produced during the upload request — no disk reload and no redundant YOLO
    pass — then assigns that worker (and creates fines) for every violation saved from
    the image. This makes upload identification feel instant instead of re-scanning.
    """
    from backend.detection.auto_identifier import assign_worker_to_violations
    from backend.utils.cache import invalidate_backend_cache

    try:
        if not person_boxes:
            return
        loop = asyncio.get_running_loop()
        worker_id = await loop.run_in_executor(
            None, face_recognizer.identify_unique_worker, frame, person_boxes
        )
        if worker_id is None:
            return
        assigned = await assign_worker_to_violations(list(violation_ids), worker_id)
        if assigned:
            await invalidate_backend_cache()
    except Exception as exc:
        logger.debug("Upload auto-identify failed: %s", exc)


def _require_model_ready(request: Request) -> None:
    if not getattr(request.app.state, "model_ready", False):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_NOT_READY",
                "message": "AI model loading, please wait before running detection.",
                "readiness": readiness_payload(request),
            },
        )


@router.get("/classes")
@cache(expire=3600)
async def list_classes(request: Request, _user: dict = Depends(verify_supabase_token)):
    """All classes the loaded YOLO model can detect."""
    _require_model_ready(request)
    detector: PPEDetector = request.app.state.detector
    return {
        "model_path": detector.model.ckpt_path if hasattr(detector.model, "ckpt_path") else None,
        "confidence_threshold": detector.confidence,
        "classes": [
            {"class_id": cid, "class_name": name}
            for cid, name in sorted(detector.class_names.items())
        ],
    }


@router.post("/image")
async def detect_image(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Run detection on an uploaded image and return detections + annotated preview."""
    _require_model_ready(request)
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image, got {file.content_type!r}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_IMAGE_BYTES // 1024 // 1024} MB)")

    loop = asyncio.get_running_loop()
    nparr = np.frombuffer(raw, np.uint8)
    frame = await loop.run_in_executor(None, cv2.imdecode, nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    detector: PPEDetector = request.app.state.detector
    detections = await loop.run_in_executor(
        None, lambda: detector.detect(frame, imgsz=settings.IMAGE_YOLO_IMGSZ)
    )

    class_counts: dict[str, int] = {}
    for d in detections:
        class_counts[d.class_name] = class_counts.get(d.class_name, 0) + 1

    hardhat = class_counts.get("Hardhat", 0)
    vest = class_counts.get("Safety Vest", 0)
    person = class_counts.get("Person", 0)

    annotated = await loop.run_in_executor(
        None, annotate_frame, frame, detections, hardhat, vest, person, False
    )
    _, jpeg = await loop.run_in_executor(
        None, lambda: cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    )
    img_b64 = base64.b64encode(jpeg.tobytes()).decode("ascii")

    # Classes that exist in the model but were NOT detected in this image
    all_classes = set(detector.class_names.values())
    detected_classes = set(class_counts.keys())
    missing_classes = sorted(all_classes - detected_classes)

    # Per-PPE-item compliance breakdown (same shared logic as the live path)
    violations, violation_total = build_violations(
        detections, frame.shape[1], frame.shape[0]
    )
    person_count = class_counts.get("Person", 0)

    logger.info(
        "Image detect: %d detections (%s) | %d violations",
        len(detections),
        ", ".join(f"{k}={v}" for k, v in class_counts.items()) or "none",
        violation_total,
    )

    saved_violation_ids: list[int] = []
    if violation_total > 0:
        camera_id = await _get_or_create_upload_camera(db)

        # Upload annotated frame to Supabase Storage
        safe_name = (file.filename or "upload").replace("/", "_").replace("\\", "_")
        frame_filename = f"{uuid.uuid4().hex}_{safe_name}"
        if not frame_filename.lower().endswith(".jpg"):
            frame_filename += ".jpg"
        relative_frame_path = f"image_uploads/{frame_filename}"
        compressed = await loop.run_in_executor(None, compress, jpeg.tobytes())
        await supabase_storage.upload(settings.SUPABASE_VIOLATION_BUCKET, relative_frame_path, compressed)

        for row in violations:
            if row["status"] == "violation":
                v = Violation(
                    camera_id=camera_id,
                    violation_type=row["violation_class"],
                    confidence=row["max_confidence"] or 0.0,
                    frame_path=relative_frame_path,
                )
                db.add(v)

        await db.commit()

        # Collect IDs after commit
        result_ids = await db.execute(
            select(Violation.id)
            .where(Violation.camera_id == camera_id)
            .where(Violation.frame_path == relative_frame_path)
        )
        saved_violation_ids = list(result_ids.scalars().all())

        # Auto-identify the worker for the saved violations in the background, reusing
        # the frame and person boxes already computed above — so the uploaded-image path
        # assigns the worker + fine automatically (no manual Auto-Identify button) and
        # fast. Fire-and-forget so the annotated preview returns immediately.
        if saved_violation_ids:
            cam_mgr = getattr(request.app.state, "camera_manager", None)
            face_recognizer = getattr(cam_mgr, "_face_recognizer", None)
            if face_recognizer is not None:
                person_boxes = [
                    (d.x1, d.y1, d.x2, d.y2) for d in detections if d.class_name == "Person"
                ]
                asyncio.create_task(
                    _auto_identify_uploaded(
                        saved_violation_ids, frame, person_boxes, face_recognizer
                    )
                )

        # Fire ONE summary alert for this upload (email/webhook/MQTT), covering
        # every detected violation type with its count — not one alert per row.
        violation_counts = {
            row["violation_class"]: row["violation_count"]
            for row in violations
            if row["status"] == "violation" and row["violation_count"] > 0
        }
        if saved_violation_ids and violation_counts:
            primary = max(
                (r for r in violations if r["status"] == "violation"),
                key=lambda r: (r["violation_count"], r["max_confidence"] or 0.0),
            )
            event = ViolationEvent(
                camera_id=camera_id,
                violation_type=primary["violation_class"],
                confidence=primary["max_confidence"] or 0.0,
                frame_path=relative_frame_path,
                violation_id=saved_violation_ids[0],
                violation_counts=violation_counts,
            )
            dispatch_alerts_background(
                event, name=f"image-upload-alerts-{saved_violation_ids[0]}"
            )
            logger.info(
                "Image upload alert scheduled: violation_id=%s types=%s",
                saved_violation_ids[0], violation_counts,
            )

    return {
        "filename": file.filename,
        "image_size": {"width": frame.shape[1], "height": frame.shape[0]},
        "total_detections": len(detections),
        "class_counts": class_counts,
        "missing_classes": missing_classes,
        "person_count": person_count,
        "violation_total": violation_total,
        "violations": violations,
        "detections": [
            {
                "class_id": d.class_id,
                "class_name": d.class_name,
                "confidence": round(float(d.confidence), 3),
                "bbox": [d.x1, d.y1, d.x2, d.y2],
            }
            for d in sorted(detections, key=lambda x: -x.confidence)
        ],
        "annotated_image_base64": img_b64,
        "saved_violation_ids": saved_violation_ids,
    }


@router.post("/video", status_code=202)
async def detect_video(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Accept an uploaded video file and process it in the background.

    Returns immediately with a job id instead of blocking on the full analysis —
    poll ``GET /detect/video/{job_id}`` for status and, once done, the same
    result shape this endpoint used to return synchronously.
    """
    _require_model_ready(request)
    allowed_types = {"video/mp4", "video/avi", "video/x-msvideo", "video/quicktime",
                     "video/x-matroska", "video/webm", "video/mpeg"}
    if not file.content_type or file.content_type.split(";")[0].strip() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Expected a video file (mp4/avi/mov/mkv/webm), got {file.content_type!r}"
        )

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Video too large (>{MAX_VIDEO_BYTES // 1024 // 1024} MB)"
        )

    # Write to a temp file so OpenCV can open it. Cleaned up by the background
    # job once processing finishes (success or failure), not here.
    suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    job = VideoJob(filename=file.filename or "video", status="queued")
    db.add(job)
    await db.commit()
    await db.refresh(job)

    detector: PPEDetector = request.app.state.detector
    background_tasks.add_task(run_video_job, job.id, tmp_path, file.filename, detector)

    return {"job_id": job.id, "status": job.status, "filename": job.filename}


@router.get("/video/{job_id}")
async def get_video_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Poll the status of a background video-analysis job."""
    result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")

    status = job.status
    error_message = job.error_message

    # A job stuck in "queued"/"processing" past the stale window almost certainly
    # means the background task never ran or died mid-job (BackgroundTasks don't
    # survive a restart, and a "queued" job that never reached "processing" would
    # otherwise have NO timeout at all) — report it as failed instead of leaving
    # the frontend polling forever.
    if status in ("queued", "processing"):
        age = (datetime.utcnow() - job.updated_at).total_seconds()
        if age > settings.VIDEO_JOB_STALE_SECONDS:
            status = "error"
            error_message = "Processing did not complete (server may have restarted). Please re-upload."

    response = {
        "job_id": job.id,
        "status": status,
        "filename": job.filename,
        "error_message": error_message,
    }
    if status == "done" and job.result_json:
        response["result"] = json.loads(job.result_json)
    return response
