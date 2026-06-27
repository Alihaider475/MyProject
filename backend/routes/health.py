from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from fastapi_cache.decorator import cache

from backend.core.dependencies import get_camera_manager
from backend.camera.manager import CameraManager

router = APIRouter(tags=["health"])


@router.get("/health")
@cache(expire=30)
async def health(request: Request):
    try:
        manager: CameraManager = get_camera_manager(request)
        active = sum(1 for cid in manager._entries if manager.is_running(cid))
        model_loaded = getattr(request.app.state, "model_ready", False)
    except Exception:
        active = 0
        model_loaded = False

    return {
        "status": "ok",
        "model_loaded": model_loaded,
        "cameras_active": active,
    }


@router.get("/ready")
async def readiness(request: Request):
    """Public readiness probe. Returns 503 while the YOLO model is loading."""
    status = getattr(request.app.state, "model_status", "initializing")
    error = getattr(request.app.state, "model_error", None)
    body: dict = {"status": status}
    if error:
        body["error"] = error
    http_status = 200 if status == "ready" else (503 if status != "error" else 503)
    return JSONResponse(content=body, status_code=http_status)


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
