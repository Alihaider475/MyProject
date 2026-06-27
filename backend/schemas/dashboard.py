from __future__ import annotations

from typing import Any
from pydantic import BaseModel


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
