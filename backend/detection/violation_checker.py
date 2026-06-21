from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Optional

from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.association import (
    VIOLATION_RULES,
    ViolationCandidate,
    active_rules,
    derive_candidates,
)
from backend.detection.detector import Detection, _iou

logger = get_logger(__name__)


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
    # Enrichment for alert payloads — populated after face recognition
    # (worker fields) and after fine creation (fine fields).
    worker_name: Optional[str] = None
    employee_id: Optional[str] = None
    fine_id: Optional[int] = None
    currency: Optional[str] = None
    challan_number: Optional[str] = None
    fine_status: Optional[str] = None  # pending | deducted | waived
    # Optional {violation_type: count} breakdown for summary alerts (e.g. one
    # email per file upload covering several detected types). Left None for
    # single live-camera violations.
    violation_counts: Optional[dict[str, int]] = None


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

    Per-frame breach detection is delegated to the shared
    :func:`backend.detection.association.derive_candidates` (hybrid model + derived
    candidates), so the live path produces the same candidates as the image- and
    video-upload paths. This class adds the temporal layer: persistence and
    occlusion-aware cooldown that turn a candidate into a logged violation.

    When DeepSORT tracking is active (persons have track_id), violations are
    deduplicated per-tracked-person. When tracking is inactive (all track_ids are
    None), falls back to global per-camera dedup.
    """

    def __init__(
        self,
        cooldown_seconds: int = 60,
        persist_seconds: int = 30,
        track_dedup_seconds: int = 300,
        violation_confidence: float | None = None,
    ) -> None:
        self.cooldown_seconds = cooldown_seconds
        self.persist_seconds = persist_seconds
        self.track_dedup_seconds = track_dedup_seconds
        # Confidence floor used by the person-centric false-positive filter.
        self.violation_confidence = (
            violation_confidence if violation_confidence is not None
            else settings.VIOLATION_CONFIDENCE
        )
        self._states: dict[int, _CameraState] = {}
        # Per-camera count of times the "no Person box → full-frame person"
        # fallback fired (surfaced by the camera diagnostics endpoint).
        self._fallback_counts: dict[int, int] = {}

    def fallback_count(self, camera_id: int) -> int:
        return self._fallback_counts.get(camera_id, 0)

    def _get_state(self, camera_id: int) -> _CameraState:
        if camera_id not in self._states:
            self._states[camera_id] = _CameraState()
        return self._states[camera_id]

    def _candidates(
        self,
        camera_id: int,
        detections: list[Detection],
        frame_w: Optional[int],
        frame_h: Optional[int],
        stats: Optional[dict],
    ) -> list[ViolationCandidate]:
        log_at = logger.info if settings.WEBCAM_DEBUG else logger.debug
        return derive_candidates(
            detections, frame_w, frame_h,
            violation_confidence=self.violation_confidence,
            camera_id=camera_id,
            log_at=log_at,
            stats=stats,
        )

    def current_candidates(
        self,
        camera_id: int,
        detections: list[Detection],
        frame_w: Optional[int] = None,
        frame_h: Optional[int] = None,
    ) -> list[ViolationCandidate]:
        """Stateless current-frame breach candidates — for live count display.

        Does not touch persistence/cooldown state or the fallback counter.
        """
        return self._candidates(camera_id, detections, frame_w, frame_h, stats=None)

    def check(
        self,
        camera_id: int,
        detections: list[Detection],
        frame_path: Optional[str] = None,
        worker_id: Optional[int] = None,
        frame_w: Optional[int] = None,
        frame_h: Optional[int] = None,
    ) -> list[ViolationEvent]:
        cam_state = self._get_state(camera_id)
        now = time.time()

        # Shared hybrid candidates for this frame (model NO-X + derived).
        stats: dict = {}
        candidates = self._candidates(camera_id, detections, frame_w, frame_h, stats)
        if stats.get("fallback"):
            self._fallback_counts[camera_id] = self._fallback_counts.get(camera_id, 0) + 1

        person_dets = [d for d in detections if d.class_name == "Person"]
        # person_detected is True when a real person OR a fallback-derived
        # candidate (whole-frame person) exists.
        person_detected = bool(person_dets) or bool(candidates)
        tracking_active = any(d.track_id is not None for d in person_dets)

        by_type: dict[str, list[ViolationCandidate]] = {}
        for c in candidates:
            by_type.setdefault(c.violation_type, []).append(c)

        events: list[ViolationEvent] = []

        for violation_type, ppe_class in active_rules(settings.MASK_VIOLATION_ENABLED).items():
            type_candidates = by_type.get(violation_type, [])

            if tracking_active:
                # --- Per-track path ---
                # Dedup candidates per (track, violation_type); each carries its
                # matched person (and that person's track_id).
                seen_keys: set[tuple[int | None, str]] = set()
                deduped: list[ViolationCandidate] = []
                for c in type_candidates:
                    key = (c.track_id, violation_type)
                    if key not in seen_keys:
                        seen_keys.add(key)
                        deduped.append(c)

                for c in deduped:
                    tid = c.track_id
                    ts = cam_state.get(tid, violation_type)
                    ts.last_seen = now
                    cooldown = self.track_dedup_seconds if tid is not None else self.cooldown_seconds

                    if not person_detected:
                        continue

                    time_without_ppe = now - ts.last_safe_time
                    time_since_alert = now - ts.last_alert_time

                    if time_without_ppe >= self.persist_seconds and time_since_alert >= cooldown:
                        ts.last_alert_time = now
                        person = c.person
                        bbox_json = json.dumps([person.x1, person.y1, person.x2, person.y2])
                        logger.info(
                            "[SAVED] New violation: camera=%d type=%s track=%s worker=%s source=%s",
                            camera_id, violation_type, tid, worker_id, c.source,
                        )
                        events.append(
                            ViolationEvent(
                                camera_id=camera_id,
                                violation_type=violation_type,
                                confidence=c.confidence,
                                frame_path=frame_path,
                                worker_id=worker_id,
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

                # Reset last_safe_time for tracked persons wearing PPE (compliant).
                ppe_dets = [d for d in detections if d.class_name == ppe_class]
                for pd in person_dets:
                    if pd.track_id is None:
                        continue
                    for ppe_d in ppe_dets:
                        if _iou(pd, ppe_d) > 0.1:
                            ts = cam_state.get(pd.track_id, violation_type)
                            ts.last_safe_time = now
                            ts.last_seen = now
                            break

            else:
                # --- Untracked fallback path (no DeepSORT track IDs) ---
                ts = cam_state.get(None, violation_type)
                ts.last_seen = now
                ppe_present = any(d.class_name == ppe_class for d in detections)

                # Person is wearing the PPE somewhere → reset the persistence timer.
                if ppe_present and not type_candidates:
                    ts.last_safe_time = now

                if not type_candidates:
                    continue

                # Use the highest-confidence candidate for this type.
                c = max(type_candidates, key=lambda x: x.confidence)
                person = c.person
                bbox_json = json.dumps([person.x1, person.y1, person.x2, person.y2])
                time_without_ppe = now - ts.last_safe_time
                time_since_alert = now - ts.last_alert_time

                if (
                    time_without_ppe >= self.persist_seconds
                    and time_since_alert >= self.cooldown_seconds
                ):
                    ts.last_alert_time = now
                    logger.info(
                        "[SAVED] New violation: camera=%d type=%s conf=%.2f worker=%s source=%s",
                        camera_id, violation_type, c.confidence, worker_id, c.source,
                    )
                    events.append(
                        ViolationEvent(
                            camera_id=camera_id,
                            violation_type=violation_type,
                            confidence=c.confidence,
                            frame_path=frame_path,
                            worker_id=worker_id,
                            person_bbox=bbox_json,
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
        self._fallback_counts.pop(camera_id, None)


# Re-exported for backwards compatibility (moved to association.py).
__all__ = ["ViolationChecker", "ViolationEvent", "VIOLATION_RULES"]
