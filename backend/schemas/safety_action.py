from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

SafetyActionPriority = Literal["P1", "P2", "P3"]
SafetyActionStatus = Literal["pending", "completed", "escalated"]


class HighRiskWorkerAction(BaseModel):
    worker_id: int
    risk_reason: str = Field(..., min_length=1)
    suggested_priority: SafetyActionPriority = "P2"
    action_title: Optional[str] = Field(default=None, max_length=255)


class CreateSafetyActionsRequest(BaseModel):
    log_id: int
    month: str = Field(..., description="YYYY-MM")
    high_risk_workers: list[HighRiskWorkerAction] = Field(default_factory=list)


class CreateSafetyActionsResponse(BaseModel):
    created: int
    skipped_duplicates: int
    task_ids: list[int] = Field(default_factory=list)


class EscalateSafetyActionsResponse(BaseModel):
    escalated_count: int


class CompleteSafetyActionRequest(BaseModel):
    completion_notes: Optional[str] = None


class SafetyActionTaskResponse(BaseModel):
    id: int
    worker_name: str
    worker_id: int
    month: str
    action_title: str
    priority: SafetyActionPriority
    status: SafetyActionStatus
    deadline_date: date
    risk_reason: str
    escalated_at: Optional[datetime] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    completed_by_admin_id: Optional[str] = None
    completion_notes: Optional[str] = None


class SafetyActionTaskListResponse(BaseModel):
    tasks: list[SafetyActionTaskResponse] = Field(default_factory=list)
