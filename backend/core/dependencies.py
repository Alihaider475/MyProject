from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.camera.manager import CameraManager
from backend.detection.detector import PPEDetector
from backend.database.connection import get_db


async def get_session(db: AsyncSession = Depends(get_db)) -> AsyncGenerator[AsyncSession, None]:
    yield db


def get_detector(request: Request) -> PPEDetector:
    return request.app.state.detector


def get_camera_manager(request: Request) -> CameraManager:
    return request.app.state.camera_manager
