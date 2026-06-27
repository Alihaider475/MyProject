from __future__ import annotations

from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class WorkerCreate(BaseModel):
    employee_id: str
    name: str
    department: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    base_salary: float = 0.0


class WorkerUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    base_salary: Optional[float] = None
    is_active: Optional[bool] = None


class WorkerResponse(BaseModel):
    id: int
    employee_id: str
    name: str
    department: Optional[str]
    phone_number: Optional[str]
    email: Optional[str]
    base_salary: float = 0.0
    has_face_enrolled: bool
    has_face_photo: bool = False
    is_active: bool = True
    created_at: datetime
    violation_count: int = 0
    total_fines: float = 0.0

    model_config = {"from_attributes": True}
