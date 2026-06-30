from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.alerts.safety_action_mqtt import (
    publish_safety_action_completed,
    publish_safety_action_created,
    publish_safety_action_effectiveness,
)
from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import _IS_POSTGRES, _IS_SQLITE, get_db
from backend.database.models import (
    PayrollRiskAnalysisLog,
    SafetyActionEffectivenessLog,
    SafetyActionTask,
    Violation,
    Worker,
)
from backend.schemas.safety_action import (
    CompleteSafetyActionRequest,
    CreateSafetyActionsRequest,
    CreateSafetyActionsResponse,
    EffectivenessDetail,
    EscalateSafetyActionsResponse,
    EvaluateEffectivenessResponse,
    SafetyActionEffectivenessListResponse,
    SafetyActionEffectivenessLogResponse,
    SafetyActionPriority,
    SafetyActionStatus,
    SafetyActionTaskListResponse,
    SafetyActionTaskResponse,
)

router = APIRouter(prefix="/admin/safety-actions", tags=["safety-actions"])


async def _require_safety_action_key(
    x_n8n_api_key: str | None = Header(default=None),
) -> None:
    expected = settings.N8N_SAFETY_ACTION_AGENT_API_KEY
    if not expected or x_n8n_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-N8N-API-KEY")

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_DEADLINE_DAYS: dict[str, int] = {"P1": 7, "P2": 14, "P3": 30}

_KNOWN_VIOLATION_TYPES = [
    "NO-Safety Vest",
    "NO-Hardhat",
    "NO-Helmet",
    "NO-Mask",
    "NO-Vest",
]


def _extract_violation_type(risk_reason: str) -> str:
    lower = risk_reason.lower()
    for vtype in _KNOWN_VIOLATION_TYPES:
        if vtype.lower() in lower:
            return vtype
    return "Unknown"


def _effectiveness_status(before: int, after: int) -> str:
    if before == 0 and after == 0:
        return "no_after_data"
    if before > 0 and after <= before * 0.5:
        return "effective"
    if before > 0 and after < before:
        return "partially_effective"
    return "not_effective"


def _effectiveness_recommendation(status: str, before: int, after: int, pct: Optional[float]) -> str:
    if status == "effective":
        return f"Violations reduced by {pct:.0f}%. Corrective action was effective."
    if status == "partially_effective":
        return f"Violations decreased from {before} to {after} but improvement was under 50%. Consider reinforcing the action."
    if status == "not_effective":
        return f"Violations did not decrease (before: {before}, after: {after}). Escalate or revise the corrective action."
    return "No violation data found in the review window. Cannot assess effectiveness."


def _parse_month_to_date(month: str) -> date:
    if not _MONTH_RE.match(month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    year, mon = int(month[:4]), int(month[5:7])
    if not (1 <= mon <= 12):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    return date(year, mon, 1)


def _normalize_reason(reason: str) -> str:
    normalized = reason.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="risk_reason cannot be empty")
    return normalized


def _reason_hash(reason: str) -> str:
    return hashlib.sha256(_normalize_reason(reason).encode("utf-8")).hexdigest()


def _action_title(reason: str, explicit_title: str | None = None) -> str:
    title = (explicit_title or "").strip()
    if not title:
        title = f"Safety corrective action: {reason.strip()}"
    return title[:255]


def _deadline_for(priority: str) -> date:
    return date.today() + timedelta(days=_DEADLINE_DAYS[priority])


def _admin_id(user: dict) -> str:
    return (user.get("email") or "").strip() or "unknown-admin"


