from __future__ import annotations

import asyncio
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

from backend.camera.source import CameraSource
from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

_OPEN_TIMEOUT = 8.0  # seconds to wait for webcam open
_RELEASE_TIMEOUT = 3.0  # seconds to wait for thread join on release

# Dedicated, small pool for the blocking cv2.VideoCapture open/join calls below
# — deliberately NOT the default executor (loop.run_in_executor(None, ...))
# that YOLO inference and the rest of the app share. A flaky camera/driver can
# block a worker thread indefinitely (cv2.VideoCapture has no way to cancel an
# in-flight open/read from outside); isolating that risk here means a stuck
# webcam can never starve the shared pool and make unrelated app features
# (detection inference, other cameras) feel "stuck" too.
_webcam_io_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="webcam-io")


def _release_late_open(future) -> None:
    """Done-callback for an _open_cap() call that finished after connect()
    already timed out and gave up — releases the capture object nothing else
    holds a reference to, instead of leaking an open camera handle."""
    try:
        cap = future.result()
    except Exception:
        return
    if cap is not None:
        try:
            cap.release()
        except Exception:
            pass


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
        # cv2.VideoCapture is not safe to call from two threads at once, so
        # this thread is the ONLY place that ever touches self._cap for
        # reading OR releasing — release() (called from the asyncio event
        # loop) never calls self._cap.release() itself; it only signals
        # _stop_event and waits for this thread to exit. Without this, a
        # release() racing an in-flight self._cap.read() on another thread
        # could leave the OS-level camera handle/graph never actually torn
        # down (only killing the process frees it) even though Python's-side
        # bookkeeping looks released.
        try:
            backoff = 0.5
            while not self._stop_event.is_set():
                if self._cap is None or not self._cap.isOpened():
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 5.0)
                    self._try_reopen()
                    continue
                ret, frame = self._cap.read()
                if self._stop_event.is_set():
                    break  # release() was requested while this read() was in flight
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
        finally:
            if self._cap is not None:
                try:
                    self._cap.release()
                except Exception:
                    pass
                self._cap = None
                logger.info("Webcam %d released (reader thread)", self.index)

    async def connect(self) -> bool:
        loop = asyncio.get_running_loop()
        open_future = loop.run_in_executor(_webcam_io_executor, self._open_cap)
        try:
            cap = await asyncio.wait_for(open_future, timeout=_OPEN_TIMEOUT)
        except asyncio.TimeoutError:
            logger.error(
                "Webcam %d open timed out after %.0fs — device may be locked by another process.",
                self.index, _OPEN_TIMEOUT,
            )
            # cv2.VideoCapture(...) can't be interrupted — _open_cap() keeps
            # running in the background past this timeout and may eventually
            # return a real capture object. connect() has already given up by
            # then, so nothing else will ever release it — do that here
            # instead of leaking an open camera handle.
            open_future.add_done_callback(_release_late_open)
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
                    loop.run_in_executor(
                        _webcam_io_executor, lambda: self._thread.join(timeout=_RELEASE_TIMEOUT)
                    ),
                    timeout=_RELEASE_TIMEOUT + 1,
                )
            except (asyncio.TimeoutError, Exception):
                pass
            if self._thread.is_alive():
                # Genuinely stuck inside a blocking hardware read() call —
                # cv2.VideoCapture can't be interrupted from outside, and it
                # is NOT safe to call .release() on it from this thread while
                # the reader thread might still be using it (that race is
                # what used to leave the camera LED on until the whole
                # process was killed). The reader thread releases it itself
                # (see _reader_thread's finally block) once that call
                # eventually returns — this device may stay open until then.
                logger.warning(
                    "Webcam %d reader thread did not exit within %.0fs — it appears "
                    "stuck inside a hardware read; the device will be released by "
                    "that thread once the call returns, not here.",
                    self.index, _RELEASE_TIMEOUT,
                )
            else:
                logger.info("Webcam %d reader thread exited cleanly", self.index)
            self._thread = None
        elif self._cap is not None:
            # No reader thread was ever started — nothing else can be using
            # self._cap, so it's safe to release directly here.
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None
            logger.info("Webcam %d released", self.index)

    @property
    def is_open(self) -> bool:
        return self._cap is not None and self._cap.isOpened()
