from __future__ import annotations

import asyncio

from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)

# Keep references to fire-and-forget alert dispatch tasks so they aren't GC'd
# before they finish (asyncio holds only weak references to running tasks).
_alert_dispatch_tasks: set[asyncio.Task] = set()


def dispatch_alerts_background(event: ViolationEvent, *, name: str | None = None) -> None:
    """Dispatch email/webhook/MQTT alerts for an already-saved violation without
    blocking the caller (API response / detection loop).

    Skips the DB and fine handlers — the violation row already exists and these
    paths (manual fine, file upload) have no worker/fine context. Alert failures
    are isolated inside the dispatcher and can never affect committed records.
    """
    from backend.alerts.dispatcher import build_dispatcher

    dispatcher = build_dispatcher(include_db=False, include_fine=False)
    task = asyncio.create_task(
        dispatcher.dispatch_non_db(event),
        name=name or f"alert-dispatch-{event.violation_id}",
    )
    _alert_dispatch_tasks.add(task)
    task.add_done_callback(_alert_dispatch_tasks.discard)
