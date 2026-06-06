from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.alerts.mqtt_handler import MQTTHandler
from backend.detection.violation_checker import ViolationEvent

SETTINGS_PATH = "app.alerts.mqtt_handler.settings"
CLIENT_PATH = "app.alerts.mqtt_handler.mqtt.Client"


def make_violation() -> ViolationEvent:
    return ViolationEvent(
        camera_id=1,
        violation_type="NO-Hardhat",
        confidence=0.91,
        frame_path="frames/cam1.jpg",
    )


def make_settings(broker: str = "localhost") -> MagicMock:
    cfg = MagicMock()
    cfg.MQTT_BROKER = broker
    cfg.MQTT_PORT = 1883
    cfg.MQTT_TOPIC = "ppe/violations/camera_{camera_id}"
    cfg.MQTT_USERNAME = ""
    cfg.MQTT_PASSWORD = ""
    cfg.MQTT_CLIENT_ID = "ppe-test"
    cfg.MQTT_QOS = 1
    cfg.MQTT_KEEPALIVE = 60
    cfg.MQTT_RETRY_COUNT = 3
    cfg.MQTT_RETRY_DELAY = 5.0
    return cfg


def _make_executor_that_calls_fn() -> MagicMock:
    """Returns a mock loop whose run_in_executor calls _publish synchronously."""
    mock_loop = MagicMock()

    async def fake_executor(executor, func):
        func()
        return None

    mock_loop.run_in_executor = fake_executor
    return mock_loop


def _make_executor_that_raises(exc_type: type[Exception] = ConnectionRefusedError) -> MagicMock:
    """Returns a mock loop whose run_in_executor always raises; tracks call count."""
    mock_loop = MagicMock()
    call_count = [0]

    async def fake_executor(executor, func):
        call_count[0] += 1
        raise exc_type("simulated broker failure")

    mock_loop.run_in_executor = fake_executor
    mock_loop._call_count = call_count
    return mock_loop


@pytest.fixture(autouse=True)
def fast_retry(monkeypatch):
    """Zero retry delay so tests don't actually sleep."""
    monkeypatch.setattr("app.alerts.mqtt_handler.asyncio.sleep", AsyncMock())


# ── test 1 ───────────────────────────────────────────────────────────────────


async def test_skipped_when_broker_empty():
    """Returns False and never calls run_in_executor when MQTT_BROKER is blank."""
    handler = MQTTHandler()
    mock_settings = make_settings(broker="")
    mock_loop = MagicMock()
    mock_loop.run_in_executor = AsyncMock()

    with patch(SETTINGS_PATH, mock_settings), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is False
    mock_loop.run_in_executor.assert_not_called()


# ── test 2 ───────────────────────────────────────────────────────────────────


async def test_correct_json_payload_fields():
    """Payload contains camera_id, violation_type, confidence, ISO timestamp, severity=HIGH."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    mock_client = MagicMock()
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is True
    _, kwargs = mock_client.publish.call_args
    payload = json.loads(kwargs["payload"])
    assert payload["camera_id"] == 1
    assert payload["violation_type"] == "NO-Hardhat"
    assert isinstance(payload["confidence"], float)
    assert "T" in payload["timestamp"] and payload["timestamp"].endswith("Z")
    assert payload["severity"] == "HIGH"


# ── test 3 ───────────────────────────────────────────────────────────────────


async def test_publish_runs_in_executor():
    """loop.run_in_executor is called at least once (not a direct paho call)."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    executor_calls: list = []

    mock_loop = MagicMock()

    async def tracking_executor(executor, func):
        executor_calls.append(func)
        func()
        return None

    mock_loop.run_in_executor = tracking_executor

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=MagicMock()), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    assert len(executor_calls) >= 1


# ── test 4 ───────────────────────────────────────────────────────────────────


async def test_retry_fires_on_failure():
    """run_in_executor is called MQTT_RETRY_COUNT times when it always fails."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    mock_settings.MQTT_RETRY_COUNT = 3
    mock_loop = _make_executor_that_raises()

    with patch(SETTINGS_PATH, mock_settings), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is False
    assert mock_loop._call_count[0] == 3


# ── test 5 ───────────────────────────────────────────────────────────────────


async def test_disconnect_called_after_publish():
    """client.disconnect() is called even when client.connect raises (finally block)."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    mock_settings.MQTT_RETRY_COUNT = 1
    mock_client = MagicMock()
    mock_client.connect.side_effect = ConnectionRefusedError("no broker")
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    assert mock_client.disconnect.called


# ── test 6 ───────────────────────────────────────────────────────────────────


async def test_exception_does_not_propagate():
    """send() returns False instead of raising when all attempts fail."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    mock_settings.MQTT_RETRY_COUNT = 2
    mock_loop = _make_executor_that_raises(RuntimeError)

    with patch(SETTINGS_PATH, mock_settings), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())  # must not raise

    assert result is False


# ── test 7 ───────────────────────────────────────────────────────────────────


async def test_qos_matches_config():
    """client.publish() is called with qos equal to settings.MQTT_QOS."""
    handler = MQTTHandler()
    mock_settings = make_settings()
    mock_settings.MQTT_QOS = 2
    mock_client = MagicMock()
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.mqtt_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is True
    _, kwargs = mock_client.publish.call_args
    assert kwargs["qos"] == 2
