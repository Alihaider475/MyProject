from __future__ import annotations

import numpy as np

from backend.camera.source import CameraSource
from backend.core.logging import get_logger

logger = get_logger(__name__)


class BrowserWebcamSource(CameraSource):
    """Frames are pushed in by the /ws/{camera_id}/push WebSocket route instead
    of being pulled from cv2.VideoCapture — this lets a user's own browser
    webcam feed the same detection pipeline as a numeric/RTSP camera, which is
    required in production: the backend runs on a server (e.g. AWS EC2) with
    no physical camera attached, so cv2.VideoCapture(0/1) can only ever open a
    camera on the server itself, never the user's laptop/browser.

    No lock around _latest_frame: push_frame() and read_frame() are both
    coroutines on the single FastAPI event loop with no `await` between the
    read/write of the reference itself, so there's no point at which one can
    interleave mid-assignment with the other (unlike WebcamSource, whose
    reader runs on a real OS thread and genuinely races with the event loop).
    """

    def __init__(self) -> None:
        self._latest_frame: np.ndarray | None = None

    async def connect(self) -> bool:
        return True  # Nothing to open — frames arrive via push_frame().

    async def push_frame(self, frame: np.ndarray) -> None:
        self._latest_frame = frame

    async def read_frame(self) -> np.ndarray | None:
        # Keep returning the latest frame (don't clear to None after reading)
        # so the live feed freezes on the last frame rather than going blank
        # during a brief gap in the browser's push stream.
        return self._latest_frame

    async def release(self) -> None:
        self._latest_frame = None

    @property
    def is_open(self) -> bool:
        # No device to query — the manager's task lifecycle is the real
        # liveness signal here, same as for any other source once running.
        return True
