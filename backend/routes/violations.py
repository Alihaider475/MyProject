from __future__ import annotations


import csv
import io
import logging
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi_cache.decorator import cache
from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from pydantic import BaseModel

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.models import Violation, Worker
from backend.database.connection import get_db, _IS_POSTGRES
from backend.schemas.violation import (
    AutoIdentifyResponse,
    TopOffenderItem,
    TopOffendersResponse,
    ViolationListResponse,
    ViolationResponse,
    ViolationTypeCount,
)
from backend.utils.cache import build_manual_cache_key, get_manual_cache, set_manual_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/violations", tags=["violations"])


from backend.utils.helpers import naive_utc as _naive_utc, frame_url as _frame_url, thumbnail_url as _thumbnail_url


def _empty_stats_response(
    from_dt: datetime,
    now_naive: datetime | None = None,
    error: str | None = None,
) -> dict:
    now_naive = now_naive or datetime.now(timezone.utc).replace(tzinfo=None)
    span_hours = max(1, int((now_naive - from_dt).total_seconds() // 3600) + 1)
    bucket_start = from_dt.replace(minute=0, second=0, microsecond=0)
    thirty_days_ago = now_naive - timedelta(days=29)

    response = {
        "total": 0,
        "from": from_dt.isoformat(),
        "by_type": [],
        "by_camera": [],
        "by_hour": [
            {"hour": (bucket_start + timedelta(hours=i)).isoformat(), "count": 0}
            for i in range(span_hours)
        ],
        "by_day": [
            {
                "date": (thirty_days_ago + timedelta(days=i)).strftime("%Y-%m-%d"),
                "count": 0,
            }
            for i in range(30)
        ],
    }
    if error:
        response["errors"] = {"database": error}
    return response


def _to_response(v: Violation) -> ViolationResponse:
    worker_name = None
    try:
        if v.worker is not None:
            worker_name = v.worker.name
    except Exception:
        pass
    import json as _json
    person_bbox = None
    if v.person_bbox:
        try:
            person_bbox = _json.loads(v.person_bbox)
        except Exception:
            pass
    return ViolationResponse(
        id=v.id,
        camera_id=v.camera_id,
        violation_type=v.violation_type,
        confidence=v.confidence,
        timestamp=v.timestamp,
        frame_path=v.frame_path,
        frame_url=_frame_url(v.frame_path),
        thumbnail_url=_thumbnail_url(v.frame_path),
        resolved_at=v.resolved_at,
        is_resolved=v.resolved_at is not None,
        is_false_positive=bool(v.is_false_positive),
        worker_id=v.worker_id,
        worker_name=worker_name,
        fine_amount=v.fine_amount,
        track_id=v.track_id,
        person_bbox=person_bbox,
    )


@router.get("", response_model=ViolationListResponse)
async def list_violations(
    camera_id: Optional[int] = Query(None),
    violation_type: Optional[str] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    is_resolved: Optional[bool] = Query(None),
    track_id: Optional[int] = Query(None),
    worker_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    from_dt = _naive_utc(from_dt)
    to_dt   = _naive_utc(to_dt)

    q = (
        select(Violation)
        .options(selectinload(Violation.worker))
        .order_by(Violation.timestamp.desc())
    )
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
    if track_id is not None:
        q = q.where(Violation.track_id == track_id)
    if worker_id is not None:
        q = q.where(Violation.worker_id == worker_id)

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
    camera_id: Optional[int] = Query(None),
    violation_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Aggregations for the dashboard charts: by hour, by type, by camera.

    Uses SQL GROUP BY instead of loading all rows into Python — dramatically
    faster and lighter on memory for large violation tables.

    Dialect-aware: uses strftime() for SQLite, date_trunc() for PostgreSQL.
    """
    params = {
        "from": from_dt,
        "camera_id": camera_id,
        "violation_type": violation_type,
    }
    cache_key = build_manual_cache_key("violation_stats", params)
    cached = await get_manual_cache(cache_key)
    if cached is not None:
        return cached

    import time as _time

    t0 = _time.perf_counter()

    from_dt = _naive_utc(from_dt)
    if from_dt is None:
        from_dt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)

    # Build common WHERE filters
    def _filters():
        clauses = [Violation.timestamp >= from_dt]
        if camera_id is not None:
            clauses.append(Violation.camera_id == camera_id)
        if violation_type is not None:
            clauses.append(Violation.violation_type == violation_type)
        return clauses

    # Dialect-aware date truncation
    if _IS_POSTGRES:
        hour_expr = func.date_trunc("hour", Violation.timestamp).label("hour")
        day_expr = func.date_trunc("day", Violation.timestamp).label("day")
    else:
        # SQLite: use strftime to truncate to hour/day
        hour_expr = func.strftime("%Y-%m-%d %H:00:00", Violation.timestamp).label("hour")
        day_expr = func.strftime("%Y-%m-%d", Violation.timestamp).label("day")

    # Run all 5 lightweight aggregation queries concurrently
    total_q = select(func.count(Violation.id)).where(*_filters())
    type_q = (
        select(Violation.violation_type, func.count(Violation.id).label("cnt"))
        .where(*_filters())
        .group_by(Violation.violation_type)
        .order_by(func.count(Violation.id).desc())
    )
    cam_q = (
        select(Violation.camera_id, func.count(Violation.id).label("cnt"))
        .where(*_filters())
        .group_by(Violation.camera_id)
        .order_by(func.count(Violation.id).desc())
    )
    hour_q = (
        select(hour_expr, func.count(Violation.id).label("cnt"))
        .where(*_filters())
        .group_by(hour_expr)
    )
    day_q = (
        select(day_expr, func.count(Violation.id).label("cnt"))
        .where(*_filters())
        .group_by(day_expr)
    )

    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)

    try:
        total_r = await db.execute(total_q)
        type_r = await db.execute(type_q)
        cam_r = await db.execute(cam_q)
        hour_r = await db.execute(hour_q)
        day_r = await db.execute(day_q)
    except Exception:
        with suppress(Exception):
            await db.rollback()
        logger.exception("violation_stats database query failed")
        return _empty_stats_response(from_dt, now_naive, error="unavailable")

    total = total_r.scalar_one()
    by_type_rows = type_r.all()
    by_camera_rows = cam_r.all()

    # Build hour lookup — handle both PostgreSQL datetime and SQLite string results
    hour_rows = {}
    for row in hour_r.all():
        h = row.hour
        if isinstance(h, str):
            h = datetime.fromisoformat(h)
        elif hasattr(h, 'tzinfo') and h.tzinfo:
            h = h.replace(tzinfo=None)
        hour_rows[h] = row.cnt

    # Build day lookup
    day_rows = {}
    for row in day_r.all():
        d = row.day
        if isinstance(d, str):
            # SQLite returns "YYYY-MM-DD"
            day_rows[d] = row.cnt
        else:
            if hasattr(d, 'tzinfo') and d.tzinfo:
                d = d.replace(tzinfo=None)
            day_rows[d.strftime("%Y-%m-%d")] = row.cnt

    # Pad hourly buckets so the chart shows zero-counts
    span_hours = max(1, int((now_naive - from_dt).total_seconds() // 3600) + 1)
    bucket_start = from_dt.replace(minute=0, second=0, microsecond=0)
    hour_series = []
    for i in range(span_hours):
        ts = bucket_start + timedelta(hours=i)
        hour_series.append({"hour": ts.isoformat(), "count": hour_rows.get(ts, 0)})

    # Daily buckets for the 30-day heat map
    thirty_days_ago = now_naive - timedelta(days=29)
    day_series = []
    for i in range(30):
        d = thirty_days_ago + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        day_series.append({"date": key, "count": day_rows.get(key, 0)})

    elapsed_ms = (_time.perf_counter() - t0) * 1000
    logger.info("violation_stats completed in %.1fms (total=%d)", elapsed_ms, total)

    result_data = {
        "total": total,
        "from": from_dt.isoformat(),
        "by_type": [{"type": row.violation_type, "count": row.cnt} for row in by_type_rows],
        "by_camera": [{"camera_id": row.camera_id, "count": row.cnt} for row in by_camera_rows],
        "by_hour": hour_series,
        "by_day": day_series,
    }
    await set_manual_cache(cache_key, result_data, expire=30)
    return result_data


@router.post("/{violation_id}/resolve", response_model=ViolationResponse)
async def resolve_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    if v.resolved_at is None:
        v.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()
        await db.refresh(v)
        from backend.utils.cache import invalidate_backend_cache
        await invalidate_backend_cache()
    return _to_response(v)


@router.post("/{violation_id}/unresolve", response_model=ViolationResponse)
async def unresolve_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    if v.resolved_at is not None:
        v.resolved_at = None
        await db.commit()
        await db.refresh(v)
        from backend.utils.cache import invalidate_backend_cache
        await invalidate_backend_cache()
    return _to_response(v)


@router.post("/{violation_id}/flag-false-positive", response_model=ViolationResponse)
async def flag_false_positive(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    v.is_false_positive = True
    await db.commit()
    await db.refresh(v)
    from backend.utils.cache import invalidate_backend_cache
    await invalidate_backend_cache()
    return _to_response(v)


@router.post("/{violation_id}/unflag-false-positive", response_model=ViolationResponse)
async def unflag_false_positive(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    v.is_false_positive = False
    await db.commit()
    await db.refresh(v)
    from backend.utils.cache import invalidate_backend_cache
    await invalidate_backend_cache()
    return _to_response(v)


@router.get("/export")
async def export_violations(
    camera_id: Optional[int] = Query(None),
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(10_000, ge=1, le=100_000),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    from_dt = _naive_utc(from_dt)
    to_dt = _naive_utc(to_dt)

    q = select(Violation).order_by(Violation.timestamp.desc())
    if camera_id is not None:
        q = q.where(Violation.camera_id == camera_id)
    if from_dt is not None:
        q = q.where(Violation.timestamp >= from_dt)
    if to_dt is not None:
        q = q.where(Violation.timestamp <= to_dt)
    q = q.limit(limit)
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


class AssignWorkerBody(BaseModel):
    worker_id: int


@router.post("/{violation_id}/assign-worker", response_model=ViolationResponse)
async def assign_worker(
    violation_id: int,
    body: AssignWorkerBody,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    from backend.detection.fine_calculator import apply_fine, get_fine_amount
    from backend.detection.violation_checker import ViolationEvent

    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")

    worker = await db.get(Worker, body.worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Worker not found")

    if v.fine_amount is not None:
        raise HTTPException(status_code=409, detail="Violation already has a fine assigned")

    v.worker_id = body.worker_id

    fine_amount = await get_fine_amount(db, v.violation_type)
    if fine_amount is None:
        logger.info(
            "[FINE] Skipped: no active fine config for type=%s (violation=%d, manual assign)",
            v.violation_type, v.id,
        )
    else:
        event = ViolationEvent(
            camera_id=v.camera_id,
            violation_type=v.violation_type,
            confidence=v.confidence,
            frame_path=v.frame_path,
            worker_id=body.worker_id,
            fine_amount=fine_amount,
            violation_id=v.id,
        )
        fine = await apply_fine(db, event, body.worker_id, settings.FINES_CURRENCY)
        if fine is not None:
            v.fine_amount = fine_amount
    await db.commit()
    await db.refresh(v)
    from backend.utils.cache import invalidate_backend_cache
    await invalidate_backend_cache()
    return _to_response(v)


@router.post("/auto-identify", response_model=AutoIdentifyResponse)
async def auto_identify(
    request: Request,
    _user: dict = Depends(verify_supabase_token),
):
    """Scan unassigned violations — compare saved frames against enrolled worker
    faces and auto-assign fines where a match is found."""
    from backend.detection.auto_identifier import auto_identify_unassigned

    detector = request.app.state.detector
    face_recognizer = request.app.state.camera_manager._face_recognizer
    result = await auto_identify_unassigned(detector, face_recognizer)
    if result.get("identified", 0) > 0:
        from backend.utils.cache import invalidate_backend_cache
        await invalidate_backend_cache()
    return AutoIdentifyResponse(**result)


@router.get("/counts-by-camera")
@cache(expire=30)
async def violation_counts_by_camera(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    """Return violation counts grouped by camera_id — one query instead of N."""
    q = (
        select(Violation.camera_id, func.count(Violation.id).label("cnt"))
        .group_by(Violation.camera_id)
    )
    rows = (await db.execute(q)).all()
    return {row.camera_id: row.cnt for row in rows}


@router.get("/top-offenders", response_model=TopOffendersResponse)
async def top_offenders(
    from_dt: Optional[datetime] = Query(None, alias="from"),
    to_dt: Optional[datetime] = Query(None, alias="to"),
    camera_id: Optional[int] = Query(None),
    violation_type: Optional[str] = Query(None),
    min_violations: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    params = {
        "from": from_dt,
        "to": to_dt,
        "camera_id": camera_id,
        "violation_type": violation_type,
        "min_violations": min_violations,
        "limit": limit,
        "sort": sort,
    }
    cache_key = build_manual_cache_key("top_offenders", params)
    cached = await get_manual_cache(cache_key)
    if cached is not None:
        return cached

    from_dt = _naive_utc(from_dt)
    to_dt = _naive_utc(to_dt)
    if from_dt is None:
        from_dt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)

    base_filters = [Violation.timestamp >= from_dt]
    if to_dt is not None:
        base_filters.append(Violation.timestamp <= to_dt)
    if camera_id is not None:
        base_filters.append(Violation.camera_id == camera_id)
    if violation_type is not None:
        base_filters.append(Violation.violation_type == violation_type)

    # Phase A — two concurrent aggregation queries
    identified_q = (
        select(
            Violation.worker_id,
            Worker.name.label("worker_name"),
            func.count(Violation.id).label("total"),
            func.min(Violation.timestamp).label("first_seen"),
            func.max(Violation.timestamp).label("last_seen"),
        )
        .outerjoin(Worker, Violation.worker_id == Worker.id)
        .where(Violation.worker_id.isnot(None), *base_filters)
        .group_by(Violation.worker_id, Worker.name)
        .having(func.count(Violation.id) >= min_violations)
    )

    unidentified_q = (
        select(
            Violation.track_id,
            Violation.camera_id,
            func.count(Violation.id).label("total"),
            func.min(Violation.timestamp).label("first_seen"),
            func.max(Violation.timestamp).label("last_seen"),
        )
        .where(
            Violation.worker_id.is_(None),
            Violation.track_id.isnot(None),
            *base_filters,
        )
        .group_by(Violation.track_id, Violation.camera_id)
        .having(func.count(Violation.id) >= min_violations)
    )

    id_result = await db.execute(identified_q)
    unid_result = await db.execute(unidentified_q)

    # Phase B — merge & sort
    offenders: list[dict] = []
    for row in id_result.all():
        offenders.append({
            "worker_id": row.worker_id,
            "worker_name": row.worker_name,
            "track_id": None,
            "camera_id": None,
            "display_name": row.worker_name or f"Worker #{row.worker_id}",
            "total": row.total,
            "first_seen": row.first_seen,
            "last_seen": row.last_seen,
        })
    for row in unid_result.all():
        offenders.append({
            "worker_id": None,
            "worker_name": None,
            "track_id": row.track_id,
            "camera_id": row.camera_id,
            "display_name": f"Person #{row.track_id}",
            "total": row.total,
            "first_seen": row.first_seen,
            "last_seen": row.last_seen,
        })

    reverse = sort == "desc"
    offenders.sort(key=lambda o: o["total"], reverse=reverse)
    offenders = offenders[:limit]

    if not offenders:
        response_data = TopOffendersResponse(total=0, items=[])
        res_dict = response_data.model_dump() if hasattr(response_data, "model_dump") else response_data.dict()
        await set_manual_cache(cache_key, res_dict, expire=30)
        return response_data

    # Phase C — type breakdown, cameras seen, latest frame
    worker_ids = [o["worker_id"] for o in offenders if o["worker_id"] is not None]
    track_keys = [(o["track_id"], o["camera_id"]) for o in offenders if o["worker_id"] is None]

    type_clauses = []
    if worker_ids:
        type_clauses.append(
            (Violation.worker_id.isnot(None)) & (Violation.worker_id.in_(worker_ids))
        )
    if track_keys:
        type_clauses.append(
            (Violation.worker_id.is_(None))
            & (tuple_(Violation.track_id, Violation.camera_id).in_(track_keys))
        )

    combined_filter = or_(*type_clauses) if len(type_clauses) > 1 else type_clauses[0]

    type_q = (
        select(
            Violation.worker_id,
            Violation.track_id,
            Violation.camera_id,
            Violation.violation_type,
            func.count(Violation.id).label("cnt"),
        )
        .where(combined_filter, *base_filters)
        .group_by(Violation.worker_id, Violation.track_id, Violation.camera_id, Violation.violation_type)
    )

    # dialect-aware string aggregation for camera IDs
    if _IS_POSTGRES:
        from sqlalchemy import cast, String as SAString, literal_column
        cam_agg = func.string_agg(cast(Violation.camera_id, SAString), literal_column("','")).label("cam_ids")
    else:
        cam_agg = func.group_concat(func.distinct(Violation.camera_id)).label("cam_ids")

    cameras_q = (
        select(
            Violation.worker_id,
            Violation.track_id,
            cam_agg,
        )
        .where(combined_filter, *base_filters)
        .group_by(Violation.worker_id, Violation.track_id)
    )

    latest_q = (
        select(
            Violation.worker_id,
            Violation.track_id,
            Violation.camera_id,
            Violation.frame_path,
        )
        .where(combined_filter, *base_filters, Violation.frame_path.isnot(None))
        .order_by(Violation.timestamp.desc())
    )

    type_r = await db.execute(type_q)
    cameras_r = await db.execute(cameras_q)
    latest_r = await db.execute(latest_q)

    # Build lookups
    type_map: dict[tuple, list[ViolationTypeCount]] = {}
    for row in type_r.all():
        if row.worker_id is not None:
            key = ("w", row.worker_id)
        else:
            key = ("t", row.track_id, row.camera_id)
        type_map.setdefault(key, []).append(
            ViolationTypeCount(violation_type=row.violation_type, count=row.cnt)
        )

    cameras_map: dict[tuple, list[int]] = {}
    for row in cameras_r.all():
        cam_str = row.cam_ids or ""
        cam_list = [int(c) for c in cam_str.split(",") if c]
        if row.worker_id is not None:
            cameras_map[("w", row.worker_id)] = cam_list
        else:
            cameras_map[("t", row.track_id)] = cam_list

    latest_map: dict[tuple, str | None] = {}
    for row in latest_r.all():
        if row.worker_id is not None:
            key = ("w", row.worker_id)
        else:
            key = ("t", row.track_id, row.camera_id)
        if key not in latest_map:
            latest_map[key] = _frame_url(row.frame_path)

    # Build response items
    items = []
    for o in offenders:
        if o["worker_id"] is not None:
            key = ("w", o["worker_id"])
            cam_key = ("w", o["worker_id"])
        else:
            key = ("t", o["track_id"], o["camera_id"])
            cam_key = ("t", o["track_id"])

        items.append(TopOffenderItem(
            worker_id=o["worker_id"],
            worker_name=o["worker_name"],
            track_id=o["track_id"],
            camera_id=o["camera_id"],
            display_name=o["display_name"],
            total_violations=o["total"],
            violation_types=type_map.get(key, []),
            first_seen=o["first_seen"],
            last_seen=o["last_seen"],
            cameras_seen=cameras_map.get(cam_key, [o["camera_id"]] if o["camera_id"] else []),
            latest_frame_url=latest_map.get(key),
        ))

    response_data = TopOffendersResponse(total=len(items), items=items)
    res_dict = response_data.model_dump() if hasattr(response_data, "model_dump") else response_data.dict()
    await set_manual_cache(cache_key, res_dict, expire=30)
    return response_data


@router.get("/{violation_id}", response_model=ViolationResponse)
async def get_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    v = (
        await db.execute(
            select(Violation)
            .options(selectinload(Violation.worker))
            .where(Violation.id == violation_id)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    return _to_response(v)


# ─── Debug / test endpoint ────────────────────────────────────────────────────

class _TestViolationBody(BaseModel):
    camera_id: int
    violation_type: str = "NO-Hardhat"


@router.post("/debug/test-insert")
async def debug_test_insert(
    body: _TestViolationBody,
    db: AsyncSession = Depends(get_db),
):
    """DEV-ONLY: Insert one test violation to verify the DB write path.
    Uses the same session factory as the real pipeline."""
    from backend.database.connection import AsyncSessionLocal
    from backend.database.models import Violation as ViolationModel, Camera

    # Verify the camera exists
    cam = await db.get(Camera, body.camera_id)
    if cam is None:
        raise HTTPException(status_code=404, detail=f"Camera {body.camera_id} not found in DB")

    async with AsyncSessionLocal() as session:
        v = ViolationModel(
            camera_id=body.camera_id,
            violation_type=body.violation_type,
            confidence=0.99,
            frame_path=None,
        )
        session.add(v)
        await session.flush()
        vid = v.id
        await session.commit()

    logger.info("[DEBUG] Test violation inserted: id=%d camera=%d type=%s", vid, body.camera_id, body.violation_type)
    return {"status": "ok", "violation_id": vid, "camera_id": body.camera_id, "violation_type": body.violation_type}
