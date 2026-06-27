from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class AlertLogResponse(BaseModel):
    id: int
    violation_id: int
    handler_type: str
    sent_at: datetime
    success: bool
    error_msg: Optional[str]

    model_config = {"from_attributes": True}


class AlertLogItem(AlertLogResponse):
    status: str  # "sent" | "skipped" | "failed" (derived from success + error_msg)
    violation_type: Optional[str] = None
    camera_id: Optional[int] = None


class AlertLogListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[AlertLogItem]
