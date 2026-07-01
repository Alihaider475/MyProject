"""Shared PPE association + violation-candidate derivation.

This is the single source of truth used by every detection entry point — the
live camera loop (via :class:`ViolationChecker`), the image-upload route and the
video-upload route — so the *same frame yields the same violation candidates*
regardless of where it enters the system.

A *violation candidate* is the current-frame, stateless decision that a person is
in breach for one PPE type. Persistence/cooldown (turning a candidate into a
logged DB violation) is layered on top by the live ViolationChecker; uploads map
candidates straight to per-frame rows.

The deployed ppe.pt model emits explicit ``NO-Hardhat`` / ``NO-Mask`` /
``NO-Safety Vest`` classes, so candidates are derived in **hybrid** fashion:

  1. ``source="model"``  — a validated NO-X box belongs to a person in the right
     body region (the trustworthy signal).
  2. ``source="derived"`` — a confident person has no matched PPE *and* no NO-X
     box for that type. This recovers the common case where the model simply
     fails to emit a NO-X box on a close-up webcam frame ("Hardhats=0 but
     Violations=0"). Gated behind ``ENABLE_VIOLATION_DERIVATION`` and a person
     confidence floor; without a pose guard this is the main false-fine risk.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.detector import Detection, _iou

logger = get_logger(__name__)

# Maps each violation type -> the PPE class that prevents it.
VIOLATION_RULES: dict[str, str] = {
    "NO-Hardhat":     "Hardhat",
    "NO-Mask":        "Mask",
    "NO-Safety Vest": "Safety Vest",
}

# Body region (as a fraction of the matched person's bbox height, measured from
# the person's top edge) where each PPE / violation box is expected to sit. The
# positive (present) classes share the same band as their NO-X counterpart —
# a hardhat occupies the same head region whether it's there or missing.
_REGION_BANDS: dict[str, tuple[float, float]] = {
    "NO-Hardhat":     (-0.10, 0.55),  # head / upper region
    "Hardhat":        (-0.10, 0.55),
    "NO-Mask":        (-0.10, 0.55),  # face / head region
    "Mask":           (-0.10, 0.55),
    "NO-Safety Vest": (0.15, 0.95),   # torso region
    "Safety Vest":    (0.15, 0.95),
}

# PPE / violation classes considered for display-time association filtering.
_DISPLAY_PPE_CLASSES = frozenset(_REGION_BANDS.keys())

# Reject NO-X boxes smaller than this fraction of the full frame area — almost
# always background texture misfires rather than real PPE breaches.
_MIN_BOX_AREA_FRAC = 0.0005
# A box is "at the extreme edge" if it lies within this fraction of any border.
_EDGE_MARGIN_FRAC = 0.02
# Horizontal slack (fraction of person width) allowed around the person bbox.
_HORIZ_SLACK_FRAC = 0.15
# Pose guard: a person box wider than this multiple of its height is treated as
# non-upright (lying/crawling), where "top 35% = head" no longer holds. Such a
# person is skipped entirely rather than risking a false violation.
_UPRIGHT_MAX_ASPECT = 1.0


def _center(d: Detection) -> tuple[float, float]:
    return (d.x1 + d.x2) / 2.0, (d.y1 + d.y2) / 2.0


def _is_upright(person: Detection, *, pose_guard_enabled: bool = True) -> bool:
    """False if ``person`` is clearly wider than tall (lying/crawling pose).

    When ``pose_guard_enabled`` is False the guard is bypassed entirely and every
    person is treated as upright, so PPE is enforced regardless of posture
    (sitting, crouching, bending).

    The synthetic full-frame fallback person (``class_id == -1``, see
    :func:`build_fallback_person`) doesn't represent a real body pose, so it is
    always treated as upright.
    """
    if not pose_guard_enabled:
        return True
    if person.class_id == -1:
        return True
    width = max(1, person.x2 - person.x1)
    height = max(1, person.y2 - person.y1)
    return (width / height) <= _UPRIGHT_MAX_ASPECT


def _associate(box: Detection, person: Detection) -> bool:
    """True if ``box`` plausibly belongs to ``person`` (IoU overlap or its centre
    sits inside the person bbox)."""
    if _iou(box, person) > 0.0:
        return True
    cx, cy = _center(box)
    return person.x1 <= cx <= person.x2 and person.y1 <= cy <= person.y2


# In relaxed (browser/webcam) mode a Person box is considered a valid anchor for a
# NO-X box if it fills a large share of the frame OR touches a frame border — both
# are hallmarks of a laptop-webcam torso crop.
_RELAXED_PERSON_MIN_AREA_FRAC = 0.20


def _is_large_or_edge_person(
    person: Detection, frame_w: int | None, frame_h: int | None
) -> bool:
    """True if ``person`` fills >= _RELAXED_PERSON_MIN_AREA_FRAC of the frame or
    touches any frame border (within _EDGE_MARGIN_FRAC). Used only by the relaxed
    browser/webcam association path. With no frame dims we cannot judge size/edge,
    so any person qualifies (relaxed mode is already opt-in and source-gated)."""
    if not (frame_w and frame_h):
        return True
    area_frac = (
        max(0, person.x2 - person.x1) * max(0, person.y2 - person.y1)
    ) / (frame_w * frame_h)
    if area_frac >= _RELAXED_PERSON_MIN_AREA_FRAC:
        return True
    mx, my = _EDGE_MARGIN_FRAC * frame_w, _EDGE_MARGIN_FRAC * frame_h
    return (
        person.x1 <= mx or person.y1 <= my
        or person.x2 >= frame_w - mx or person.y2 >= frame_h - my
    )


def _in_region(box: Detection, person: Detection, band: tuple[float, float]) -> bool:
    """True if ``box``'s centre falls in the given vertical body region of the
    person (with horizontal slack)."""
    cx, cy = _center(box)
    ph = max(1, person.y2 - person.y1)
    pw = max(1, person.x2 - person.x1)
    rel_y = (cy - person.y1) / ph
    slack = _HORIZ_SLACK_FRAC * pw
    region_ok = band[0] <= rel_y <= band[1]
    horiz_ok = (person.x1 - slack) <= cx <= (person.x2 + slack)
    return region_ok and horiz_ok


def validate_violation_boxes(
    violation_type: str,
    violation_dets: list[Detection],
    person_dets: list[Detection],
    frame_w: int | None,
    frame_h: int | None,
    min_confidence: float,
    camera_id: int,
    log_at: Callable[..., None],
    pose_guard_enabled: bool = True,
    relaxed: bool = False,
) -> list[tuple[Detection, Detection]]:
    """Person-centric false-positive filter for explicit NO-X detections.

    Returns the subset of ``violation_dets`` that are genuine breaches, each
    paired with the Person box it belongs to. A NO-X box is kept only when it
    clears the confidence floor, is not a tiny speck, overlaps/sits inside a
    detected Person, and falls in the body region appropriate to the violation
    type. Every rejection is logged with its reason.

    When ``relaxed`` is True (browser/webcam laptop-crop sources), the pose guard
    is treated as off, and a NO-X box that fails the strict IoU/centre association
    is still accepted if a large-or-edge Person box exists (associate to the
    largest one) — and the body-region band check is skipped. The confidence floor
    and too-small-box filter are always enforced, so raw detections are not blindly
    accepted.
    """
    kept: list[tuple[Detection, Detection]] = []
    frame_area = (frame_w * frame_h) if (frame_w and frame_h) else None
    band = _REGION_BANDS.get(violation_type, (-0.10, 1.0))
    if relaxed:
        pose_guard_enabled = False

    for vd in violation_dets:
        cx, cy = _center(vd)

        # 1. Confidence floor (defensive — detector already applies one).
        if vd.confidence < min_confidence:
            log_at("[REJECT] camera=%d %s (%.2f) at [%d,%d,%d,%d] — below confidence floor %.2f",
                   camera_id, violation_type, vd.confidence, vd.x1, vd.y1, vd.x2, vd.y2, min_confidence)
            continue

        # 2. Too-small box relative to the frame.
        if frame_area:
            area_frac = (max(0, vd.x2 - vd.x1) * max(0, vd.y2 - vd.y1)) / frame_area
            if area_frac < _MIN_BOX_AREA_FRAC:
                log_at("[REJECT] camera=%d %s (%.2f) at [%d,%d,%d,%d] — box too small (%.4f of frame)",
                       camera_id, violation_type, vd.confidence, vd.x1, vd.y1, vd.x2, vd.y2, area_frac)
                continue

        # 3. Associate with a person — best IoU, then centre-containment.
        # Pose guard: a non-upright person (lying/crawling) is never matched —
        # the body-region bands below assume an upright pose.
        upright_persons = [pd for pd in person_dets if _is_upright(pd, pose_guard_enabled=pose_guard_enabled)]
        best_person = None
        best_iou = 0.0
        for pd in upright_persons:
            iou = _iou(vd, pd)
            if iou > best_iou:
                best_iou = iou
                best_person = pd
        if best_person is None:
            for pd in upright_persons:
                if pd.x1 <= cx <= pd.x2 and pd.y1 <= cy <= pd.y2:
                    best_person = pd
                    break

        assoc_via = "strict"
        # Relaxed fallback: strict IoU/centre association failed. On a laptop-webcam
        # crop the NO-X box often sits just outside the person bbox (or the person
        # box itself is the wide crop). Anchor to the largest large-or-edge person.
        if best_person is None and relaxed:
            candidates_le = [
                pd for pd in upright_persons
                if _is_large_or_edge_person(pd, frame_w, frame_h)
            ]
            if candidates_le:
                best_person = max(
                    candidates_le,
                    key=lambda p: (p.x2 - p.x1) * (p.y2 - p.y1),
                )
                assoc_via = "relaxed-large-edge"

        if best_person is None:
            at_edge = ""
            if frame_w and frame_h:
                mx, my = _EDGE_MARGIN_FRAC * frame_w, _EDGE_MARGIN_FRAC * frame_h
                if vd.x1 <= mx or vd.y1 <= my or vd.x2 >= frame_w - mx or vd.y2 >= frame_h - my:
                    at_edge = " (at frame edge)"
            log_at("[REJECT] camera=%d %s (%.2f) at [%d,%d,%d,%d] — no associated person%s "
                   "(relaxed=%s)",
                   camera_id, violation_type, vd.confidence, vd.x1, vd.y1, vd.x2, vd.y2,
                   at_edge, relaxed)
            continue

        if relaxed:
            log_at("[RELAXED-ASSOC] camera=%d %s (%.2f) pose_guard=off box=[%d,%d,%d,%d] "
                   "-> person=[%d,%d,%d,%d] association=%s (region check skipped)",
                   camera_id, violation_type, vd.confidence,
                   vd.x1, vd.y1, vd.x2, vd.y2,
                   best_person.x1, best_person.y1, best_person.x2, best_person.y2,
                   assoc_via)
            kept.append((vd, best_person))
            continue

        # 4. Region check — the box must sit on the right part of the person.
        if not _in_region(vd, best_person, band):
            ph = max(1, best_person.y2 - best_person.y1)
            rel_y = (cy - best_person.y1) / ph
            log_at("[REJECT] camera=%d %s (%.2f) at [%d,%d,%d,%d] — wrong body region "
                   "(rel_y=%.2f band=%.2f-%.2f)",
                   camera_id, violation_type, vd.confidence, vd.x1, vd.y1, vd.x2, vd.y2,
                   rel_y, band[0], band[1])
            continue

        kept.append((vd, best_person))

    return kept


@dataclass
class ViolationCandidate:
    """A current-frame, stateless breach decision for one person + PPE type."""
    violation_type: str
    person: Detection
    confidence: float
    source: str  # "model" (validated NO-X box) | "derived" (no PPE, no NO-X box)
    track_id: Optional[int] = None


def active_rules(mask_enabled: bool) -> dict[str, str]:
    """VIOLATION_RULES with NO-Mask dropped when mask checking is disabled."""
    if mask_enabled:
        return dict(VIOLATION_RULES)
    return {k: v for k, v in VIOLATION_RULES.items() if k != "NO-Mask"}


def build_fallback_person(frame_w: int, frame_h: int) -> Detection:
    """A synthetic full-frame Person used on close-up frames where YOLO missed
    the Person box but a confident NO-X box is present."""
    return Detection(
        class_id=-1,
        class_name="Person",
        confidence=1.0,
        x1=0, y1=0, x2=frame_w, y2=frame_h,
        color=(0, 255, 255),
        track_id=None,
    )


def derive_candidates(
    detections: list[Detection],
    frame_w: int | None,
    frame_h: int | None,
    *,
    mask_enabled: bool | None = None,
    violation_confidence: float | None = None,
    enable_derivation: bool | None = None,
    derivation_person_conf: float | None = None,
    pose_guard_enabled: bool | None = None,
    relaxed: bool = False,
    camera_id: int = 0,
    log_at: Optional[Callable[..., None]] = None,
    stats: Optional[dict] = None,
) -> list[ViolationCandidate]:
    """Produce hybrid violation candidates for a single frame.

    ``stats["fallback"]`` is set True when the full-frame person fallback fired
    (so callers that track diagnostics can count it).

    When ``relaxed`` is True (browser/webcam laptop-crop sources) the pose guard is
    bypassed and NO-X association is loosened — see :func:`validate_violation_boxes`.
    """
    mask_enabled = settings.MASK_VIOLATION_ENABLED if mask_enabled is None else mask_enabled
    violation_confidence = (
        settings.VIOLATION_CONFIDENCE if violation_confidence is None else violation_confidence
    )
    enable_derivation = (
        settings.ENABLE_VIOLATION_DERIVATION if enable_derivation is None else enable_derivation
    )
    derivation_person_conf = (
        settings.DERIVATION_PERSON_CONF if derivation_person_conf is None else derivation_person_conf
    )
    pose_guard_enabled = (
        settings.POSE_GUARD_ENABLED if pose_guard_enabled is None else pose_guard_enabled
    )
    # Relaxed browser/webcam mode bypasses the pose guard entirely (the wide laptop
    # torso crop reads as "non-upright" but is a normal standing worker).
    if relaxed:
        pose_guard_enabled = False
    log = log_at or (logger.info if settings.WEBCAM_DEBUG else logger.debug)

    rules = active_rules(mask_enabled)
    person_dets = [d for d in detections if d.class_name == "Person"]

    # Close-up fallback: no Person box but a confident NO-X exists → treat the
    # whole frame as one person region so the model breach is still evaluated.
    # Derivation is intentionally disabled in this mode (we have no real person
    # box to anchor a "missing PPE" inference, only the model's own NO-X box).
    used_fallback = False
    if settings.ENABLE_NO_PERSON_VIOLATION_FALLBACK and not person_dets and frame_w and frame_h:
        has_conf_violation = any(
            d.class_name in rules and d.confidence >= violation_confidence
            for d in detections
        )
        if has_conf_violation:
            person_dets = [build_fallback_person(frame_w, frame_h)]
            used_fallback = True
            if stats is not None:
                stats["fallback"] = True
            log("[FALLBACK] camera=%d no Person box — treating full frame as "
                "person region for NO-X evaluation", camera_id)

    candidates: list[ViolationCandidate] = []

    for violation_type, ppe_class in rules.items():
        band = _REGION_BANDS.get(violation_type, (-0.10, 1.0))
        raw_nox = [d for d in detections if d.class_name == violation_type]
        validated = validate_violation_boxes(
            violation_type, raw_nox, person_dets,
            frame_w, frame_h, violation_confidence, camera_id, log,
            pose_guard_enabled=pose_guard_enabled,
            relaxed=relaxed,
        )

        # 1) Model-detected breaches.
        persons_with_model_breach: set[int] = set()
        for vd, person in validated:
            persons_with_model_breach.add(id(person))
            candidates.append(
                ViolationCandidate(
                    violation_type=violation_type,
                    person=person,
                    confidence=vd.confidence,
                    source="model",
                    track_id=person.track_id,
                )
            )

        # 2) Derived breaches — confident person, no NO-X box, no matching PPE.
        if not (enable_derivation and not used_fallback):
            continue

        ppe_dets = [d for d in detections if d.class_name == ppe_class]
        for person in person_dets:
            if id(person) in persons_with_model_breach:
                continue  # already a model breach for this type
            if not _is_upright(person, pose_guard_enabled=pose_guard_enabled):
                log("[SKIP-DERIVE] camera=%d %s — pose guard, non-upright person at "
                    "[%d,%d,%d,%d]",
                    camera_id, violation_type, person.x1, person.y1, person.x2, person.y2)
                continue
            if person.confidence < derivation_person_conf:
                log("[SKIP-DERIVE] camera=%d %s — person conf %.2f < floor %.2f",
                    camera_id, violation_type, person.confidence, derivation_person_conf)
                continue
            wears_ppe = any(
                _associate(ppe, person) and _in_region(ppe, person, band)
                for ppe in ppe_dets
            )
            if wears_ppe:
                continue  # compliant — PPE matched in the right region
            candidates.append(
                ViolationCandidate(
                    violation_type=violation_type,
                    person=person,
                    confidence=person.confidence,
                    source="derived",
                    track_id=person.track_id,
                )
            )
            log("[DERIVE] camera=%d %s — person (%.2f) at [%d,%d,%d,%d] has no "
                "%s and no NO-X box → derived breach",
                camera_id, violation_type, person.confidence,
                person.x1, person.y1, person.x2, person.y2, ppe_class)

    return candidates


def filter_displayable_detections(
    detections: list[Detection],
    frame_w: int | None,
    frame_h: int | None,
    *,
    debug: bool = False,
    pose_guard_enabled: bool | None = None,
) -> list[Detection]:
    """Display-only cleanup: drop PPE/NO-X boxes not anchored to a real person.

    The violation pipeline (:func:`derive_candidates`) always sees the full raw
    ``detections`` list — this function only decides what gets *drawn* on the
    live overlay (MJPEG burned-in annotation and the WebRTC canvas payload), so
    background misfires (a stray "Safety Vest" box on a dark wall) don't clutter
    the stream while still being logged/checked internally.

    Person boxes are always kept (regardless of pose — the pose guard only
    affects violation derivation, not whether the box is shown). A PPE/NO-X box
    is kept only if it associates (overlap or centre-containment) with an
    upright Person and sits in that PPE type's expected body region. Any other
    class (Vehicle, Machinery, Cone, ...) passes through unfiltered.

    When ``debug`` is True (``WEBCAM_DEBUG``), filtering is skipped entirely so
    raw model output remains visible for diagnosis.
    """
    if debug:
        return detections

    pose_guard_enabled = (
        settings.POSE_GUARD_ENABLED if pose_guard_enabled is None else pose_guard_enabled
    )
    persons = [d for d in detections if d.class_name == "Person"]
    upright_persons = [p for p in persons if _is_upright(p, pose_guard_enabled=pose_guard_enabled)]

    kept: list[Detection] = list(persons)
    for d in detections:
        if d.class_name == "Person":
            continue
        if d.class_name not in _DISPLAY_PPE_CLASSES:
            kept.append(d)  # not a PPE/NO-X class — pass through unfiltered
            continue
        band = _REGION_BANDS[d.class_name]
        if any(_associate(d, p) and _in_region(d, p, band) for p in upright_persons):
            kept.append(d)

    return kept
