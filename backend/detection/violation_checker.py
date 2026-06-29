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
from backend.detection.detector import Detection

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
    first_seen: float | None = None
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

    @staticmethod
    def _persistence_elapsed(ts: _TypeState, now: float) -> float:
        if ts.first_seen is None:
            ts.first_seen = now
        return max(0.0, now - ts.first_seen)

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
        # Promote gate traces to INFO when WEBCAM_DEBUG so the live pipeline is
        # visible without lowering the global log level.
        log_at = logger.info if settings.WEBCAM_DEBUG else logger.debug

        # Shared hybrid candidates for this frame (model NO-X + derived).
        stats: dict = {}
        candidates = self._candidates(camera_id, detections, frame_w, frame_h, stats)
        if stats.get("fallback"):
            self._fallback_counts[camera_id] = self._fallback_counts.get(camera_id, 0) + 1

        by_type: dict[str, list[ViolationCandidate]] = {}
        for c in candidates:
            by_type.setdefault(c.violation_type, []).append(c)

        events: list[ViolationEvent] = []

        for violation_type, ppe_class in active_rules(settings.MASK_VIOLATION_ENABLED).items():
            type_candidates = by_type.get(violation_type, [])

            # Persistence + cooldown are timed per (camera, violation_type) on a
            # single state (track_id=None key) rather than per (track, type).
            # This is deliberately RESILIENT to ByteTrack reassigning a person's
            # track_id mid-breach: a continuous breach keeps accumulating toward
            # the persist threshold instead of restarting every time the id flips
            # (which previously meant a real, ongoing violation was logged late or
            # never). The same single cooldown also stops a churning track from
            # being logged as repeated duplicates. The candidate's track_id is
            # still recorded on the saved event for display / analytics.
            ts = cam_state.get(None, violation_type)
            ts.last_seen = now
            ppe_present = any(d.class_name == ppe_class for d in detections)

            # Person is wearing the PPE somewhere with no outstanding breach →
            # reset the persistence timer (compliant frame).
            if ppe_present and not type_candidates:
                ts.last_safe_time = now
                ts.first_seen = None

            if not type_candidates:
                continue

            # Highest-confidence candidate represents this breach; its track_id
            # (may be None) tags the event for display only.
            c = max(type_candidates, key=lambda x: x.confidence)
            person = c.person
            tid = c.track_id
            bbox_json = json.dumps([person.x1, person.y1, person.x2, person.y2])
            time_without_ppe = self._persistence_elapsed(ts, now)
            time_since_alert = now - ts.last_alert_time

            # --- Gate trace: persist / cooldown / confidence ---
            persist_ok = time_without_ppe >= self.persist_seconds
            cooldown_ok = time_since_alert >= self.cooldown_seconds
            conf_ok = c.confidence >= self.violation_confidence  # informational; already filtered upstream
            log_at(
                "[PERSIST] camera=%d type=%s track=%s first_seen=%.3f elapsed=%.1fs required=%ds result=%s",
                camera_id, violation_type, tid, ts.first_seen or now,
                time_without_ppe, self.persist_seconds, "PASS" if persist_ok else "WAIT",
            )
            log_at(
                "[GATE] camera=%d type=%s track=%s | persist %.1fs>=%ds=%s | "
                "cooldown %.1fs>=%ds=%s | conf %.2f>=%.2f=%s",
                camera_id, violation_type, tid,
                time_without_ppe, self.persist_seconds, "PASS" if persist_ok else "WAIT",
                time_since_alert, self.cooldown_seconds, "PASS" if cooldown_ok else "BLOCK",
                c.confidence, self.violation_confidence, "PASS" if conf_ok else "FAIL",
            )

            if persist_ok and cooldown_ok:
                ts.last_alert_time = now
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
            elif persist_ok:
                logger.debug(
                    "[COOLDOWN] Skipped duplicate: camera=%d type=%s track=%s elapsed=%.1fs cooldown=%ds",
                    camera_id, violation_type, tid,
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
