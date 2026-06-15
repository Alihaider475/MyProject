from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


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


class FineConfigCreate(BaseModel):
    violation_type: str = Field(..., min_length=1, max_length=100)
    fine_amount: float = Field(..., gt=0)
    currency: str = Field("PKR", min_length=1, max_length=10)
    is_active: bool = True


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
    created_at: datetime

    model_config = {"from_attributes": True}


class WaiveBody(BaseModel):
    reason: Optional[str] = None


class WorkerFineTotal(BaseModel):
    worker_id: int
    worker_name: str
    employee_id: str
    total_fines: float
    fine_count: int
    currency: str


class MonthlyReport(BaseModel):
    month: str
    total_amount: float
    workers: list[WorkerFineTotal]
