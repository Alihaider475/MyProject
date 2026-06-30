from __future__ import annotations

import asyncio
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.alerts import safety_action_mqtt
from backend.alerts.base import AlertResult

PUBLISH_PATH = "backend.alerts.safety_action_mqtt.publish_mqtt"


async def _drain():
    pending = list(safety_action_mqtt._safety_mqtt_tasks)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def _fake_task(**overrides):
    base = dict(
        id=55,
        worker_id=7,
        action_title="NO-Mask Training",
        priority="P2",
        risk_reason="Repeat NO-Mask violations",
        deadline_date=date(2026, 7, 1),
        created_at=datetime(2026, 6, 1, 9, 0, 0),
        completed_at=datetime(2026, 6, 30, 12, 0, 0),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


async def test_publish_safety_action_created_payload_fields():
    task = _fake_task()
    with patch(PUBLISH_PATH, new=AsyncMock(return_value=AlertResult.sent())) as mock_publish:
        safety_action_mqtt.publish_safety_action_created(task)
        await _drain()

    topics, payload = mock_publish.call_args.args
    assert topics == [safety_action_mqtt.TOPIC_CREATED]
    assert payload == {
        "event_type": "safety_action_created",
        "action_id": 55,
        "worker_id": 7,
        "action_title": "NO-Mask Training",
        "priority": "P2",
        "risk_reason": "Repeat NO-Mask violations",
        "deadline_date": "2026-07-01",
        "created_at": "2026-06-01T09:00:00",
    }


async def test_publish_safety_action_completed_payload_fields():
    task = _fake_task()
    with patch(PUBLISH_PATH, new=AsyncMock(return_value=AlertResult.sent())) as mock_publish:
        safety_action_mqtt.publish_safety_action_completed(task, "Abid", "admin@example.com")
        await _drain()

    topics, payload = mock_publish.call_args.args
    assert topics == [safety_action_mqtt.TOPIC_COMPLETED]
    assert payload == {
        "event_type": "safety_action_completed",
        "action_id": 55,
        "worker_id": 7,
        "worker_name": "Abid",
        "action_type": "NO-Mask Training",
        "completed_at": "2026-06-30T12:00:00",
        "completed_by": "admin@example.com",
    }


@pytest.mark.parametrize(
    "status,expected_result",
    [
        ("effective", "training_worked"),
        ("partially_effective", "training_partially_worked"),
        ("not_effective", "training_not_worked"),
        ("no_after_data", "insufficient_data"),
        ("some_unexpected_future_status", "insufficient_data"),
    ],
)
async def test_effectiveness_status_mapping(status, expected_result):
    with patch(PUBLISH_PATH, new=AsyncMock(return_value=AlertResult.sent())) as mock_publish:
        safety_action_mqtt.publish_safety_action_effectiveness(
            task_id=55,
            worker_id=7,
            worker_name="Abid",
            action_type="NO-Mask",
            before_count=126,
            after_count=0,
            improvement_pct=100.0,
            status=status,
        )
        await _drain()

    topics, payload = mock_publish.call_args.args
    assert topics == [safety_action_mqtt.TOPIC_EFFECTIVENESS]
    assert payload["event_type"] == "effectiveness_result"
    assert payload["before_training_violations"] == 126
    assert payload["after_training_violations"] == 0
    assert payload["result"] == expected_result


async def test_publish_failure_does_not_raise():
    task = _fake_task()
    with patch(PUBLISH_PATH, new=AsyncMock(side_effect=RuntimeError("broker down"))):
        safety_action_mqtt.publish_safety_action_completed(task, "Abid", "admin@example.com")
        # Must not raise even though the underlying publish_mqtt call failed —
        # the fire-and-forget task swallows it (asyncio.gather with
        # return_exceptions=True below proves it never propagates).
        await _drain()
