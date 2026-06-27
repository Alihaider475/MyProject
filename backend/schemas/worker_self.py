from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class WorkerDashboardResponse(BaseModel):
    worker_name: str
    employee_id: str
    department: Optional[str] = None
    base_salary: float
    total_violations: int
    pending_fine_amount: float
    paid_fine_amount: float
    deducted_fine_amount: float
    waived_fine_amount: float
    net_salary: float
    salary_fully_offset: bool
    month: str
