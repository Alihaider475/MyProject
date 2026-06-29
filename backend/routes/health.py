from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from fastapi_cache.decorator import cache

from backend.core.config import settings
from backend.core.dependencies import get_camera_manager
from backend.camera.manager import CameraManager

router = APIRouter(tags=["health"])


def readiness_payload(request: Request) -> dict:
    status = getattr(request.app.state, "model_status", "backend_started")
    ready = bool(getattr(request.app.state, "model_ready", False))
    stages = dict(getattr(request.app.state, "ready_stages", {}))
    timings = dict(getattr(request.app.state, "startup_timings_ms", {}))
    body: dict = {
        "status": "ready" if ready else status,
        "ready": ready,
        "current_stage": "ready" if ready else status,
        "stages": stages,
        "timings_ms": timings,
        "message": "AI model ready" if ready else "AI model loading, please wait...",
    }
    error = getattr(request.app.state, "model_error", None)
    if error:
        body["error"] = error
        body["message"] = "AI model failed to load. Check backend logs."
    return body


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
        # Not a secret — lets the frontend detect production and steer users
        # away from numeric Server Webcam sources (which can never work on a
        # headless deployment server) toward Browser Webcam / RTSP instead.
        "app_env": settings.APP_ENV,
    }


@router.get("/ready")
async def readiness(request: Request):
    """Public readiness probe with staged model/database initialization status."""
    body = readiness_payload(request)
    http_status = 200 if body["ready"] else 503
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
