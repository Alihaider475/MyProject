from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ── Risk analysis response (GET /risk-analysis) ────────────────────────────────


class Recommendation(BaseModel):
    priority: Literal["P1", "P2", "P3"]
    target_type: Literal["worker", "department"]
    target_name: str
    action: str
    owner: str
    deadline_days: int
    trigger: str


class WorkerRisk(BaseModel):
    worker_id: int
    worker_name: str
    employee_id: str
    department: Optional[str] = None
    total_violations: int
    total_fine_amount: float
    most_common_violation_type: Optional[str] = None
    max_same_violation_repeat_count: int
    previous_3_month_avg_violations: float
    previous_3_month_avg_fine_amount: float
    violation_change_percentage: Optional[float] = None
    fine_change_percentage: Optional[float] = None
    risk_score: float
    risk_level: Literal["high", "medium", "normal"]
    risk_reasons: list[str] = []
    recommendations: list[Recommendation] = []


class DepartmentRisk(BaseModel):
    department: str
    total_workers_involved: int
    total_violations: int
    total_fine_amount: float
    most_common_violation_type: Optional[str] = None
    risk_score: float
    risk_level: Literal["high", "medium", "normal"]
    recommendation: Optional[Recommendation] = None


class MonthComparison(BaseModel):
    current_total_violations: int
    baseline_avg_violations: float
    current_total_fine_amount: float
    baseline_avg_fine_amount: float
    trend: Literal["improved", "worsened", "stable"]


class RiskAnalysisResponse(BaseModel):
    selected_month: str
    status: Literal["success", "empty"]
    message: Optional[str] = None
    total_workers_with_fines: int = 0
    high_risk_workers: list[WorkerRisk] = []
    medium_risk_workers: list[WorkerRisk] = []
    department_summary: list[DepartmentRisk] = []
    recommendations: list[Recommendation] = []
    month_to_month_comparison: Optional[MonthComparison] = None
    generated_at: str


# ── Audit log (POST /risk-analysis-log, GET /risk-analysis-history) ────────────


class RiskAnalysisLogCreate(BaseModel):
    n8n_execution_id: str
    month: str = Field(..., description="YYYY-MM")
    status: Literal["success", "empty", "failed"]
    total_workers_analyzed: int = 0
    high_risk_workers_count: int = 0
    medium_risk_workers_count: int = 0
    total_violations: int = 0
    total_fine_amount: float = 0.0
    trend: Optional[Literal["improved", "worsened", "stable"]] = None
    recommendations_count: int = 0
    response_snapshot_json: Optional[Any] = None
    backend_version: Optional[str] = None
    error_message: Optional[str] = None


class RiskAnalysisLogResponse(BaseModel):
    id: int
    n8n_execution_id: str
    month: str
    status: str
    total_workers_analyzed: int
    high_risk_workers_count: int
    medium_risk_workers_count: int
    total_violations: int
    total_fine_amount: float
    trend: Optional[str] = None
    recommendations_count: int
    response_snapshot_json: Optional[Any] = None
    backend_version: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    already_exists: bool = False

    model_config = {"from_attributes": True}
