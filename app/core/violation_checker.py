from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from app.core.detector import Detection
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class ViolationEvent:
    camera_id: int
    violation_type: str
    confidence: float
    frame_path: Optional[str] = None


@dataclass
class _CameraState:
    last_hardhat_time: float = field(default_factory=time.time)
    last_alert_time: float = field(default_factory=lambda: 0.0)


class ViolationChecker:
    """
    Tracks per-camera state and emits ViolationEvent when a person is detected
    without a hardhat for longer than ALERT_COOLDOWN_SECONDS.
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
    ) -> Optional[ViolationEvent]:
        state = self._get_state(camera_id)
        now = time.time()

        hardhat_detected = any(d.class_name == "Hardhat" for d in detections)
        person_detected = any(d.class_name == "Person" for d in detections)

        if hardhat_detected:
            state.last_hardhat_time = now

        # Emit violation if: person present, no hardhat, cooldown elapsed
        if person_detected and not hardhat_detected:
            time_without_hardhat = now - state.last_hardhat_time
            time_since_last_alert = now - state.last_alert_time

            if (
                time_without_hardhat >= self.persist_seconds
                and time_since_last_alert >= self.cooldown_seconds
            ):
                state.last_alert_time = now
                person_detections = [d for d in detections if d.class_name == "Person"]
                confidence = max((d.confidence for d in person_detections), default=0.0)
                logger.info(
                    "Violation detected on camera %d: no hardhat for %.1fs",
                    camera_id,
                    time_without_hardhat,
                )
                return ViolationEvent(
                    camera_id=camera_id,
                    violation_type="NO-Hardhat",
                    confidence=confidence,
                    frame_path=frame_path,
                )

        return None

    def reset(self, camera_id: int) -> None:
        self._states.pop(camera_id, None)
