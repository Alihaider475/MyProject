from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.core.detector import Detection, _iou
from backend.core.logging import get_logger

logger = get_logger(__name__)

# Maps each violation type -> the PPE class that prevents it
VIOLATION_RULES: dict[str, str] = {
    "NO-Hardhat":     "Hardhat",
    "NO-Mask":        "Mask",
    "NO-Safety Vest": "Safety Vest",
}


FINE_PER_TYPE: dict[str, float] = {
    "NO-Hardhat": 100.0,
    "NO-Mask": 50.0,
    "NO-Safety Vest": 75.0,
}
_DEFAULT_FINE = 50.0


@dataclass
class ViolationEvent:
    camera_id: int
    violation_type: str
    confidence: float
    frame_path: Optional[str] = None
    worker_id: Optional[int] = None
    fine_amount: Optional[float] = None
    violation_id: Optional[int] = None
    track_id: Optional[int] = None
    person_bbox: Optional[str] = None  # JSON "[x1, y1, x2, y2]"


@dataclass
class _TypeState:
    """Per-camera, per-(track, violation-type) timing state."""
    last_safe_time: float = 0.0
    last_alert_time: float = field(default_factory=lambda: 0.0)
    last_seen: float = 0.0  # when this state was last referenced


@dataclass
class _CameraState:
    """Holds one _TypeState per (track_id, violation_type) for a single camera."""
    _types: dict[tuple[int | None, str], _TypeState] = field(default_factory=dict)

    def get(self, track_id: int | None, violation_type: str) -> _TypeState:
        key = (track_id, violation_type)
        if key not in self._types:
            self._types[key] = _TypeState()
        return self._types[key]

    def prune(self, max_age: float) -> None:
        """Remove states not seen for longer than max_age seconds."""
        now = time.time()
        stale = [k for k, v in self._types.items() if now - v.last_seen > max_age]
        for k in stale:
            del self._types[k]


class ViolationChecker:
    """
    Tracks per-camera, per-(track_id, violation_type) state and emits ViolationEvents.

    When DeepSORT tracking is active (detections have track_id), violations are
    deduplicated per-tracked-person. When tracking is inactive (all track_ids are
    None), falls back to the original global per-camera dedup logic.
    """

    def __init__(
        self,
        cooldown_seconds: int = 60,
        persist_seconds: int = 30,
        track_dedup_seconds: int = 300,
    ) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.persist_seconds = persist_seconds
        self.track_dedup_seconds = track_dedup_seconds
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
        worker_id: Optional[int] = None,
    ) -> list[ViolationEvent]:
        cam_state = self._get_state(camera_id)
        now = time.time()

        person_dets = [d for d in detections if d.class_name == "Person"]
        person_detected = len(person_dets) > 0
        tracking_active = any(d.track_id is not None for d in person_dets)

        events: list[ViolationEvent] = []

        for violation_type, ppe_class in VIOLATION_RULES.items():
            violation_dets = [d for d in detections if d.class_name == violation_type]

            if tracking_active:
                # --- Per-track path ---
                # For each violation detection, find the closest Person by IoU
                # and inherit its track_id
                seen_keys: set[tuple[int | None, str]] = set()
                candidates: list[tuple[int | None, Detection, Detection | None]] = []

                for vd in violation_dets:
                    best_iou = 0.0
                    best_person = None
                    for pd in person_dets:
                        iou = _iou(vd, pd)
                        if iou > best_iou:
                            best_iou = iou
                            best_person = pd
                    tid = best_person.track_id if best_person is not None else None
                    key = (tid, violation_type)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        candidates.append((tid, vd, best_person))

                for tid, vd, matched_person in candidates:
                    ts = cam_state.get(tid, violation_type)
                    ts.last_seen = now
                    cooldown = self.track_dedup_seconds if tid is not None else self.cooldown_seconds

                    # When tracking is active, skip the global ppe_present check.
                    # Per-bbox _suppress_conflicts() already handled Hardhat vs NO-Hardhat.
                    if not person_detected:
                        continue

                    time_without_ppe = now - ts.last_safe_time
                    time_since_alert = now - ts.last_alert_time

                    if time_without_ppe >= self.persist_seconds and time_since_alert >= cooldown:
                        ts.last_alert_time = now
                        conf = vd.confidence
                        bbox_json = None
                        if matched_person is not None:
                            bbox_json = json.dumps([matched_person.x1, matched_person.y1, matched_person.x2, matched_person.y2])
                        logger.info(
                            "[SAVED] New violation: camera=%d type=%s track=%s worker=%s",
                            camera_id, violation_type, tid, worker_id,
                        )
                        events.append(
                            ViolationEvent(
                                camera_id=camera_id,
                                violation_type=violation_type,
                                confidence=conf,
                                frame_path=frame_path,
                                worker_id=worker_id,
                                fine_amount=FINE_PER_TYPE.get(violation_type, _DEFAULT_FINE) if worker_id else None,
                                track_id=tid,
                                person_bbox=bbox_json,
                            )
                        )
                    elif time_without_ppe >= self.persist_seconds:
                        logger.debug(
                            "[COOLDOWN] Skipped duplicate: camera=%d type=%s track=%s elapsed=%.1fs cooldown=%ds",
                            camera_id, violation_type, tid,
                            now - ts.last_alert_time, cooldown,
                        )

                # Reset last_safe_time for tracked persons wearing PPE (not in violation)
                ppe_dets = [d for d in detections if d.class_name == ppe_class]
                for pd in person_dets:
                    if pd.track_id is None:
                        continue
                    # Check if this person overlaps with a PPE detection
                    for ppe_d in ppe_dets:
                        if _iou(pd, ppe_d) > 0.1:
                            ts = cam_state.get(pd.track_id, violation_type)
                            ts.last_safe_time = now
                            ts.last_seen = now
                            break

            else:
                # --- Untracked fallback path (original global logic) ---
                ts = cam_state.get(None, violation_type)
                ts.last_seen = now
                ppe_present = any(d.class_name == ppe_class for d in detections)

                if ppe_present:
                    ts.last_safe_time = now

                if not person_detected or ppe_present:
                    continue

                person_conf = max(
                    (d.confidence for d in detections if d.class_name == "Person"),
                    default=0.0,
                )
                time_without_ppe = now - ts.last_safe_time
                time_since_alert = now - ts.last_alert_time

                if (
                    time_without_ppe >= self.persist_seconds
                    and time_since_alert >= self.cooldown_seconds
                ):
                    ts.last_alert_time = now
                    logger.info(
                        "[SAVED] New violation: camera=%d type=%s worker=%s",
                        camera_id, violation_type, worker_id,
                    )
                    events.append(
                        ViolationEvent(
                            camera_id=camera_id,
                            violation_type=violation_type,
                            confidence=person_conf,
                            frame_path=frame_path,
                            worker_id=worker_id,
                            fine_amount=FINE_PER_TYPE.get(violation_type, _DEFAULT_FINE) if worker_id else None,
                        )
                    )
                elif time_without_ppe >= self.persist_seconds:
                    logger.debug(
                        "[COOLDOWN] Skipped duplicate: camera=%d type=%s elapsed=%.1fs cooldown=%ds",
                        camera_id, violation_type,
                        now - ts.last_alert_time, self.cooldown_seconds,
                    )

        # Prune stale track states to prevent memory leaks
        cam_state.prune(max(self.track_dedup_seconds, self.cooldown_seconds) * 2)

        return events

    def reset(self, camera_id: int) -> None:
        self._states.pop(camera_id, None)
