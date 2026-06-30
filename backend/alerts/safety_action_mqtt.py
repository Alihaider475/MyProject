from __future__ import annotations

import asyncio
from datetime import date, datetime
from typing import Optional

from backend.alerts.mqtt_handler import publish_mqtt
from backend.core.logging import get_logger

logger = get_logger(__name__)

TOPIC_CREATED = "safesite/safety-actions/created"
TOPIC_COMPLETED = "safesite/safety-actions/completed"
TOPIC_EFFECTIVENESS = "safesite/safety-actions/effectiveness-result"

# Maps the backend's EffectivenessStatus values to the MQTT payload's `result`
# field. Kept separate from the DB-backed status so the DB CHECK constraint
# and existing API/UI contracts never need to change.
_EFFECTIVENESS_RESULT_MAP: dict[str, str] = {
    "effective": "training_worked",
    "partially_effective": "training_partially_worked",
    "not_effective": "training_not_worked",
    "no_after_data": "insufficient_data",
}

# Keep references to fire-and-forget publish tasks so they aren't GC'd before
# they finish (asyncio holds only weak references to running tasks).
_safety_mqtt_tasks: set[asyncio.Task] = set()


def _fire(coro, *, name: str) -> None:
    task = asyncio.create_task(coro, name=name)
    _safety_mqtt_tasks.add(task)
    task.add_done_callback(_safety_mqtt_tasks.discard)


def _iso(value: Optional[datetime | date]) -> Optional[str]:
    return value.isoformat() if value is not None else None


def publish_safety_action_created(task) -> None:
    """Fire-and-forget MQTT publish for one newly created SafetyActionTask row."""
    payload = {
        "event_type": "safety_action_created",
        "action_id": task.id,
        "worker_id": task.worker_id,
        "action_title": task.action_title,
        "priority": task.priority,
        "risk_reason": task.risk_reason,
        "deadline_date": _iso(task.deadline_date),
        "created_at": _iso(task.created_at),
    }
    _fire(
        publish_mqtt([TOPIC_CREATED], payload, log_context=f"safety-action-created id={task.id}"),
        name=f"mqtt-safety-created-{task.id}",
    )


def publish_safety_action_completed(task, worker_name: str, completed_by: Optional[str]) -> None:
    """Fire-and-forget MQTT publish when an admin marks a task completed."""
    payload = {
        "event_type": "safety_action_completed",
        "action_id": task.id,
        "worker_id": task.worker_id,
        "worker_name": worker_name,
        "action_type": task.action_title,
        "completed_at": _iso(task.completed_at),
        "completed_by": completed_by,
    }
    _fire(
        publish_mqtt([TOPIC_COMPLETED], payload, log_context=f"safety-action-completed id={task.id}"),
        name=f"mqtt-safety-completed-{task.id}",
    )


def publish_safety_action_effectiveness(
    *,
    task_id: int,
    worker_id: int,
    worker_name: str,
    action_type: str,
    before_count: int,
    after_count: int,
    improvement_pct: Optional[float],
    status: str,
) -> None:
    """Fire-and-forget MQTT publish for one reviewed effectiveness result."""
    payload = {
        "event_type": "effectiveness_result",
        "action_id": task_id,
        "worker_id": worker_id,
        "worker_name": worker_name,
        "action_type": action_type,
        "before_training_violations": before_count,
        "after_training_violations": after_count,
        "improvement_percentage": improvement_pct,
        "result": _EFFECTIVENESS_RESULT_MAP.get(status, "insufficient_data"),
    }
    _fire(
        publish_mqtt(
            [TOPIC_EFFECTIVENESS], payload, log_context=f"effectiveness-result task={task_id}"
        ),
        name=f"mqtt-safety-effectiveness-{task_id}",
    )
