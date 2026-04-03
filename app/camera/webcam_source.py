from __future__ import annotations

import asyncio

import cv2
import numpy as np

from app.camera.source import CameraSource
from app.core.logging import get_logger

logger = get_logger(__name__)


class WebcamSource(CameraSource):
    def __init__(self, index: int = 0) -> None:
        self.index = index
        self._cap: cv2.VideoCapture | None = None

    async def connect(self) -> bool:
        loop = asyncio.get_event_loop()
        self._cap = await loop.run_in_executor(None, cv2.VideoCapture, self.index)
        if not self._cap.isOpened():
            logger.error("Cannot open webcam index %d", self.index)
            return False
        logger.info("Webcam %d opened", self.index)
        return True

    async def read_frame(self) -> np.ndarray | None:
        if self._cap is None or not self._cap.isOpened():
            return None
        loop = asyncio.get_event_loop()
        ret, frame = await loop.run_in_executor(None, self._cap.read)
        return frame if ret else None

    async def release(self) -> None:
        if self._cap is not None:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._cap.release)
            self._cap = None
            logger.info("Webcam %d released", self.index)

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
