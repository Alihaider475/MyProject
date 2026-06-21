from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

from backend.detection.violation_checker import ViolationEvent

AlertStatus = Literal["sent", "skipped", "failed"]


@dataclass
class AlertResult:
    """Outcome of a single alert handler run.

    A "skipped" result (disabled channel / missing config) is not a failure —
    it must never surface as a failure warning or break the dispatch pipeline.
    `detail` carries the skip reason or error message and must never contain
    secrets (passwords, tokens, credentials).
    """

    status: AlertStatus
    detail: Optional[str] = None

    @classmethod
    def sent(cls, detail: str | None = None) -> AlertResult:
        return cls("sent", detail)

    @classmethod
    def skipped(cls, reason: str) -> AlertResult:
        return cls("skipped", reason)

    @classmethod
    def failed(cls, error: str) -> AlertResult:
        return cls("failed", error)


def build_alert_payload(violation: ViolationEvent) -> dict:
    """Common JSON-safe payload shared by webhook/MQTT alerts.

    Fields not yet known (e.g. fine data when no fine was applied) are null.
    """
    return {
        "violation_id": violation.violation_id,
        "camera_id": violation.camera_id,
        "violation_type": violation.violation_type,
        "confidence": round(violation.confidence, 4),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "frame_path": violation.frame_path,
        "worker_id": violation.worker_id,
        "worker_name": violation.worker_name,
        "employee_id": violation.employee_id,
        "fine_id": violation.fine_id,
        "fine_amount": violation.fine_amount,
        "currency": violation.currency,
        "challan_number": violation.challan_number,
        "status": violation.fine_status,
        "violation_counts": violation.violation_counts,
    }


class AlertHandler(ABC):
    @property
    @abstractmethod
    def handler_type(self) -> str: ...

    @abstractmethod
    async def send(self, violation: ViolationEvent) -> AlertResult:
        """Send alert. Returns an AlertResult (sent / skipped / failed).

        Must never raise for expected conditions (disabled config, network
        failure) — the dispatcher additionally guards against exceptions.
        """
        ...
