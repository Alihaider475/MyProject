from __future__ import annotations

import logging
import os
from unittest.mock import MagicMock

import pytest

from backend.camera.rtsp_source import RTSPSource

RTSP_WITH_PW = "rtsp://admin:VERIFY123@192.168.100.15:554/ch1/sub"


def test_capture_options_env_is_set():
    # Importing the module sets the FFMPEG capture options (TCP transport + timeout).
    opts = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS", "")
    assert "rtsp_transport;tcp" in opts
    assert "stimeout" in opts


async def test_connect_failure_masks_password_in_logs(monkeypatch, caplog):
    fake_cap = MagicMock()
    fake_cap.isOpened.return_value = False

    captured_args = {}

    def fake_videocapture(url, backend=None):
        captured_args["url"] = url
        captured_args["backend"] = backend
        return fake_cap

    import backend.camera.rtsp_source as rtsp_mod

    monkeypatch.setattr(rtsp_mod.cv2, "VideoCapture", fake_videocapture)
    monkeypatch.setattr(rtsp_mod.cv2, "CAP_FFMPEG", 1900, raising=False)
    # The project logger sets propagate=False; re-enable it so caplog sees records.
    monkeypatch.setattr(rtsp_mod.logger, "propagate", True)

    src = RTSPSource(RTSP_WITH_PW)
    with caplog.at_level(logging.ERROR, logger=rtsp_mod.logger.name):
        ok = await src.connect()

    assert ok is False
    # The FFMPEG backend was requested with the raw URL (OpenCV needs the real creds).
    assert captured_args["url"] == RTSP_WITH_PW
    assert captured_args["backend"] == rtsp_mod.cv2.CAP_FFMPEG
    # But the password must never reach the logs.
    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert "VERIFY123" not in log_text
    assert "***" in log_text


async def test_connect_success_masks_password_in_logs(monkeypatch, caplog):
    fake_cap = MagicMock()
    fake_cap.isOpened.return_value = True

    import backend.camera.rtsp_source as rtsp_mod

    monkeypatch.setattr(
        rtsp_mod.cv2, "VideoCapture", lambda url, backend=None: fake_cap
    )
    monkeypatch.setattr(rtsp_mod.cv2, "CAP_FFMPEG", 1900, raising=False)
    monkeypatch.setattr(rtsp_mod.logger, "propagate", True)

    src = RTSPSource(RTSP_WITH_PW)
    with caplog.at_level(logging.INFO, logger=rtsp_mod.logger.name):
        ok = await src.connect()

    assert ok is True
    log_text = "\n".join(r.getMessage() for r in caplog.records)
    assert "VERIFY123" not in log_text
