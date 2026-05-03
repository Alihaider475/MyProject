from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ViolationResponse(BaseModel):
    id: int
    camera_id: int
    violation_type: str
    confidence: float
    timestamp: datetime
    frame_path: Optional[str]
    frame_url: Optional[str] = None
    resolved_at: Optional[datetime] = None
    is_resolved: bool = False
    is_false_positive: bool = False

    model_config = {"from_attributes": True}


class ViolationListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ViolationResponse]
