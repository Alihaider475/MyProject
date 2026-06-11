from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.alerts.webhook_handler import WebhookHandler
from backend.detection.violation_checker import ViolationEvent

SETTINGS_PATH = "backend.alerts.webhook_handler.settings"
CLIENT_PATH = "backend.alerts.webhook_handler.httpx.AsyncClient"


def make_violation(**overrides) -> ViolationEvent:
    base = dict(
        camera_id=1,
        violation_type="NO-Hardhat",
        confidence=0.88,
        frame_path="camera_1/frame.jpg",
    )
    base.update(overrides)
    return ViolationEvent(**base)


def make_settings(url: str = "https://hooks.example.com/ppe") -> MagicMock:
    cfg = MagicMock()
    cfg.WEBHOOK_URL = url
    cfg.WEBHOOK_TIMEOUT = 10.0
    cfg.WEBHOOK_RETRY_COUNT = 3
    cfg.WEBHOOK_RETRY_DELAY = 0.0
    return cfg


def make_client_cm(post_side_effect: Exception | None = None) -> tuple[MagicMock, MagicMock]:
    """Mock httpx.AsyncClient() usable as an async context manager."""
    client = MagicMock()
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    client.post = AsyncMock(return_value=resp, side_effect=post_side_effect)
    cm = MagicMock()
    cm.__aenter__.return_value = client
    return cm, client


@pytest.fixture(autouse=True)
def fast_retry(monkeypatch):
    """Zero retry delay so tests don't actually sleep."""
    monkeypatch.setattr("backend.alerts.webhook_handler.asyncio.sleep", AsyncMock())


async def test_skipped_when_url_empty():
    """Returns a skipped result and never creates an HTTP client when WEBHOOK_URL is blank."""
    handler = WebhookHandler()
    with patch(SETTINGS_PATH, make_settings(url="")), \
         patch(CLIENT_PATH) as mock_client_cls:
        result = await handler.send(make_violation())

    assert result.status == "skipped"
    mock_client_cls.assert_not_called()


async def test_payload_contains_enriched_fields():
    """JSON payload carries violation, worker, and fine fields."""
    handler = WebhookHandler()
    cm, client = make_client_cm()
    violation = make_violation(
        violation_id=42,
        worker_id=7,
        worker_name="Ali Khan",
        employee_id="EMP-007",
        fine_id=3,
        fine_amount=500.0,
        currency="PKR",
        challan_number="CH-2026-003",
        fine_status="pending",
    )

    with patch(SETTINGS_PATH, make_settings()), \
         patch(CLIENT_PATH, return_value=cm):
        result = await handler.send(violation)

    assert result.status == "sent"
    _, kwargs = client.post.call_args
    payload = kwargs["json"]
    assert payload["violation_id"] == 42
    assert payload["camera_id"] == 1
    assert payload["violation_type"] == "NO-Hardhat"
    assert payload["worker_id"] == 7
    assert payload["worker_name"] == "Ali Khan"
    assert payload["employee_id"] == "EMP-007"
    assert payload["fine_id"] == 3
    assert payload["fine_amount"] == 500.0
    assert payload["currency"] == "PKR"
    assert payload["challan_number"] == "CH-2026-003"
    assert payload["status"] == "pending"
    assert "T" in payload["timestamp"] and payload["timestamp"].endswith("Z")


async def test_retry_fires_on_failure():
    """client.post is attempted WEBHOOK_RETRY_COUNT times on repeated failures."""
    handler = WebhookHandler()
    cm, client = make_client_cm(post_side_effect=ConnectionError("endpoint down"))

    with patch(SETTINGS_PATH, make_settings()), \
         patch(CLIENT_PATH, return_value=cm):
        result = await handler.send(make_violation())

    assert result.status == "failed"
    assert client.post.call_count == 3


async def test_exception_does_not_propagate():
    """send() returns a failed result instead of raising."""
    handler = WebhookHandler()
    cm, _ = make_client_cm(post_side_effect=RuntimeError("boom"))

    with patch(SETTINGS_PATH, make_settings()), \
         patch(CLIENT_PATH, return_value=cm):
        result = await handler.send(make_violation())  # must not raise

    assert result.status == "failed"


async def test_http_error_treated_as_failure():
    """A non-2xx response (raise_for_status raises) yields a failed result."""
    handler = WebhookHandler()
    client = MagicMock()
    resp = MagicMock()
    resp.raise_for_status = MagicMock(side_effect=Exception("500 Server Error"))
    client.post = AsyncMock(return_value=resp)
    cm = MagicMock()
    cm.__aenter__.return_value = client

    with patch(SETTINGS_PATH, make_settings()), \
         patch(CLIENT_PATH, return_value=cm):
        result = await handler.send(make_violation())

    assert result.status == "failed"
