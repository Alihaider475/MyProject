from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.dependencies import get_camera_manager, get_session
from backend.auth.supabase_auth import verify_supabase_token
from backend.camera.manager import CameraManager
from backend.database.models import Camera
from backend.database.connection import get_db
from backend.core.logging import mask_sensitive_text
from backend.routes.health import readiness_payload
from backend.utils.cache import invalidate_backend_cache
from backend.schemas.camera import (
    CameraCreate,
    CameraDuplicateRequest,
    CameraResponse,
    CameraUpdate,
    mask_rtsp_credentials,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraResponse])
async def list_cameras(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    result = await db.execute(select(Camera))
    cameras = result.scalars().all()
    manager: CameraManager = get_camera_manager(request)
    return [
        CameraResponse(
            **{c: getattr(cam, c) for c in CameraResponse.model_fields if c != "is_running"},
            is_running=manager.is_running(cam.id),
        )
        for cam in cameras
    ]


@router.post("", response_model=CameraResponse, status_code=201)
async def create_camera(
    body: CameraCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    # Never echo the raw URI (it may carry an RTSP password / verification code).
    safe_uri = mask_rtsp_credentials(body.source_uri)

    existing = await db.execute(
        select(Camera).where(
            Camera.source_type == body.source_type,
            Camera.source_uri == body.source_uri,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"A camera with source '{body.source_type}:{safe_uri}' already exists. "
                "Delete the existing entry first if you want to re-add it."
            ),
        )

    # Duplicate name (case-insensitive) — a separate 409 so the user gets a clear
    # message instead of a DB IntegrityError 500 if the table has a unique name index.
    dup_name = await db.execute(
        select(Camera.id).where(func.lower(Camera.name) == body.name.strip().lower())
    )
    if dup_name.first() is not None:
        raise HTTPException(
            status_code=409,
            detail=f"A camera named '{body.name}' already exists. Choose a different name.",
        )

    cam = Camera(
        name=body.name,
        source_type=body.source_type,
        source_uri=body.source_uri,
        detection_confidence=body.detection_confidence,
    )
    db.add(cam)
    try:
        await db.commit()
        await db.refresh(cam)
    except IntegrityError:
        # A uniqueness/constraint clash that slipped past the checks above
        # (e.g. a concurrent insert, or a constraint not mirrored in the model).
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A camera with these details already exists.",
        )
    except SQLAlchemyError as exc:
        await db.rollback()
        # Log with the password masked; surface a clean message, not a traceback.
        logger.exception("Failed to create camera %r (%s)", body.name, safe_uri)
        raise HTTPException(
            status_code=400,
            detail=f"Could not save camera: {type(exc).__name__}. Check the camera details and try again.",
        )
    return CameraResponse.model_validate(cam)


@router.post("/duplicate", response_model=list[CameraResponse], status_code=201)
async def duplicate_camera(
    body: CameraDuplicateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    # Intentionally bypasses create_camera's (source_type, source_uri) uniqueness
    # check — duplicating tiles from one RTSP URL is the point of this endpoint.
    new_cams = [
        Camera(
            name=f"{body.name_prefix} {i}",
            source_type=body.source_type,
            source_uri=body.source_uri,
            detection_confidence=body.detection_confidence,
        )
        for i in range(1, body.copies + 1)
    ]
    db.add_all(new_cams)
    await db.commit()
    for cam in new_cams:
        await db.refresh(cam)

    manager: CameraManager = get_camera_manager(request)
    return [
        CameraResponse(
            **{c: getattr(cam, c) for c in CameraResponse.model_fields if c != "is_running"},
            is_running=manager.is_running(cam.id),
        )
        for cam in new_cams
    ]


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(
    camera_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager: CameraManager = get_camera_manager(request)
    return CameraResponse(
        **{c: getattr(cam, c) for c in CameraResponse.model_fields if c != "is_running"},
        is_running=manager.is_running(cam.id),
    )


@router.get("/{camera_id}/diagnostics")
async def camera_diagnostics(
    camera_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Live detection-funnel breakdown for one camera (frames in → detections →
    ROI drops → violations logged). Used to diagnose zero-detection issues."""
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager: CameraManager = get_camera_manager(request)
    return manager.get_diagnostics(camera_id)


@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: int,
    body: CameraUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager: CameraManager = get_camera_manager(request)
    if body.name is not None:
        cam.name = body.name
    if body.source_uri is not None and body.source_uri != cam.source_uri:
        if cam.source_type == "webcam" and not body.source_uri.isdigit():
            raise HTTPException(
                status_code=422,
                detail=f"Webcam URI must be a numeric index (e.g. '0'), got {body.source_uri!r}",
            )
        if manager.is_running(camera_id):
            await manager.stop_camera(camera_id)
            cam.is_active = False
        cam.source_uri = body.source_uri
    if body.detection_confidence is not None:
        cam.detection_confidence = body.detection_confidence
    if 'roi_polygon' in body.model_fields_set:
        cam.roi_polygon = json.dumps(body.roi_polygon) if body.roi_polygon is not None else None
    await db.commit()
    await db.refresh(cam)
    if body.detection_confidence is not None:
        manager.set_confidence(camera_id, body.detection_confidence)
    if 'roi_polygon' in body.model_fields_set:
        manager.set_roi(camera_id, body.roi_polygon)
    return CameraResponse(
        **{c: getattr(cam, c) for c in CameraResponse.model_fields if c != "is_running"},
        is_running=manager.is_running(cam.id),
    )


@router.delete("/{camera_id}", status_code=204)
async def delete_camera(
    camera_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")
    manager: CameraManager = get_camera_manager(request)
    await manager.stop_camera(camera_id)
    await db.delete(cam)
    await db.commit()


@router.post("/{camera_id}/start")
async def start_camera(
    camera_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    if not getattr(request.app.state, "model_ready", False):
        payload = readiness_payload(request)
        raise HTTPException(
            status_code=503,
            detail={
                "code": "AI_NOT_READY",
                "message": "AI model loading, please wait before starting cameras.",
                "readiness": payload,
            },
        )

    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Numeric webcam sources open a camera attached to the BACKEND server, not
    # the user's laptop/browser. In production the backend runs in a Docker
    # container on a server with no physical webcam, so 0/1 can never work
    # there — only fail with a confusing "Cannot open webcam source" error.
    # Block it early with a clear, actionable message instead.
    if settings.APP_ENV == "prod" and cam.source_type == "webcam":
        raise HTTPException(
            status_code=400,
            detail="Server webcam sources 0/1 are not available on EC2. Use Browser Webcam or RTSP/IP camera URL.",
        )

    manager: CameraManager = get_camera_manager(request)
    try:
        roi = json.loads(cam.roi_polygon) if cam.roi_polygon else None
        ok = await manager.start_camera(
            camera_id, cam.source_type, cam.source_uri,
            confidence=cam.detection_confidence,
            roi=roi,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid camera config: {mask_sensitive_text(str(exc))}")
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Camera start error: {type(exc).__name__}: {mask_sensitive_text(str(exc))}",
        )
    if not ok:
        safe_uri = mask_rtsp_credentials(cam.source_uri)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot open {cam.source_type} source {safe_uri!r}. "
                "Check: (1) URI is correct, (2) device not in use by another app, "
                "(3) on Windows, app has camera permission."
            ),
        )

    cam.is_active = True
    await db.commit()
    await invalidate_backend_cache()
    return {"status": "started", "camera_id": camera_id}


@router.post("/{camera_id}/stop")
async def stop_camera(
    camera_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    manager: CameraManager = get_camera_manager(request)
    await manager.stop_camera(camera_id)
    cam.is_active = False
    await db.commit()
    await invalidate_backend_cache()
    return {"status": "stopped", "camera_id": camera_id}
