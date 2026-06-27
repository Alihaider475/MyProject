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
    thumbnail_url: Optional[str] = None
    resolved_at: Optional[datetime] = None
    is_resolved: bool = False
    is_false_positive: bool = False
    worker_id: Optional[int] = None
    worker_name: Optional[str] = None
    fine_amount: Optional[float] = None
    track_id: Optional[int] = None
    person_bbox: Optional[list[int]] = None

    model_config = {"from_attributes": True}


class ViolationListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[ViolationResponse]


class AutoIdentifyResponse(BaseModel):
    processed: int
    identified: int
    details: list[dict]
    started: bool = False


class ViolationTypeCount(BaseModel):
    violation_type: str
    count: int


class TopOffenderItem(BaseModel):
    worker_id: Optional[int] = None
    worker_name: Optional[str] = None
    track_id: Optional[int] = None
    camera_id: Optional[int] = None
    display_name: str
    total_violations: int
    violation_types: list[ViolationTypeCount]
    first_seen: datetime
    last_seen: datetime
    cameras_seen: list[int]
    latest_frame_url: Optional[str] = None


class TopOffendersResponse(BaseModel):
    total: int
    items: list[TopOffenderItem]
