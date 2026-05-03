from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.alerts.plc_handler import PLCHandler
from app.core.violation_checker import ViolationEvent

SETTINGS_PATH = "app.alerts.plc_handler.settings"
CLIENT_PATH = "app.alerts.plc_handler.ModbusTcpClient"


def make_violation() -> ViolationEvent:
    return ViolationEvent(
        camera_id=1,
        violation_type="NO-Hardhat",
        confidence=0.91,
        frame_path="frames/cam1.jpg",
    )


def make_settings(plc_host: str = "192.168.1.100") -> MagicMock:
    cfg = MagicMock()
    cfg.PLC_HOST = plc_host
    cfg.PLC_PORT = 502
    cfg.PLC_UNIT_ID = 1
    cfg.PLC_COIL_ADDRESS = 0
    cfg.PLC_COIL_DURATION = 5.0
    cfg.PLC_TIMEOUT = 3
    cfg.PLC_RETRY_COUNT = 3
    cfg.PLC_RETRY_DELAY = 5.0
    return cfg


def _ok_result() -> MagicMock:
    r = MagicMock()
    r.isError.return_value = False
    return r


def _err_result() -> MagicMock:
    r = MagicMock()
    r.isError.return_value = True
    return r


def _make_executor_that_calls_fn() -> MagicMock:
    """Returns a mock loop whose run_in_executor calls func synchronously."""
    mock_loop = MagicMock()

    async def fake_executor(executor, func):
        func()
        return None

    mock_loop.run_in_executor = fake_executor
    return mock_loop


@pytest.fixture(autouse=True)
def fast_retry(monkeypatch) -> AsyncMock:
    """Zero retry/coil delay so tests don't actually sleep. Returns mock for inspection."""
    mock = AsyncMock()
    monkeypatch.setattr("app.alerts.plc_handler.asyncio.sleep", mock)
    return mock


# ── test 1 ───────────────────────────────────────────────────────────────────


async def test_skipped_when_plc_host_empty():
    """Returns False and never calls run_in_executor when PLC_HOST is blank."""
    handler = PLCHandler()
    mock_settings = make_settings(plc_host="")
    mock_loop = MagicMock()
    mock_loop.run_in_executor = AsyncMock()

    with patch(SETTINGS_PATH, mock_settings), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is False
    mock_loop.run_in_executor.assert_not_called()


# ── test 2 ───────────────────────────────────────────────────────────────────


async def test_correct_coil_address_used():
    """client.write_coil() is called with PLC_COIL_ADDRESS for both HIGH and LOW."""
    handler = PLCHandler()
    mock_settings = make_settings()
    mock_settings.PLC_COIL_ADDRESS = 7
    mock_client = MagicMock()
    mock_client.connect.return_value = True
    mock_client.write_coil.return_value = _ok_result()
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is True
    calls = mock_client.write_coil.call_args_list
    assert calls[0][0][0] == 7  # HIGH call uses coil address 7
    assert calls[1][0][0] == 7  # LOW call uses coil address 7


# ── test 3 ───────────────────────────────────────────────────────────────────


async def test_modbus_calls_run_in_executor():
    """loop.run_in_executor is called at least once — no direct pymodbus calls."""
    handler = PLCHandler()
    executor_calls: list = []

    mock_loop = MagicMock()

    async def tracking_executor(executor, func):
        executor_calls.append(func)
        func()
        return None

    mock_loop.run_in_executor = tracking_executor
    mock_client = MagicMock()
    mock_client.connect.return_value = True
    mock_client.write_coil.return_value = _ok_result()

    with patch(SETTINGS_PATH, make_settings()), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    assert len(executor_calls) >= 1


# ── test 4 ───────────────────────────────────────────────────────────────────


async def test_coil_high_before_sleep_low_after(fast_retry: AsyncMock):
    """Sequence: HIGH write → sleep → LOW write (order verified)."""
    handler = PLCHandler()
    mock_settings = make_settings()
    sequence: list[str] = []

    mock_client = MagicMock()
    mock_client.connect.return_value = True

    def write_coil_track(addr, value, slave=1):
        sequence.append("HIGH" if value else "LOW")
        return _ok_result()

    mock_client.write_coil.side_effect = write_coil_track
    fast_retry.side_effect = lambda _: sequence.append("sleep")
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    assert sequence == ["HIGH", "sleep", "LOW"]


# ── test 5 ───────────────────────────────────────────────────────────────────


async def test_retry_fires_on_connection_failure():
    """Connect is retried PLC_RETRY_COUNT times when client.connect() always returns False."""
    handler = PLCHandler()
    mock_settings = make_settings()
    mock_settings.PLC_RETRY_COUNT = 3
    mock_client = MagicMock()
    mock_client.connect.return_value = False  # always fails
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())

    assert result is False
    assert mock_client.connect.call_count == 3


# ── test 6 ───────────────────────────────────────────────────────────────────


async def test_connection_closed_in_finally():
    """client.close() is called even when HIGH write_coil fails."""
    handler = PLCHandler()
    mock_settings = make_settings()
    mock_client = MagicMock()
    mock_client.connect.return_value = True
    mock_client.write_coil.return_value = _err_result()  # HIGH fails → finally still runs
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    assert mock_client.close.called


# ── test 7 ───────────────────────────────────────────────────────────────────


async def test_low_written_even_when_high_fails():
    """LOW write_coil is attempted even when HIGH write_coil returns isError()=True."""
    handler = PLCHandler()
    mock_settings = make_settings()
    mock_client = MagicMock()
    mock_client.connect.return_value = True
    mock_client.write_coil.side_effect = [_err_result(), _ok_result()]
    mock_loop = _make_executor_that_calls_fn()

    with patch(SETTINGS_PATH, mock_settings), \
         patch(CLIENT_PATH, return_value=mock_client), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        await handler.send(make_violation())

    calls = mock_client.write_coil.call_args_list
    assert len(calls) == 2
    assert calls[1][0][1] is False  # second call is LOW (False)


# ── test 8 ───────────────────────────────────────────────────────────────────


async def test_exception_does_not_propagate():
    """send() returns False instead of raising when all PLC operations fail."""
    handler = PLCHandler()
    mock_settings = make_settings()
    mock_settings.PLC_RETRY_COUNT = 2
    mock_loop = MagicMock()

    async def always_raises(executor, func):
        raise RuntimeError("simulated PLC crash")

    mock_loop.run_in_executor = always_raises

    with patch(SETTINGS_PATH, mock_settings), \
         patch("app.alerts.plc_handler.asyncio.get_running_loop", return_value=mock_loop):
        result = await handler.send(make_violation())  # must not raise

    assert result is False
