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
