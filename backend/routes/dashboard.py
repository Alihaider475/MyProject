from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.core.dependencies import get_camera_manager
from backend.auth.supabase_auth import verify_supabase_token
from backend.camera.manager import CameraManager
from backend.database.models import Camera, Violation
from backend.database.connection import get_db
from backend.schemas.dashboard import RecentViolation, DashboardSummaryResponse
from backend.utils.cache import build_manual_cache_key, get_manual_cache, set_manual_cache


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# ─── Helpers ──────────────────────────────────────────────────────────────────


from backend.utils.helpers import frame_url as _frame_url


async def _fetch_health(request: Request) -> dict[str, Any]:
    """Fetch camera-manager health stats — no DB required."""
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


async def _fetch_violation_counts(db: AsyncSession) -> dict[str, int]:
    """Return total violations and violations-today in ONE query.

    Uses conditional aggregation (CASE) to compute both counts in a single
    table scan — faster than two separate COUNT queries.
    """
    from sqlalchemy import case

    now_naive = datetime.now(UTC).replace(tzinfo=None)
    start_of_today = now_naive.replace(hour=0, minute=0, second=0, microsecond=0)

    q = select(
        func.count().label("total"),
        func.count(case((Violation.timestamp >= start_of_today, 1))).label("today"),
    ).select_from(Violation)

    row = (await db.execute(q)).one()
    return {"total": row.total, "today": row.today}


async def _fetch_recent_violations(db: AsyncSession, limit: int = 10) -> list[RecentViolation]:
    """Fetch the most recent violations."""
    q = (
        select(Violation)
        .options(selectinload(Violation.worker))
        .order_by(Violation.timestamp.desc())
        .limit(limit)
    )
    rows = (await db.execute(q)).scalars().all()
    return [
        RecentViolation(
            id=v.id,
            camera_id=v.camera_id,
            violation_type=v.violation_type,
            confidence=v.confidence,
            timestamp=v.timestamp.isoformat(),
            frame_url=_frame_url(v.frame_path),
            is_resolved=v.resolved_at is not None,
            is_false_positive=bool(v.is_false_positive),
        )
        for v in rows
    ]


async def _fetch_cameras(request: Request, db: AsyncSession) -> list[dict[str, Any]]:
    """Fetch all cameras with their live running state."""
    from backend.schemas.camera import CameraResponse

    result = await db.execute(select(Camera))
    cameras = result.scalars().all()
    manager: CameraManager = get_camera_manager(request)
    return [
        {
            **{
                col: getattr(cam, col)
                for col in CameraResponse.model_fields
                if col not in ("is_running",)
            },
            "is_running": manager.is_running(cam.id),
        }
        for cam in cameras
    ]


# ─── Endpoint ─────────────────────────────────────────────────────────────────


@router.get("/summary", response_model=DashboardSummaryResponse)
async def dashboard_summary(
    request: Request,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    _user: dict = Depends(verify_supabase_token),  # noqa: B008
) -> DashboardSummaryResponse:
    """Return all dashboard data in a single request.

    DB-dependent queries run **sequentially** because they share a single
    ``AsyncSession`` (one underlying connection — concurrent use is unsafe).
    Individual failures are captured so the frontend degrades gracefully.
    """
    cache_key = build_manual_cache_key("dashboard_summary", {})
    cached = await get_manual_cache(cache_key)
    if cached is not None:
        return cached

    import time as _time

    t0 = _time.perf_counter()
    errors: dict[str, str] = {}

    # Health check — no DB needed
    try:
        health_result = await _fetch_health(request)
    except Exception as exc:
        logger.warning("dashboard_summary: health fetch failed: %s", exc)
        errors["health"] = str(exc)
        health_result = {"status": "error", "model_loaded": False, "cameras_active": 0}

    # Violation counts — single combined query
    try:
        counts_result = await _fetch_violation_counts(db)
    except Exception as exc:
        logger.warning("dashboard_summary: violation counts fetch failed: %s", exc)
        errors["violation_counts"] = str(exc)
        counts_result = {"total": 0, "today": 0}

    # Recent violations — sequential DB query
    try:
        recent_result = await _fetch_recent_violations(db)
    except Exception as exc:
        logger.warning("dashboard_summary: recent violations fetch failed: %s", exc)
        errors["recent_violations"] = str(exc)
        recent_result = []

    # Cameras — sequential DB query
    try:
        cameras_result = await _fetch_cameras(request, db)
    except Exception as exc:
        logger.warning("dashboard_summary: cameras fetch failed: %s", exc)
        errors["cameras"] = str(exc)
        cameras_result = []

    active_cameras: int = health_result.get("cameras_active", 0)  # type: ignore[union-attr]

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("dashboard_summary completed in %.1fms", elapsed_ms)

    response_data = DashboardSummaryResponse(
        active_cameras=active_cameras,
        violations_today=counts_result["today"],  # type: ignore[index]
        total_violations=counts_result["total"],  # type: ignore[index]
        recent_violations=recent_result,  # type: ignore[arg-type]
        cameras=cameras_result,  # type: ignore[arg-type]
        health=health_result,  # type: ignore[arg-type]
        errors=errors,
    )

    res_dict = response_data.model_dump() if hasattr(response_data, "model_dump") else response_data.dict()
    await set_manual_cache(cache_key, res_dict, expire=30)
    return response_data
