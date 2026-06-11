from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.api.deps import get_camera_manager
from backend.auth.supabase_auth import AuthUser, require_safety_manager_or_admin
from backend.camera.manager import CameraManager
from backend.db.models import Camera, Violation
from backend.db.session import get_db
from fastapi_cache.decorator import cache

"""Unified dashboard summary endpoint.

Returns all data the dashboard needs in a single response. If one sub-query fails the
endpoint still returns partial data — callers can inspect the ``errors``
field for details.
"""

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# ─── Response models ──────────────────────────────────────────────────────────


class RecentViolation(BaseModel):
    id: int
    camera_id: int
    violation_type: str
    confidence: float
    timestamp: str
    frame_url: str | None = None
    is_resolved: bool
    is_false_positive: bool


class DashboardSummaryResponse(BaseModel):
    active_cameras: int
    violations_today: int
    total_violations: int
    recent_violations: list[RecentViolation]
    cameras: list[dict[str, Any]]
    health: dict[str, Any]
    errors: dict[str, str]


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _frame_url(frame_path: str | None) -> str | None:
    """Convert a stored frame path to a URL path."""
    from backend.core.config import settings

    if not frame_path:
        return None
    path = frame_path.replace("\\", "/")
    prefix = settings.FRAMES_DIR.replace("\\", "/").rstrip("/") + "/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    return f"/frames/{path}"


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
    """Return total violations and violations-today counts in one round-trip."""
    now_naive = datetime.now(UTC).replace(tzinfo=None)
    start_of_today = now_naive.replace(hour=0, minute=0, second=0, microsecond=0)

    total_q = select(func.count()).select_from(Violation)
    today_q = select(func.count()).select_from(
        select(Violation).where(Violation.timestamp >= start_of_today).subquery()
    )

    total_res = await db.execute(total_q)
    today_res = await db.execute(today_q)
    return {
        "total": total_res.scalar_one(),
        "today": today_res.scalar_one(),
    }


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
@cache(expire=5)
async def dashboard_summary(
    request: Request,
    db: AsyncSession = Depends(get_db),  # noqa: B008
    _user: AuthUser = Depends(require_safety_manager_or_admin),  # noqa: B008
) -> DashboardSummaryResponse:
    """Return all dashboard data in a single request.

    Individual failures are captured and returned in the ``errors`` dict so the frontend
    can degrade gracefully rather than seeing a hard 500.
    """
    errors: dict[str, str] = {}

    # AsyncSession is stateful and cannot safely run multiple DB operations at
    # once. Keep the database reads sequential so one failed concurrent query
    # does not make counts fall back to zero while recent rows still render.
    health_result = await _fetch_health(request)

    try:
        counts_result = await _fetch_violation_counts(db)
    except Exception as exc:
        counts_result = exc

    try:
        recent_result = await _fetch_recent_violations(db)
    except Exception as exc:
        recent_result = exc

    try:
        cameras_result = await _fetch_cameras(request, db)
    except Exception as exc:
        cameras_result = exc

    # Unpack each result, recording errors for failed sub-queries
    if isinstance(health_result, Exception):
        logger.warning("dashboard_summary: health fetch failed: %s", health_result)
        errors["health"] = str(health_result)
        health_result = {"status": "error", "model_loaded": False, "cameras_active": 0}

    if isinstance(counts_result, Exception):
        logger.warning("dashboard_summary: violation counts fetch failed: %s", counts_result)
        errors["violation_counts"] = str(counts_result)
        counts_result = {"total": 0, "today": 0}

    if isinstance(recent_result, Exception):
        logger.warning("dashboard_summary: recent violations fetch failed: %s", recent_result)
        errors["recent_violations"] = str(recent_result)
        recent_result = []

    if isinstance(cameras_result, Exception):
        logger.warning("dashboard_summary: cameras fetch failed: %s", cameras_result)
        errors["cameras"] = str(cameras_result)
        cameras_result = []

    active_cameras: int = health_result.get("cameras_active", 0)  # type: ignore[union-attr]

    return DashboardSummaryResponse(
        active_cameras=active_cameras,
        violations_today=counts_result["today"],  # type: ignore[index]
        total_violations=counts_result["total"],  # type: ignore[index]
        recent_violations=recent_result,  # type: ignore[arg-type]
        cameras=cameras_result,  # type: ignore[arg-type]
        health=health_result,  # type: ignore[arg-type]
        errors=errors,
    )
