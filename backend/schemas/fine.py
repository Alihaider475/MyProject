from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel


class FineConfigResponse(BaseModel):
    id: int
    violation_type: str
    fine_amount: float
    currency: str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: datetime

    model_config = {"from_attributes": True}


class FineConfigUpdate(BaseModel):
    fine_amount: Optional[float] = None
    currency: Optional[str] = None
    is_active: Optional[bool] = None


class FineResponse(BaseModel):
    id: int
    worker_id: int
    violation_id: int
    fine_amount: float
    currency: str
    fine_date: datetime
    challan_number: str
    status: str
    deduction_month: Optional[str]
    waive_reason: Optional[str] = None
    payment_method: Optional[str] = None
    paid_at: Optional[datetime] = None
    settled_at: Optional[datetime] = None
    settlement_notes: Optional[str] = None
    settled_by: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WaiveBody(BaseModel):
    reason: Optional[str] = None


class SettleFineRequest(BaseModel):
    status: Literal["paid", "deducted", "waived"]
    payment_method: Optional[str] = None
    deduction_month: Optional[str] = None
    waive_reason: Optional[str] = None
    notes: Optional[str] = None


class ViolationBreakdown(BaseModel):
    violation_type: str
    count: int
    amount: float


class WorkerFineTotal(BaseModel):
    worker_id: int
    worker_name: str
    employee_id: str
    total_fines: float
    fine_count: int
    currency: str
    breakdown: list[ViolationBreakdown] = []


class MonthlyReport(BaseModel):
    month: str
    total_amount: float
    workers: list[WorkerFineTotal]
    pending_count: int = 0
    total_pending: float = 0.0
    total_paid: float = 0.0
    total_deducted: float = 0.0
    total_waived: float = 0.0


class FinalizeMonthResponse(BaseModel):
    month: str
    updated_count: int
