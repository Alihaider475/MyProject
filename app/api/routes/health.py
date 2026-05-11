from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi_cache.decorator import cache

from app.api.deps import get_camera_manager
from app.camera.manager import CameraManager

router = APIRouter(tags=["health"])


@router.get("/health")
@cache(expire=30)
async def health(request: Request):
    try:
        manager: CameraManager = get_camera_manager(request)
        active = sum(1 for cid in manager._entries if manager.is_running(cid))
        model_loaded = hasattr(request.app.state, "detector")
    except Exception:
        active = 0
        model_loaded = False

    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "cameras_active": active,
    }


@router.get("/metrics")
@cache(expire=10)
async def metrics(request: Request):
    try:
        manager: CameraManager = get_camera_manager(request)
        counts_by_camera = {
            str(cid): entry.latest_counts
            for cid, entry in manager._entries.items()
            if manager.is_running(cid)
        }
    except Exception:
        counts_by_camera = {}

    return {
        "cameras": counts_by_camera,
    }