def _task_response(
    task: SafetyActionTask,
    worker_name: str,
    eff_log: Optional[SafetyActionEffectivenessLog] = None,
) -> SafetyActionTaskResponse:
    effectiveness = None
    if eff_log is not None:
        effectiveness = EffectivenessDetail(
            before_count=eff_log.before_count,
            after_count=eff_log.after_count,
            improvement_percentage=eff_log.improvement_percentage,
            status=eff_log.status,
            recommendation=eff_log.recommendation,
            reviewed_at=eff_log.reviewed_at,
        )
    return SafetyActionTaskResponse(
        id=task.id,
        worker_name=worker_name,
        worker_id=task.worker_id,
        month=task.month.strftime("%Y-%m"),
        action_title=task.action_title,
        priority=task.priority,
        status=task.status,
        deadline_date=task.deadline_date,
        risk_reason=task.risk_reason,
        escalated_at=task.escalated_at,
        created_at=task.created_at,
        completed_at=task.completed_at,
        completed_by_admin_id=task.completed_by_admin_id,
        completion_notes=task.completion_notes,
        effectiveness=effectiveness,
    )


def _insert_stmt(values: dict):
    if _IS_SQLITE:
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        return (
            sqlite_insert(SafetyActionTask)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=["worker_id", "month", "risk_reason_hash"]
            )
            .returning(SafetyActionTask.id)
        )
    if _IS_POSTGRES:
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        return (
            pg_insert(SafetyActionTask)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=["worker_id", "month", "risk_reason_hash"]
            )
            .returning(SafetyActionTask.id)
        )
    return None


