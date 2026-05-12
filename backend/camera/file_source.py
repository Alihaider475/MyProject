from __future__ import annotations

import asyncio

import cv2
import numpy as np

from backend.camera.source import CameraSource
from backend.core.logging import get_logger

logger = get_logger(__name__)


class FileSource(CameraSource):
    def __init__(self, path: str, loop_video: bool = True) -> None:
        self.path = path
        self.loop_video = loop_video
        self._cap: cv2.VideoCapture | None = None

    async def connect(self) -> bool:
        loop = asyncio.get_running_loop()
        self._cap = await loop.run_in_executor(None, cv2.VideoCapture, self.path)
        if not self._cap.isOpened():
            logger.error("Cannot open video file: %s", self.path)
            return False
        logger.info("Video file opened: %s", self.path)
        return True

    async def read_frame(self) -> np.ndarray | None:
        if self._cap is None or not self._cap.isOpened():
            return None
        loop = asyncio.get_running_loop()
        ret, frame = await loop.run_in_executor(None, self._cap.read)
        if not ret and self.loop_video:
            await loop.run_in_executor(None, self._cap.set, cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = await loop.run_in_executor(None, self._cap.read)
        return frame if ret else None

    async def release(self) -> None:
        if self._cap is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._cap.release)
            self._cap = None

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
