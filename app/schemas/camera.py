from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class CameraCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    source_type: Literal["webcam", "rtsp", "file"]
    source_uri: str = Field(..., min_length=1, max_length=500)


class CameraUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    source_uri: Optional[str] = Field(None, min_length=1, max_length=500)


class CameraResponse(BaseModel):
    id: int
    name: str
    source_type: str
    source_uri: str
    is_active: bool
    created_at: datetime
    is_running: bool = False

    model_config = {"from_attributes": True}
