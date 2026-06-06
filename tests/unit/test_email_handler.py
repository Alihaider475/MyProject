from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.alerts.email_handler import EmailHandler
from backend.detection.violation_checker import ViolationEvent


def make_violation(frame_path: str | None = None) -> ViolationEvent:
    return ViolationEvent(
        camera_id=1,
        violation_type="NO-Hardhat",
        confidence=0.92,
        frame_path=frame_path,
    )


def make_smtp_mock(*, fail_on_connect: bool = False) -> MagicMock:
    """Return a mock aiosmtplib.SMTP instance with async methods."""
    smtp = MagicMock()
    smtp.connect = AsyncMock(side_effect=ConnectionRefusedError("no server") if fail_on_connect else None)
    smtp.starttls = AsyncMock()
    smtp.login = AsyncMock()
    smtp.send_message = AsyncMock()
    smtp.quit = AsyncMock()
    return smtp


# ── helpers ─────────────────────────────────────────────────────────────────

SETTINGS_PATH = "app.alerts.email_handler.settings"


@pytest.fixture(autouse=True)
def fast_retry(monkeypatch):
    """Zero retry delay so tests don't actually sleep."""
    monkeypatch.setattr("app.alerts.email_handler.asyncio.sleep", AsyncMock())


# ── test cases ───────────────────────────────────────────────────────────────


async def test_skipped_when_sender_email_empty():
    """Returns False and never touches SMTP when SENDER_EMAIL is blank."""
    handler = EmailHandler()
    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP") as mock_smtp_cls:
        mock_cfg.SENDER_EMAIL = ""
        mock_cfg.EMAIL_PASSWORD = "secret"
        result = await handler.send(make_violation())

    assert result is False
    mock_smtp_cls.assert_not_called()


async def test_correct_subject_body_fields():
    """Subject uses [PPE ALERT] format; body contains type, confidence, timestamp."""
    handler = EmailHandler()
    smtp_instance = make_smtp_mock()
    captured: list = []

    async def capture_message(msg):
        captured.append(msg)

    smtp_instance.send_message = capture_message

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "sender@example.com"
        mock_cfg.EMAIL_PASSWORD = "pass"
        mock_cfg.RECEIVER_EMAIL = "recv@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = "violation_frames"
        mock_cfg.EMAIL_RETRY_COUNT = 3
        mock_cfg.EMAIL_RETRY_DELAY = 5.0
        result = await handler.send(make_violation())

    assert result is True
    assert len(captured) == 1
    msg = captured[0]
    assert msg["Subject"] == "[PPE ALERT] NO-Hardhat — Camera 1"
    body = msg.get_payload(0).get_payload()
    assert "NO-Hardhat" in body
    assert "92%" in body
    assert "UTC" in body


async def test_snapshot_attached_when_file_exists(tmp_path):
    """MIMEMultipart has 2 parts (body + attachment) when frame file exists."""
    # create a fake frame file
    frame_file = tmp_path / "frame.jpg"
    frame_file.write_bytes(b"\xff\xd8\xff")  # minimal JPEG header

    handler = EmailHandler()
    smtp_instance = make_smtp_mock()
    captured: list = []

    async def capture_message(msg):
        captured.append(msg)

    smtp_instance.send_message = capture_message

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "s@example.com"
        mock_cfg.EMAIL_PASSWORD = "p"
        mock_cfg.RECEIVER_EMAIL = "r@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = str(tmp_path)
        mock_cfg.EMAIL_RETRY_COUNT = 3
        mock_cfg.EMAIL_RETRY_DELAY = 5.0
        result = await handler.send(make_violation(frame_path="frame.jpg"))

    assert result is True
    assert len(captured[0].get_payload()) == 2  # text + attachment


async def test_no_attachment_when_snapshot_missing():
    """send() returns True and sends 1-part email when frame file does not exist."""
    handler = EmailHandler()
    smtp_instance = make_smtp_mock()
    captured: list = []

    async def capture_message(msg):
        captured.append(msg)

    smtp_instance.send_message = capture_message

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "s@example.com"
        mock_cfg.EMAIL_PASSWORD = "p"
        mock_cfg.RECEIVER_EMAIL = "r@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = "/nonexistent_dir"
        mock_cfg.EMAIL_RETRY_COUNT = 3
        mock_cfg.EMAIL_RETRY_DELAY = 5.0
        result = await handler.send(make_violation(frame_path="missing.jpg"))

    assert result is True
    assert len(captured[0].get_payload()) == 1  # text only


async def test_retry_fires_on_transient_failure():
    """smtp.connect is called EMAIL_RETRY_COUNT times on repeated connection failures."""
    handler = EmailHandler()
    smtp_instance = make_smtp_mock(fail_on_connect=True)

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "s@example.com"
        mock_cfg.EMAIL_PASSWORD = "p"
        mock_cfg.RECEIVER_EMAIL = "r@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = "violation_frames"
        mock_cfg.EMAIL_RETRY_COUNT = 3
        mock_cfg.EMAIL_RETRY_DELAY = 0.0
        result = await handler.send(make_violation())

    assert result is False
    assert smtp_instance.connect.call_count == 3


async def test_smtp_quit_called_even_on_failure():
    """smtp.quit is called once per attempt regardless of earlier errors."""
    handler = EmailHandler()
    smtp_instance = make_smtp_mock(fail_on_connect=True)

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "s@example.com"
        mock_cfg.EMAIL_PASSWORD = "p"
        mock_cfg.RECEIVER_EMAIL = "r@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = "violation_frames"
        mock_cfg.EMAIL_RETRY_COUNT = 3
        mock_cfg.EMAIL_RETRY_DELAY = 0.0
        await handler.send(make_violation())

    # quit called once per attempt (3 attempts)
    assert smtp_instance.quit.call_count == 3


async def test_exception_does_not_propagate():
    """send() returns False instead of raising when SMTP keeps failing."""
    handler = EmailHandler()
    smtp_instance = make_smtp_mock(fail_on_connect=True)

    with patch(SETTINGS_PATH) as mock_cfg, \
         patch("app.alerts.email_handler.aiosmtplib.SMTP", return_value=smtp_instance):
        mock_cfg.SENDER_EMAIL = "s@example.com"
        mock_cfg.EMAIL_PASSWORD = "p"
        mock_cfg.RECEIVER_EMAIL = "r@example.com"
        mock_cfg.SMTP_HOST = "smtp.example.com"
        mock_cfg.SMTP_PORT = 587
        mock_cfg.FRAMES_DIR = "violation_frames"
        mock_cfg.EMAIL_RETRY_COUNT = 2
        mock_cfg.EMAIL_RETRY_DELAY = 0.0

        # Must not raise
        result = await handler.send(make_violation())

    assert result is False
