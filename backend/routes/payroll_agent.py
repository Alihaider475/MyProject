"""n8n Payroll Risk Analysis Agent.

This router is the backend for the n8n monthly risk-analysis agent. It is NOT the
manual Admin Payroll report (that lives in backend/routes/fines.py and is unchanged).

UC_16 amendment: this agent performs risk analysis + audit logging ONLY. It never
marks fines as deducted/waived and never changes existing payroll behaviour. Fine
status updates remain manual from the Admin Payroll page.

Auth — two separate schemes:
  * Execution endpoints (risk-analysis, risk-analysis-log) are called only by n8n and
    are protected by the X-N8N-API-KEY header.
  * The history endpoint is called by the React Admin Payroll page and reuses the
    existing Supabase admin JWT dependency (verify_supabase_token). The frontend never
    sees or sends X-N8N-API-KEY.

Month filtering is deliberately dialect-agnostic (Python-computed date ranges +
deduction_month), NOT the dialect-specific to_char/strftime used by fines.py — that
SQL crashes under the SQLite test database, so the new endpoint avoids it entirely.
"""
from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import Fine, PayrollRiskAnalysisLog, Violation, Worker
from backend.schemas.payroll_agent import (
    DepartmentRisk,
    MonthComparison,
    Recommendation,
    RiskAnalysisLogCreate,
    RiskAnalysisLogResponse,
    RiskAnalysisResponse,
    WorkerRisk,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/payroll/agent", tags=["payroll-agent"])

BACKEND_VERSION = "1.0.0"
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


# ── Auth: X-N8N-API-KEY (n8n execution endpoints only) ─────────────────────────


async def require_n8n_api_key(x_n8n_api_key: str | None = Header(default=None)) -> None:
    """Validate the X-N8N-API-KEY header against the configured shared secret.

    Raises 401 if the header is missing or does not match. The key value is never
    logged. An empty configured key is treated as "no valid key", so a blank header
    can never authenticate.
    """
    expected = settings.N8N_PAYROLL_AGENT_API_KEY
    if not expected or x_n8n_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-N8N-API-KEY")


# ── Month helpers (dialect-agnostic) ───────────────────────────────────────────


def _parse_month(month: str) -> tuple[int, int]:
    if not _MONTH_RE.match(month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    year, mon = int(month[:4]), int(month[5:7])
    if not (1 <= mon <= 12):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    return year, mon


def _shift_month(year: int, mon: int, delta: int) -> tuple[int, int]:
    """Return (year, month) shifted by *delta* months (delta may be negative)."""
    idx = year * 12 + (mon - 1) + delta
    return idx // 12, idx % 12 + 1


def _month_str(year: int, mon: int) -> str:
    return f"{year:04d}-{mon:02d}"


def _effective_month(fine: Fine) -> str:
    """The month a fine counts toward: explicit deduction_month, else issue month.

    Mirrors fines.py::_effective_month_expr but computed in Python so it works on
    every SQL dialect (and under the SQLite test DB)."""
    if fine.deduction_month:
        return fine.deduction_month
    return fine.fine_date.strftime("%Y-%m")


# ── Pure scoring functions (imported directly by unit tests) ───────────────────


def repeat_penalty(max_same_violation_repeat_count: int) -> int:
    """First occurrence of a type scores 0; only genuine repeats are penalised."""
    return max(0, max_same_violation_repeat_count - 1) * 15


def trend_penalty(
    monthly_violations: int,
    total_fine_amount: float,
    baseline_violations: float,
    baseline_fine: float,
) -> int:
    """Penalise a spike vs the 3-month baseline, with a zero-baseline guard so a
    brand-new worker / first-ever violation month is never treated as a spike."""
    if baseline_violations == 0 and baseline_fine == 0:
        return 0
    penalty = 0
    if baseline_violations > 0 and monthly_violations > baseline_violations * 1.30:
        penalty += 15
    if baseline_fine > 0 and total_fine_amount > baseline_fine * 1.30:
        penalty += 10
    return penalty


def compute_risk_score(
    monthly_violations: int,
    total_fine_amount: float,
    max_same_violation_repeat_count: int,
    baseline_violations: float,
    baseline_fine: float,
) -> float:
    score = (
        monthly_violations * 10
        + total_fine_amount / 300
        + repeat_penalty(max_same_violation_repeat_count)
        + trend_penalty(
            monthly_violations, total_fine_amount, baseline_violations, baseline_fine
        )
    )
    return round(score, 2)


def risk_level_for(score: float) -> str:
    if score >= 50:
        return "high"
    if score >= 25:
        return "medium"
    return "normal"


def department_level_for(score: float) -> str:
    if score >= 100:
        return "high"
    if score >= 50:
        return "medium"
    return "normal"


def priority_for(worker_level: str, department_level: str) -> str:
    """P1 = high (worker or dept), P2 = medium (worker or dept), else P3."""
    if worker_level == "high" or department_level == "high":
        return "P1"
    if worker_level == "medium" or department_level == "medium":
        return "P2"
    return "P3"


_DEADLINE_DAYS = {"P1": 7, "P2": 14, "P3": 30}


def _pct_change(current: float, baseline: float) -> Optional[float]:
    if baseline <= 0:
        return None
    return round((current - baseline) / baseline * 100, 2)


# ── Endpoint 1: Risk analysis ──────────────────────────────────────────────────


@router.get("/risk-analysis", response_model=RiskAnalysisResponse)
async def risk_analysis(
    month: str = Query(..., description="YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(require_n8n_api_key),
):
    year, mon = _parse_month(month)
    selected_month = _month_str(year, mon)

    # Three calendar months immediately before the selected month (rolling baseline).
    prior_months = [_month_str(*_shift_month(year, mon, -d)) for d in (1, 2, 3)]
    all_months = {selected_month, *prior_months}

    # Dialect-agnostic window: the first day of the earliest baseline month up to
    # (exclusive) the first day of the month after the selected month.
    win_y, win_m = _shift_month(year, mon, -3)
    window_start = datetime(win_y, win_m, 1)
    end_y, end_m = _shift_month(year, mon, 1)
    window_end = datetime(end_y, end_m, 1)

    # Pull every non-waived fine that could fall in the 4-month window — either by
    # explicit deduction_month or by issue date — joined to its violation (for type)
    # and worker (for name/department). Aggregation happens in Python.
    rows = (
        await db.execute(
            select(
                Fine.worker_id,
                Fine.fine_amount,
                Fine.deduction_month,
                Fine.fine_date,
                Violation.violation_type,
                Worker.name.label("worker_name"),
                Worker.employee_id.label("employee_id"),
                Worker.department.label("department"),
            )
            .join(Violation, Fine.violation_id == Violation.id)
            .outerjoin(Worker, Fine.worker_id == Worker.id)
            .where(
                Fine.status != "waived",
                or_(
                    Fine.deduction_month.in_(all_months),
                    and_(
                        Fine.deduction_month.is_(None),
                        Fine.fine_date >= window_start,
                        Fine.fine_date < window_end,
                    ),
                ),
            )
        )
    ).all()

    generated_at = datetime.utcnow().isoformat()

    # Bucket rows by worker → month. Each entry tracks violation_type counts + amount.
    workers: dict[int, dict] = {}
    for row in rows:
        eff_month = (
            row.deduction_month
            if row.deduction_month
            else row.fine_date.strftime("%Y-%m")
        )
        if eff_month not in all_months:
            continue
        w = workers.setdefault(
            row.worker_id,
            {
                "worker_name": row.worker_name or "Unknown",
                "employee_id": row.employee_id or "",
                "department": row.department,
                "months": defaultdict(lambda: {"types": Counter(), "amount": 0.0}),
            },
        )
        bucket = w["months"][eff_month]
        bucket["types"][row.violation_type] += 1
        bucket["amount"] += float(row.fine_amount or 0.0)

    # Workers with NO fines in the selected month are not analysed (the agent reports
    # on the selected month). Empty selected month → clean empty response.
    selected_worker_ids = [
        wid for wid, w in workers.items() if w["months"].get(selected_month)
    ]
    if not selected_worker_ids:
        return RiskAnalysisResponse(
            selected_month=selected_month,
            status="empty",
            message="No fine data for selected month.",
            total_workers_with_fines=0,
            high_risk_workers=[],
            medium_risk_workers=[],
            department_summary=[],
            recommendations=[],
            month_to_month_comparison=None,
            generated_at=generated_at,
        )

    worker_risks: list[WorkerRisk] = []
    for wid in selected_worker_ids:
        w = workers[wid]
        sel = w["months"][selected_month]
        monthly_violations = sum(sel["types"].values())
        total_fine_amount = round(sel["amount"], 2)
        type_counts = sel["types"]
        most_common_type = type_counts.most_common(1)[0][0] if type_counts else None
        max_repeat = max(type_counts.values()) if type_counts else 0

        prior_counts = [sum(w["months"].get(m, {}).get("types", {}).values()) for m in prior_months]
        prior_amounts = [w["months"].get(m, {}).get("amount", 0.0) for m in prior_months]
        baseline_violations = round(sum(prior_counts) / 3, 2)
        baseline_fine = round(sum(prior_amounts) / 3, 2)

        score = compute_risk_score(
            monthly_violations,
            total_fine_amount,
            max_repeat,
            baseline_violations,
            baseline_fine,
        )
        level = risk_level_for(score)

        reasons: list[str] = [f"{monthly_violations} violation(s) in {selected_month}"]
        if max_repeat >= 2:
            reasons.append(
                f"Repeat offender: {max_repeat}× {most_common_type} in {selected_month}"
            )
        v_change = _pct_change(monthly_violations, baseline_violations)
        f_change = _pct_change(total_fine_amount, baseline_fine)
        if v_change is not None and v_change > 30:
            reasons.append(
                f"Violations up {v_change:.0f}% vs 3-month average ({baseline_violations})"
            )
        if f_change is not None and f_change > 30:
            reasons.append(
                f"Fines up {f_change:.0f}% vs 3-month average ({baseline_fine:.0f})"
            )

        worker_risks.append(
            WorkerRisk(
                worker_id=wid,
                worker_name=w["worker_name"],
                employee_id=w["employee_id"],
                department=w["department"],
                total_violations=monthly_violations,
                total_fine_amount=total_fine_amount,
                most_common_violation_type=most_common_type,
                max_same_violation_repeat_count=max_repeat,
                previous_3_month_avg_violations=baseline_violations,
                previous_3_month_avg_fine_amount=baseline_fine,
                violation_change_percentage=v_change,
                fine_change_percentage=f_change,
                risk_score=score,
                risk_level=level,
                risk_reasons=reasons,
                recommendations=[],
            )
        )

    # ── Department aggregation (score = sum of worker scores in that department) ──
    dept_groups: dict[str, list[WorkerRisk]] = defaultdict(list)
    for wr in worker_risks:
        dept_groups[wr.department or "Unassigned"].append(wr)

    dept_levels: dict[str, str] = {}
    department_summary: list[DepartmentRisk] = []
    for dept, members in dept_groups.items():
        dept_score = round(sum(m.risk_score for m in members), 2)
        dept_level = department_level_for(dept_score)
        dept_levels[dept] = dept_level
        dept_types: Counter = Counter()
        for m in members:
            if m.most_common_violation_type:
                dept_types[m.most_common_violation_type] += m.total_violations
        dept_common = dept_types.most_common(1)[0][0] if dept_types else None
        dept_rec = Recommendation(
            priority=priority_for("normal", dept_level),
            target_type="department",
            target_name=dept,
            action=f"Department-wide PPE safety audit ({dept_common or 'general'})",
            owner="safety manager",
            deadline_days=_DEADLINE_DAYS[priority_for("normal", dept_level)],
            trigger=f"Department risk score {dept_score} for {selected_month}",
        )
        department_summary.append(
            DepartmentRisk(
                department=dept,
                total_workers_involved=len(members),
                total_violations=sum(m.total_violations for m in members),
                total_fine_amount=round(sum(m.total_fine_amount for m in members), 2),
                most_common_violation_type=dept_common,
                risk_score=dept_score,
                risk_level=dept_level,
                recommendation=dept_rec,
            )
        )

    # ── Per-worker recommendations (priority can be raised by department level) ──
    for wr in worker_risks:
        dept_level = dept_levels.get(wr.department or "Unassigned", "normal")
        prio = priority_for(wr.risk_level, dept_level)
        action = (
            f"Mandatory {wr.most_common_violation_type} compliance re-training"
            if wr.most_common_violation_type
            else "Mandatory PPE compliance re-training"
        )
        wr.recommendations.append(
            Recommendation(
                priority=prio,
                target_type="worker",
                target_name=wr.worker_name,
                action=action,
                owner="site supervisor",
                deadline_days=_DEADLINE_DAYS[prio],
                trigger=(
                    f"{wr.max_same_violation_repeat_count}× {wr.most_common_violation_type} "
                    f"in {selected_month}"
                ),
            )
        )

    high_risk = [wr for wr in worker_risks if wr.risk_level == "high"]
    medium_risk = [wr for wr in worker_risks if wr.risk_level == "medium"]

    # Top-level recommendations: department recs + worker recs, ordered P1→P3.
    top_recs: list[Recommendation] = [d.recommendation for d in department_summary if d.recommendation]
    for wr in worker_risks:
        top_recs.extend(wr.recommendations)
    top_recs.sort(key=lambda r: r.priority)

    # ── Month-to-month comparison (overall) ──
    current_total_violations = sum(wr.total_violations for wr in worker_risks)
    current_total_fine = round(sum(wr.total_fine_amount for wr in worker_risks), 2)
    baseline_month_violations = []
    baseline_month_fines = []
    for m in prior_months:
        mv = sum(sum(w["months"].get(m, {}).get("types", {}).values()) for w in workers.values())
        mf = sum(w["months"].get(m, {}).get("amount", 0.0) for w in workers.values())
        baseline_month_violations.append(mv)
        baseline_month_fines.append(mf)
    baseline_avg_violations = round(sum(baseline_month_violations) / 3, 2)
    baseline_avg_fine = round(sum(baseline_month_fines) / 3, 2)

    if baseline_avg_violations == 0:
        trend = "worsened" if current_total_violations > 0 else "stable"
    elif current_total_violations > baseline_avg_violations * 1.05:
        trend = "worsened"
    elif current_total_violations < baseline_avg_violations * 0.95:
        trend = "improved"
    else:
        trend = "stable"

    comparison = MonthComparison(
        current_total_violations=current_total_violations,
        baseline_avg_violations=baseline_avg_violations,
        current_total_fine_amount=current_total_fine,
        baseline_avg_fine_amount=baseline_avg_fine,
        trend=trend,
    )

    return RiskAnalysisResponse(
        selected_month=selected_month,
        status="success",
        message=None,
        total_workers_with_fines=len(worker_risks),
        high_risk_workers=high_risk,
        medium_risk_workers=medium_risk,
        department_summary=department_summary,
        recommendations=top_recs,
        month_to_month_comparison=comparison,
        generated_at=generated_at,
    )


# ── Endpoint 2: Save audit log ─────────────────────────────────────────────────


@router.post("/risk-analysis-log", response_model=RiskAnalysisLogResponse)
async def save_risk_analysis_log(
    payload: RiskAnalysisLogCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _auth: None = Depends(require_n8n_api_key),
):
    _parse_month(payload.month)

    # Idempotency on (month, n8n_execution_id): same pair → return existing (200),
    # new pair → create (201). A different execution_id for the same month is a
    # distinct run and creates a new log.
    existing = (
        await db.execute(
            select(PayrollRiskAnalysisLog).where(
                PayrollRiskAnalysisLog.month == payload.month,
                PayrollRiskAnalysisLog.n8n_execution_id == payload.n8n_execution_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        response.status_code = status.HTTP_200_OK
        out = RiskAnalysisLogResponse.model_validate(existing)
        out.already_exists = True
        return out

    log = PayrollRiskAnalysisLog(
        n8n_execution_id=payload.n8n_execution_id,
        month=payload.month,
        status=payload.status,
        total_workers_analyzed=payload.total_workers_analyzed,
        high_risk_workers_count=payload.high_risk_workers_count,
        medium_risk_workers_count=payload.medium_risk_workers_count,
        total_violations=payload.total_violations,
        total_fine_amount=payload.total_fine_amount,
        trend=payload.trend,
        recommendations_count=payload.recommendations_count,
        response_snapshot_json=payload.response_snapshot_json,
        backend_version=payload.backend_version or BACKEND_VERSION,
        error_message=payload.error_message,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    response.status_code = status.HTTP_201_CREATED
    out = RiskAnalysisLogResponse.model_validate(log)
    out.already_exists = False
    return out


# ── Endpoint 3: History (frontend — existing admin JWT auth) ───────────────────


@router.get("/risk-analysis-history", response_model=list[RiskAnalysisLogResponse])
async def risk_analysis_history(
    limit: int = Query(10, ge=1, le=50),
    month: Optional[str] = Query(None, description="YYYY-MM; filter to one month"),
    db: AsyncSession = Depends(get_db),
    _user: dict = Depends(verify_supabase_token),
):
    stmt = select(PayrollRiskAnalysisLog)
    if month is not None:
        _parse_month(month)  # validates format (400 on bad input)
        stmt = stmt.where(PayrollRiskAnalysisLog.month == month)
    rows = (
        await db.execute(
            stmt.order_by(PayrollRiskAnalysisLog.created_at.desc()).limit(limit)
        )
    ).scalars().all()
    return [RiskAnalysisLogResponse.model_validate(r) for r in rows]
