from __future__ import annotations

import asyncio
import sys
import threading
import time

import cv2
import numpy as np

from app.camera.source import CameraSource
from app.core.logging import get_logger

logger = get_logger(__name__)


class WebcamSource(CameraSource):
    def __init__(self, index: int = 0) -> None:
        self.index = index
        self._cap: cv2.VideoCapture | None = None
        self._latest_frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _open_cap(self) -> cv2.VideoCapture | None:
        """Open the capture device and set buffer to 1. Returns None on failure."""
        backends = [cv2.CAP_DSHOW, cv2.CAP_ANY] if sys.platform == "win32" else [cv2.CAP_ANY]
        for backend in backends:
            cap = cv2.VideoCapture(self.index, backend)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                logger.info("Webcam %d opened (backend=%d)", self.index, backend)
                return cap
            cap.release()
        return None

    def _try_reopen(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        cap = self._open_cap()
        if cap is not None:
            self._cap = cap

    def _reader_thread(self) -> None:
        backoff = 0.5
        while not self._stop_event.is_set():
            if self._cap is None or not self._cap.isOpened():
                time.sleep(backoff)
                backoff = min(backoff * 2, 5.0)
                self._try_reopen()
                continue
            ret, frame = self._cap.read()
            if not ret or frame is None:
                backoff = min(backoff * 2, 5.0)
                continue
            backoff = 0.5
            with self._lock:
                self._latest_frame = frame

    async def connect(self) -> bool:
        loop = asyncio.get_running_loop()
        cap = await loop.run_in_executor(None, self._open_cap)
        if cap is None:
            logger.error(
                "Cannot open webcam index %d with any backend. "
                "Check: (1) camera is plugged in and not used by another app "
                "(Teams/Zoom/browser), (2) Windows Settings > Privacy & Security > Camera "
                "has 'Let desktop apps access your camera' turned ON.",
                self.index,
            )
            return False
        self._cap = cap
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._reader_thread,
            name=f"webcam-{self.index}-reader",
            daemon=True,
        )
        self._thread.start()
        return True

    async def read_frame(self) -> np.ndarray | None:
        with self._lock:
            f = self._latest_frame
            return f.copy() if f is not None else None

    async def release(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: self._thread.join(timeout=3.0))
            self._thread = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            logger.info("Webcam %d released", self.index)

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
