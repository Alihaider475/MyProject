from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from backend.core.detector import Detection
from backend.core.logging import get_logger

logger = get_logger(__name__)

# Maps each violation type → the PPE class that prevents it
VIOLATION_RULES: dict[str, str] = {
    "NO-Hardhat":     "Hardhat",
    "NO-Mask":        "Mask",
    "NO-Safety Vest": "Safety Vest",
}


@dataclass
class ViolationEvent:
    camera_id: int
    violation_type: str
    confidence: float
    frame_path: Optional[str] = None


@dataclass
class _TypeState:
    """Per-camera, per-violation-type timing state."""
    last_safe_time: float = field(default_factory=time.time)
    last_alert_time: float = field(default_factory=lambda: 0.0)


@dataclass
class _CameraState:
    """Holds one _TypeState per violation type for a single camera."""
    _types: dict[str, _TypeState] = field(default_factory=dict)

    def get(self, violation_type: str) -> _TypeState:
        if violation_type not in self._types:
            self._types[violation_type] = _TypeState()
        return self._types[violation_type]


class ViolationChecker:
    """
    Tracks per-camera, per-violation-type state and emits ViolationEvents
    for NO-Hardhat, NO-Mask, and NO-Safety Vest when a person is detected
    without the corresponding PPE for longer than persist_seconds.
    """

    def __init__(self, cooldown_seconds: int = 10, persist_seconds: int = 10) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.persist_seconds = persist_seconds
        self._states: dict[int, _CameraState] = {}

    def _get_state(self, camera_id: int) -> _CameraState:
        if camera_id not in self._states:
            self._states[camera_id] = _CameraState()
        return self._states[camera_id]

    def check(
        self,
        camera_id: int,
        detections: list[Detection],
        frame_path: Optional[str] = None,
    ) -> list[ViolationEvent]:
        """
        Returns a (possibly empty) list of ViolationEvents for this frame.
        One event per PPE type that is currently in violation.
        """
        cam_state = self._get_state(camera_id)
        now = time.time()

        person_detected = any(d.class_name == "Person" for d in detections)
        # Max confidence across all detected persons (used for event confidence)
        person_conf = max(
            (d.confidence for d in detections if d.class_name == "Person"),
            default=0.0,
        )

        events: list[ViolationEvent] = []

        for violation_type, ppe_class in VIOLATION_RULES.items():
            ts = cam_state.get(violation_type)
            ppe_present = any(d.class_name == ppe_class for d in detections)

            # Reset the safe-time clock whenever the PPE is visible
            if ppe_present:
                ts.last_safe_time = now

            if not person_detected or ppe_present:
                continue  # no person, or PPE worn — no violation to check

            time_without_ppe = now - ts.last_safe_time
            time_since_alert = now - ts.last_alert_time

            if (
                time_without_ppe >= self.persist_seconds
                and time_since_alert >= self.cooldown_seconds
            ):
                ts.last_alert_time = now
                logger.info(
                    "Violation on camera %d: %s for %.1fs",
                    camera_id,
                    violation_type,
                    time_without_ppe,
                )
                events.append(
                    ViolationEvent(
                        camera_id=camera_id,
                        violation_type=violation_type,
                        confidence=person_conf,
                        frame_path=frame_path,
                    )
                )

        return events

    def reset(self, camera_id: int) -> None:
        self._states.pop(camera_id, None)
