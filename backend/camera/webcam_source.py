from __future__ import annotations

import asyncio
import sys
import threading
import time

import cv2
import numpy as np

from backend.camera.source import CameraSource
from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

_OPEN_TIMEOUT = 8.0  # seconds to wait for webcam open
_RELEASE_TIMEOUT = 3.0  # seconds to wait for thread join on release


class WebcamSource(CameraSource):
    def __init__(self, index: int = 0) -> None:
        self.index = index
        self._cap: cv2.VideoCapture | None = None
        self._latest_frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        # Latest-frame-only diagnostics (WEBCAM_DEBUG): _unconsumed is True when
        # a captured frame has not yet been read; overwriting it = a stale drop.
        self._unconsumed = False
        self._last_capture_log = 0.0

    def _open_cap(self) -> cv2.VideoCapture | None:
        """Open the capture device and set buffer to 1. Returns None on failure."""
        backends = [cv2.CAP_DSHOW, cv2.CAP_ANY] if sys.platform == "win32" else [cv2.CAP_ANY]
        for backend in backends:
            cap = cv2.VideoCapture(self.index, backend)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, settings.WEBCAM_CAPTURE_WIDTH)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.WEBCAM_CAPTURE_HEIGHT)
                cap.set(cv2.CAP_PROP_FPS, settings.WEBCAM_CAPTURE_FPS)
                # Cameras don't always honor the requested mode — log what we got.
                actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                actual_fps = cap.get(cv2.CAP_PROP_FPS)
                logger.info(
                    "Webcam %d opened (backend=%d) — requested %dx%d@%dfps, got %dx%d@%.0ffps",
                    self.index, backend,
                    settings.WEBCAM_CAPTURE_WIDTH, settings.WEBCAM_CAPTURE_HEIGHT,
                    settings.WEBCAM_CAPTURE_FPS, actual_w, actual_h, actual_fps,
                )
                return cap
            cap.release()
        return None

    def _try_reopen(self) -> None:
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
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
                dropped = self._unconsumed  # previous frame never read → stale drop
                self._latest_frame = frame
                self._unconsumed = True
            if settings.WEBCAM_DEBUG:
                now = time.time()
                if now - self._last_capture_log >= 1.0:  # throttle to ~1/sec
                    self._last_capture_log = now
                    if dropped:
                        logger.info("[CAPTURE] webcam %d stale frame dropped", self.index)
                    else:
                        logger.info("[CAPTURE] webcam %d latest frame updated", self.index)

    async def connect(self) -> bool:
        loop = asyncio.get_running_loop()
        try:
            cap = await asyncio.wait_for(
                loop.run_in_executor(None, self._open_cap),
                timeout=_OPEN_TIMEOUT,
            )
        except asyncio.TimeoutError:
            logger.error(
                "Webcam %d open timed out after %.0fs — device may be locked by another process.",
                self.index, _OPEN_TIMEOUT,
            )
            return False
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
            self._unconsumed = False
            return self._latest_frame

    async def release(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            loop = asyncio.get_running_loop()
            try:
                await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: self._thread.join(timeout=_RELEASE_TIMEOUT)),
                    timeout=_RELEASE_TIMEOUT + 1,
                )
            except (asyncio.TimeoutError, Exception):
                logger.warning("Webcam %d reader thread did not exit cleanly", self.index)
            self._thread = None
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
            logger.info("Webcam %d released", self.index)

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
