from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.supabase_auth import verify_supabase_token
from app.core.config import settings
from app.db.models import Violation
from app.db.session import get_db
from app.schemas.violation import ViolationListResponse, ViolationResponse

router = APIRouter(prefix="/violations", tags=["violations"])


def _naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Strip timezone info from a datetime, treating it as UTC.

    JavaScript always sends ISO strings with a Z suffix (e.g. 2026-04-27T00:00:00.000Z).
    Pydantic parses that as a timezone-aware datetime. Our DB stores naive UTC datetimes.
    Mixing the two in Python arithmetic raises TypeError, so we normalise early.
    """
    if dt is None or dt.tzinfo is None:
        return dt
    return dt.replace(tzinfo=None)


def _frame_url(frame_path: str | None) -> str | None:
    """Build a URL for a stored frame.

    Handles two storage formats:
      - new: "camera_1/violation_xxx.jpg"           (relative to FRAMES_DIR)
      - legacy: "violation_frames/camera_1/violation_xxx.jpg"  (full, with prefix)
    Also normalises Windows backslashes to forward slashes for URL safety.
    """
    if not frame_path:
        return None
    path = frame_path.replace("\\", "/")
    prefix = settings.FRAMES_DIR.replace("\\", "/").rstrip("/") + "/"
    if path.startswith(prefix):
        path = path[len(prefix):]
    return f"/frames/{path}"


def _to_response(v: Violation) -> ViolationResponse:
    return ViolationResponse(
        id=v.id,
        camera_id=v.camera_id,
        violation_type=v.violation_type,
        confidence=v.confidence,
        timestamp=v.timestamp,
        frame_path=v.frame_path,
        frame_url=_frame_url(v.frame_path),
        resolved_at=v.resolved_at,
        is_resolved=v.resolved_at is not None,
        is_false_positive=bool(v.is_false_positive),
    )


@router.get("", response_model=ViolationListResponse)
async def list_violations(
    camera_id: Optional[int] = Query(None),
    violation_type: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    is_resolved: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    from_dt = _naive_utc(from_dt)
    to_dt   = _naive_utc(to_dt)

    q = select(Violation).order_by(Violation.timestamp.desc())
    if camera_id is not None:
        q = q.where(Violation.camera_id == camera_id)
    if violation_type is not None:
        q = q.where(Violation.violation_type == violation_type)
    if from_dt is not None:
        q = q.where(Violation.timestamp >= from_dt)
    if to_dt is not None:
        q = q.where(Violation.timestamp <= to_dt)
    if is_resolved is True:
        q = q.where(Violation.resolved_at.isnot(None))
    elif is_resolved is False:
        q = q.where(Violation.resolved_at.is_(None))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.offset((page - 1) * page_size).limit(page_size)
    items = (await db.execute(q)).scalars().all()

    return ViolationListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[_to_response(v) for v in items],
    )


@router.get("/stats")
async def violation_stats(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Aggregations for the dashboard charts: by hour, by type, by camera."""
    from_dt = _naive_utc(from_dt)
    if from_dt is None:
        from_dt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)

    q = select(Violation).where(Violation.timestamp >= from_dt)
    items = (await db.execute(q)).scalars().all()

    by_type: Counter = Counter()
    by_camera: Counter = Counter()
    by_hour: Counter = Counter()

    for v in items:
        by_type[v.violation_type] += 1
        by_camera[v.camera_id] += 1
        hour_key = v.timestamp.strftime("%Y-%m-%dT%H:00:00")
        by_hour[hour_key] += 1

    # Pad hourly buckets so the chart shows zero-counts (avoids gappy lines)
    span_hours = max(1, int((datetime.now(timezone.utc).replace(tzinfo=None) - from_dt).total_seconds() // 3600) + 1)
    bucket_start = from_dt.replace(minute=0, second=0, microsecond=0)
    hour_series = []
    for i in range(span_hours):
        ts = bucket_start + timedelta(hours=i)
        key = ts.strftime("%Y-%m-%dT%H:00:00")
        hour_series.append({"hour": ts.isoformat(), "count": by_hour.get(key, 0)})

    # Daily buckets for the 30-day heat map (always pad to 30 days)
    day_counts: Counter = Counter()
    for v in items:
        day_counts[v.timestamp.strftime("%Y-%m-%d")] += 1

    thirty_days_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=29)
    day_series = []
    for i in range(30):
        d = thirty_days_ago + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        day_series.append({"date": key, "count": day_counts.get(key, 0)})

    return {
        "total": len(items),
        "from": from_dt.isoformat(),
        "by_type": [{"type": k, "count": v} for k, v in by_type.most_common()],
        "by_camera": [{"camera_id": k, "count": v} for k, v in by_camera.most_common()],
        "by_hour": hour_series,
        "by_day": day_series,
    }


@router.post("/{violation_id}/resolve", response_model=ViolationResponse)
async def resolve_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = await db.get(Violation, violation_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    if v.resolved_at is None:
        v.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await db.refresh(v)
    return _to_response(v)


@router.post("/{violation_id}/unresolve", response_model=ViolationResponse)
async def unresolve_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = await db.get(Violation, violation_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    if v.resolved_at is not None:
        v.resolved_at = None
        await db.commit()
        await db.refresh(v)
    return _to_response(v)


@router.post("/{violation_id}/flag-false-positive", response_model=ViolationResponse)
async def flag_false_positive(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = await db.get(Violation, violation_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    v.is_false_positive = True
    await db.commit()
    await db.refresh(v)
    return _to_response(v)


@router.post("/{violation_id}/unflag-false-positive", response_model=ViolationResponse)
async def unflag_false_positive(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = await db.get(Violation, violation_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    v.is_false_positive = False
    await db.commit()
    await db.refresh(v)
    return _to_response(v)


@router.get("/export")
async def export_violations(
    camera_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    q = select(Violation).order_by(Violation.timestamp.desc())
    if camera_id is not None:
        q = q.where(Violation.camera_id == camera_id)
    violations = (await db.execute(q)).scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "camera_id", "violation_type", "confidence", "timestamp", "frame_path"])
    for v in violations:
        writer.writerow([v.id, v.camera_id, v.violation_type, v.confidence, v.timestamp, v.frame_path])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=violations.csv"},
    )


@router.get("/{violation_id}", response_model=ViolationResponse)
async def get_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = await db.get(Violation, violation_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    return _to_response(v)
