from __future__ import annotations

import json
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class CameraCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    source_type: Literal["webcam", "rtsp", "file"]
    source_uri: str = Field(..., min_length=1, max_length=500)
    # Default matches the global DETECTION_CONFIDENCE (0.25) used by the image
    # upload path, so a freshly added camera detects as readily as uploads do.
    # Indoor webcam frames are lower quality; 0.5 silently suppressed detections.
    detection_confidence: float = Field(0.25, ge=0.1, le=1.0)

    @model_validator(mode="after")
    def _validate_uri(self) -> "CameraCreate":
        if self.source_type == "webcam" and not self.source_uri.isdigit():
            raise ValueError(
                f"webcam source_uri must be a numeric index (e.g. '0'), got {self.source_uri!r}"
            )
        elif self.source_type == "rtsp" and not self.source_uri.lower().startswith("rtsp://"):
            raise ValueError(
                f"rtsp source_uri must start with rtsp://, got {self.source_uri!r}"
            )
        return self


class CameraDuplicateRequest(BaseModel):
    """Create N cameras sharing one source_uri (e.g. spin up several tiles
    from a single RTSP URL for the CCTV wall). Bypasses the (source_type,
    source_uri) uniqueness check that CameraCreate enforces, by design."""
    name_prefix: str = Field(..., min_length=1, max_length=90)
    source_type: Literal["webcam", "rtsp", "file"] = "rtsp"
    source_uri: str = Field(..., min_length=1, max_length=500)
    copies: int = Field(..., ge=1, le=20)
    detection_confidence: float = Field(0.25, ge=0.1, le=1.0)

    @model_validator(mode="after")
    def _validate_uri(self) -> "CameraDuplicateRequest":
        if self.source_type == "webcam" and not self.source_uri.isdigit():
            raise ValueError(
                f"webcam source_uri must be a numeric index (e.g. '0'), got {self.source_uri!r}"
            )
        elif self.source_type == "rtsp" and not self.source_uri.lower().startswith("rtsp://"):
            raise ValueError(
                f"rtsp source_uri must start with rtsp://, got {self.source_uri!r}"
            )
        return self


class CameraUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    source_uri: Optional[str] = Field(None, min_length=1, max_length=500)
    detection_confidence: Optional[float] = Field(None, ge=0.1, le=1.0)
    roi_polygon: Optional[list[list[float]]] = None


class CameraResponse(BaseModel):
    id: int
    name: str
    source_type: str
    source_uri: str
    is_active: bool
    detection_confidence: float = 0.25
    roi_polygon: Optional[list[list[float]]] = None
    created_at: datetime
    is_running: bool = False

    @field_validator('roi_polygon', mode='before')
    @classmethod
    def _parse_roi(cls, v: object) -> object:
        if isinstance(v, str):
            return json.loads(v)
        return v

    model_config = {"from_attributes": True}
