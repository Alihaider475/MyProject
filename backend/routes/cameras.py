from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.dependencies import get_camera_manager, get_session
from backend.auth.supabase_auth import verify_supabase_token
from backend.camera.manager import CameraManager
from backend.database.models import Camera
from backend.database.connection import get_db
from backend.schemas.camera import CameraCreate, CameraResponse, CameraUpdate

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
                f"A camera with source '{body.source_type}:{body.source_uri}' already exists. "
                "Delete the existing entry first if you want to re-add it."
            ),
        )

    cam = Camera(
        name=body.name,
        source_type=body.source_type,
        source_uri=body.source_uri,
        detection_confidence=body.detection_confidence,
    )
    db.add(cam)
    await db.commit()
    await db.refresh(cam)
    return CameraResponse.model_validate(cam)


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
    cam = await db.get(Camera, camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail="Camera not found")

    manager: CameraManager = get_camera_manager(request)
    try:
        roi = json.loads(cam.roi_polygon) if cam.roi_polygon else None
        ok = await manager.start_camera(
            camera_id, cam.source_type, cam.source_uri,
            confidence=cam.detection_confidence,
            roi=roi,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid camera config: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Camera start error: {type(exc).__name__}: {exc}")
    if not ok:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot open {cam.source_type} source {cam.source_uri!r}. "
                "Check: (1) URI is correct, (2) device not in use by another app, "
                "(3) on Windows, app has camera permission."
            ),
        )

    cam.is_active = True
    await db.commit()
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
    return {"status": "stopped", "camera_id": camera_id}
