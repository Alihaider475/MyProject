from __future__ import annotations

import asyncio
import os
import time

import cv2
import numpy as np

from backend.camera.source import CameraSource
from backend.core.logging import get_logger
from backend.schemas.camera import mask_rtsp_credentials

logger = get_logger(__name__)

# Bound how long a blocking RTSP open/read can hang so Start All can't stall the
# server on an unreachable camera. TCP transport is more reliable than UDP for
# most IP cameras; stimeout is in microseconds (5_000_000 = 5s).
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp|stimeout;5000000"
)


class RTSPSource(CameraSource):
    def __init__(self, url: str) -> None:
        self.url = url
        self._cap: cv2.VideoCapture | None = None
        self._connected_at: float | None = None
        self._read_failures = 0
        self._first_frame_logged = False

    def _open(self) -> cv2.VideoCapture:
        """Open the capture with the FFMPEG backend and (where supported) explicit
        open/read timeouts. Runs in an executor thread — never on the event loop."""
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        # FIX: RTSP previously left CAP_PROP_BUFFERSIZE at its default, so OpenCV
        # buffered several frames internally and read_frame() could hand back a
        # stale frame — a secondary cause of bounding boxes lagging behind a
        # moving person. Cap the buffer at 1 (mirrors WebcamSource) so each read
        # returns the freshest available frame. Harmless if the backend ignores it.
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        # These props exist only on newer OpenCV builds; guard with getattr.
        open_to = getattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC", None)
        read_to = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
        if open_to is not None:
            cap.set(open_to, 5000)
        if read_to is not None:
            cap.set(read_to, 5000)
        return cap

    async def connect(self) -> bool:
        loop = asyncio.get_running_loop()
        start = time.perf_counter()
        self._cap = await loop.run_in_executor(None, self._open)
        open_ms = (time.perf_counter() - start) * 1000
        safe_url = mask_rtsp_credentials(self.url)
        if not self._cap.isOpened():
            logger.error("[RTSP_TIMING] open_failed_ms=%.1f url=%s", open_ms, safe_url)
            return False
        self._connected_at = time.perf_counter()
        logger.info("[RTSP_TIMING] open_ms=%.1f url=%s", open_ms, safe_url)
        logger.info("RTSP stream opened: %s", safe_url)
        return True

    async def read_frame(self) -> np.ndarray | None:
        if self._cap is None or not self._cap.isOpened():
            return None
        loop = asyncio.get_running_loop()
        ret, frame = await loop.run_in_executor(None, self._cap.read)
        if ret:
            self._read_failures = 0
            if not self._first_frame_logged:
                elapsed_ms = (
                    (time.perf_counter() - self._connected_at) * 1000
                    if self._connected_at is not None else 0.0
                )
                logger.info("[RTSP_TIMING] first_frame_ms=%.1f", elapsed_ms)
                self._first_frame_logged = True
            return frame
        self._read_failures += 1
        if self._read_failures == 1 or self._read_failures % 30 == 0:
            logger.warning("[RTSP] read failure count=%d", self._read_failures)
        return None

    async def release(self) -> None:
        if self._cap is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, self._cap.release)
            self._cap = None

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