@router.post(
    "/agent/create-from-risk-analysis",
    response_model=CreateSafetyActionsResponse,
    status_code=201,
)
async def create_from_risk_analysis(
    payload: CreateSafetyActionsRequest,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_require_safety_action_key),
):
    month_date = _parse_month_to_date(payload.month)

    log = await db.get(PayrollRiskAnalysisLog, payload.log_id)
    if log is None:
        raise HTTPException(status_code=404, detail="Risk analysis log not found")

    worker_ids = {item.worker_id for item in payload.high_risk_workers}
    if worker_ids:
        existing_worker_ids = set(
            (
                await db.execute(select(Worker.id).where(Worker.id.in_(worker_ids)))
            ).scalars().all()
        )
        missing = sorted(worker_ids - existing_worker_ids)
        if missing:
            raise HTTPException(
                status_code=404,
                detail=f"Worker(s) not found: {', '.join(str(w) for w in missing)}",
            )

    created_ids: list[int] = []
    skipped_duplicates = 0

    for item in payload.high_risk_workers:
        values = {
            "worker_id": item.worker_id,
            "month": month_date,
            "risk_reason_hash": _reason_hash(item.risk_reason),
            "risk_reason": item.risk_reason.strip(),
            "action_title": _action_title(item.risk_reason, item.action_title),
            "priority": item.suggested_priority,
            "status": "pending",
            "deadline_date": _deadline_for(item.suggested_priority),
            "created_by": "n8n-agent",
            "created_from_log_id": payload.log_id,
        }

        stmt = _insert_stmt(values)
        if stmt is not None:
            new_id = (await db.execute(stmt)).scalar_one_or_none()
            if new_id is None:
                skipped_duplicates += 1
            else:
                created_ids.append(int(new_id))
            continue

        existing = (
            await db.execute(
                select(SafetyActionTask.id).where(
                    SafetyActionTask.worker_id == values["worker_id"],
                    SafetyActionTask.month == values["month"],
                    SafetyActionTask.risk_reason_hash == values["risk_reason_hash"],
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            skipped_duplicates += 1
            continue

        task = SafetyActionTask(**values)
        db.add(task)
        await db.flush()
        created_ids.append(task.id)

    await db.commit()

    if created_ids:
        created_tasks = (
            await db.execute(
                select(SafetyActionTask).where(SafetyActionTask.id.in_(created_ids))
            )
        ).scalars().all()
        for created_task in created_tasks:
            publish_safety_action_created(created_task)

    return CreateSafetyActionsResponse(
        created=len(created_ids),
        skipped_duplicates=skipped_duplicates,
        task_ids=created_ids,
    )


@router.post(
    "/agent/escalate-overdue",
    response_model=EscalateSafetyActionsResponse,
)
async def escalate_overdue(
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_require_safety_action_key),
):
    stmt = (
        update(SafetyActionTask)
        .where(
            SafetyActionTask.status == "pending",
            SafetyActionTask.escalated_at.is_(None),
            SafetyActionTask.deadline_date < date.today(),
        )
        .values(
            status="escalated",
            escalated_at=datetime.utcnow(),
            priority=case(
                (SafetyActionTask.priority == "P3", "P2"),
                (SafetyActionTask.priority == "P2", "P1"),
                else_=SafetyActionTask.priority,
            ),
        )
    )
    result = await db.execute(stmt)
    await db.commit()
    return EscalateSafetyActionsResponse(escalated_count=result.rowcount or 0)


@router.get("", response_model=SafetyActionTaskListResponse)
async def list_safety_actions(
    status: Optional[SafetyActionStatus] = Query(None),
    priority: Optional[SafetyActionPriority] = Query(None),
    worker_id: Optional[int] = Query(None),
    month: Optional[str] = Query(None, description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    stmt = (
        select(SafetyActionTask, Worker.name, SafetyActionEffectivenessLog)
        .join(Worker, SafetyActionTask.worker_id == Worker.id)
        .outerjoin(
            SafetyActionEffectivenessLog,
            SafetyActionEffectivenessLog.task_id == SafetyActionTask.id,
        )
    )
    if status is not None:
        stmt = stmt.where(SafetyActionTask.status == status)
    if priority is not None:
        stmt = stmt.where(SafetyActionTask.priority == priority)
    if worker_id is not None:
        stmt = stmt.where(SafetyActionTask.worker_id == worker_id)
    if month is not None:
        stmt = stmt.where(SafetyActionTask.month == _parse_month_to_date(month))

    rows = (
        await db.execute(
            stmt.order_by(
                SafetyActionTask.deadline_date.asc(),
                SafetyActionTask.created_at.desc(),
            )
        )
    ).all()
    return SafetyActionTaskListResponse(
        tasks=[_task_response(task, worker_name, eff_log) for task, worker_name, eff_log in rows]
    )


@router.patch("/{task_id}/complete", response_model=SafetyActionTaskResponse)
async def complete_safety_action(
    task_id: int,
    body: CompleteSafetyActionRequest,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(verify_supabase_token),
):
    task = await db.get(SafetyActionTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Safety action task not found")
    if task.status == "completed":
        raise HTTPException(status_code=409, detail="Safety action task is already completed")

    task.status = "completed"
    task.completed_at = datetime.utcnow()
    task.completed_by_admin_id = _admin_id(user)
    task.completion_notes = body.completion_notes

    await db.commit()
    await db.refresh(task)

    worker_name = (
        await db.execute(select(Worker.name).where(Worker.id == task.worker_id))
    ).scalar_one()
    publish_safety_action_completed(task, worker_name, task.completed_by_admin_id)
    return _task_response(task, worker_name)


@router.post(
    "/agent/evaluate-effectiveness",
    response_model=EvaluateEffectivenessResponse,
)
async def evaluate_effectiveness(
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(_require_safety_action_key),
):
    window_days = settings.EFFECTIVENESS_REVIEW_WINDOW_DAYS

    completed_tasks = (
        await db.execute(
            select(SafetyActionTask).where(
                SafetyActionTask.status == "completed",
                SafetyActionTask.completed_at.isnot(None),
            )
        )
    ).scalars().all()

    existing_logs = {
        log.task_id: log
        for log in (
            await db.execute(select(SafetyActionEffectivenessLog))
        ).scalars().all()
    }

    now = datetime.utcnow()
    counts = {"effective": 0, "partially_effective": 0, "not_effective": 0, "no_after_data": 0}
    reviewed_count = 0
    created_count = 0
    updated_count = 0
    reviewed_results: list[tuple[int, int, str, int, int, Optional[float], str]] = []

    for task in completed_tasks:
        completed_at = task.completed_at
        if completed_at.tzinfo is not None:
            completed_at = completed_at.replace(tzinfo=None)

        if window_days > 0 and (now - completed_at) < timedelta(days=window_days):
            continue

        violation_type = _extract_violation_type(task.risk_reason)

        before_start = completed_at - timedelta(days=window_days if window_days > 0 else 7)
        before_end = completed_at
        after_start = completed_at
        after_end = completed_at + timedelta(days=window_days if window_days > 0 else 7)

        before_count = (
            await db.execute(
                select(func.count()).select_from(Violation).where(
                    Violation.worker_id == task.worker_id,
                    Violation.violation_type == violation_type,
                    Violation.timestamp >= before_start,
                    Violation.timestamp < before_end,
                    Violation.is_false_positive.is_(False),
                )
            )
        ).scalar_one()

        after_count = (
            await db.execute(
                select(func.count()).select_from(Violation).where(
                    Violation.worker_id == task.worker_id,
                    Violation.violation_type == violation_type,
                    Violation.timestamp > after_start,
                    Violation.timestamp <= after_end,
                    Violation.is_false_positive.is_(False),
                )
            )
        ).scalar_one()

        status = _effectiveness_status(before_count, after_count)
        improvement_pct: Optional[float] = None
        if before_count > 0:
            improvement_pct = round((before_count - after_count) / before_count * 100, 1)

        recommendation = _effectiveness_recommendation(status, before_count, after_count, improvement_pct)
        month_str = task.month.strftime("%Y-%m")

        existing_log = existing_logs.get(task.id)
        if existing_log is not None:
            existing_log.before_count = before_count
            existing_log.after_count = after_count
            existing_log.improvement_percentage = improvement_pct
            existing_log.status = status
            existing_log.recommendation = recommendation
            existing_log.reviewed_at = now
            updated_count += 1
        else:
            log = SafetyActionEffectivenessLog(
                task_id=task.id,
                worker_id=task.worker_id,
                month=month_str,
                violation_type=violation_type,
                before_count=before_count,
                after_count=after_count,
                improvement_percentage=improvement_pct,
                status=status,
                recommendation=recommendation,
                reviewed_at=now,
            )
            db.add(log)
            created_count += 1

        counts[status] += 1
        reviewed_count += 1
        reviewed_results.append(
            (task.id, task.worker_id, violation_type, before_count, after_count, improvement_pct, status)
        )

    await db.commit()

    if reviewed_results:
        worker_ids = {worker_id for _, worker_id, *_ in reviewed_results}
        worker_names = dict(
            (
                await db.execute(select(Worker.id, Worker.name).where(Worker.id.in_(worker_ids)))
            ).all()
        )
        for task_id, worker_id, violation_type, before_count, after_count, improvement_pct, status in reviewed_results:
            publish_safety_action_effectiveness(
                task_id=task_id,
                worker_id=worker_id,
                worker_name=worker_names.get(worker_id, "Unknown"),
                action_type=violation_type,
                before_count=before_count,
                after_count=after_count,
                improvement_pct=improvement_pct,
                status=status,
            )

    return EvaluateEffectivenessResponse(
        reviewed_count=reviewed_count,
        created_count=created_count,
        updated_count=updated_count,
        effective=counts["effective"],
        partially_effective=counts["partially_effective"],
        not_effective=counts["not_effective"],
        no_after_data=counts["no_after_data"],
    )


@router.get("/effectiveness", response_model=SafetyActionEffectivenessListResponse)
async def list_effectiveness_logs(
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    rows = (
        await db.execute(
            select(SafetyActionEffectivenessLog, Worker.name, SafetyActionTask.action_title)
            .join(Worker, SafetyActionEffectivenessLog.worker_id == Worker.id)
            .join(SafetyActionTask, SafetyActionEffectivenessLog.task_id == SafetyActionTask.id)
            .order_by(SafetyActionEffectivenessLog.reviewed_at.desc())
        )
    ).all()
    return SafetyActionEffectivenessListResponse(
        logs=[
            SafetyActionEffectivenessLogResponse(
                id=log.id,
                task_id=log.task_id,
                worker_id=log.worker_id,
                worker_name=worker_name,
                action_title=action_title,
                month=log.month,
                violation_type=log.violation_type,
                before_count=log.before_count,
                after_count=log.after_count,
                improvement_percentage=log.improvement_percentage,
                status=log.status,
                recommendation=log.recommendation,
                reviewed_at=log.reviewed_at,
                created_at=log.created_at,
            )
            for log, worker_name, action_title in rows
        ]
    )
