from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.alerts.base import AlertHandler, AlertResult
from backend.alerts.dispatcher import AlertDispatcher, build_dispatcher
from backend.detection.violation_checker import ViolationEvent


def make_violation(camera_id: int = 1) -> ViolationEvent:
    return ViolationEvent(
        camera_id=camera_id,
        violation_type="NO-Hardhat",
        confidence=0.85,
    )


class SuccessHandler(AlertHandler):
    handler_type = "success"

    def __init__(self):
        self.called = False

    async def send(self, violation: ViolationEvent) -> bool:
        self.called = True
        return True


class FailHandler(AlertHandler):
    handler_type = "fail"

    def __init__(self):
        self.called = False

    async def send(self, violation: ViolationEvent) -> bool:
        self.called = True
        return False


class ErrorHandler(AlertHandler):
    handler_type = "error"

    def __init__(self):
        self.called = False

    async def send(self, violation: ViolationEvent) -> bool:
        self.called = True
        raise RuntimeError("simulated error")


async def test_dispatcher_calls_all_handlers():
    h1, h2 = SuccessHandler(), SuccessHandler()
    dispatcher = AlertDispatcher([h1, h2])
    await dispatcher.dispatch(make_violation())
    assert h1.called
    assert h2.called


async def test_failing_handler_does_not_block_others():
    fail = FailHandler()
    success = SuccessHandler()
    dispatcher = AlertDispatcher([fail, success])
    await dispatcher.dispatch(make_violation())
    assert fail.called
    assert success.called


async def test_error_handler_does_not_block_others():
    err = ErrorHandler()
    success = SuccessHandler()
    dispatcher = AlertDispatcher([err, success])
    # Should not raise
    await dispatcher.dispatch(make_violation())
    assert err.called
    assert success.called


async def test_empty_dispatcher():
    dispatcher = AlertDispatcher([])
    # Should not raise
    await dispatcher.dispatch(make_violation())


class SkipHandler(AlertHandler):
    handler_type = "skip"

    def __init__(self):
        self.called = False

    async def send(self, violation: ViolationEvent) -> AlertResult:
        self.called = True
        return AlertResult.skipped("not configured")


async def test_skipped_handler_is_not_a_failure(caplog):
    """A skipped channel must not produce a failure warning."""
    skip = SkipHandler()
    dispatcher = AlertDispatcher([skip])
    with caplog.at_level("WARNING"):
        await dispatcher.dispatch_non_db(make_violation())
    assert skip.called
    assert not any("failed" in r.message.lower() for r in caplog.records)


async def test_alert_log_rows_written_per_channel():
    """One AlertLog row is written per external channel, including skips."""
    violation = make_violation()
    violation.violation_id = 42

    session = MagicMock()
    session.add = MagicMock()
    session.commit = AsyncMock()
    session_cm = MagicMock()
    session_cm.__aenter__.return_value = session

    dispatcher = AlertDispatcher([SuccessHandler(), SkipHandler()])
    with patch("backend.database.connection.AsyncSessionLocal", return_value=session_cm):
        await dispatcher.dispatch_non_db(violation)

    assert session.add.call_count == 2
    session.commit.assert_awaited_once()
    statuses = {
        (log.handler_type, log.success, log.error_msg)
        for (log,), _ in session.add.call_args_list
    }
    assert ("success", True, None) in statuses
    assert ("skip", True, "skipped: not configured") in statuses


async def test_alert_log_failure_does_not_propagate():
    """An AlertLog write failure must never break dispatch."""
    violation = make_violation()
    violation.violation_id = 42
    success = SuccessHandler()

    dispatcher = AlertDispatcher([success])
    with patch(
        "backend.database.connection.AsyncSessionLocal",
        side_effect=RuntimeError("db down"),
    ):
        # Must not raise
        await dispatcher.dispatch_non_db(violation)
    assert success.called


async def test_no_alert_log_for_suppressed_violation():
    """No AlertLog rows when the violation was cooldown-suppressed (violation_id=None)."""
    dispatcher = AlertDispatcher([SuccessHandler()])
    with patch("backend.database.connection.AsyncSessionLocal") as session_factory:
        await dispatcher.dispatch_non_db(make_violation())  # violation_id is None
    session_factory.assert_not_called()


async def test_build_dispatcher_registers_channels_unconditionally():
    """Email/webhook/MQTT handlers are registered even with empty config."""
    dispatcher = build_dispatcher(include_db=False, include_fine=False)
    types = {h.handler_type for h in dispatcher.handlers}
    assert {"email", "webhook", "mqtt"} <= types
    assert all(h.handler_type != "db" for h in dispatcher.handlers)


async def test_build_dispatcher_includes_db_by_default():
    dispatcher = build_dispatcher()
    assert dispatcher._db_handler is not None
