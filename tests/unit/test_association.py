from __future__ import annotations

from backend.detection.detector import Detection, _dedup_persons
from backend.detection.association import derive_candidates, filter_displayable_detections


def det(
    class_name: str,
    confidence: float = 0.9,
    x1: int = 0, y1: int = 0, x2: int = 100, y2: int = 100,
    track_id: int | None = None,
) -> Detection:
    return Detection(
        class_id=0,
        class_name=class_name,
        confidence=confidence,
        x1=x1, y1=y1, x2=x2, y2=y2,
        color=(255, 0, 0),
        track_id=track_id,
    )


FRAME = (640, 480)
# Explicit knobs so tests are independent of .env / settings defaults.
KW = dict(
    mask_enabled=True,
    violation_confidence=0.25,
    enable_derivation=True,
    derivation_person_conf=0.55,
)


# --------------------------- person de-dup ---------------------------

def test_dedup_merges_overlapping_person_boxes():
    # One body, two boxes (the classic ghost: a head box inside a body box).
    body = det("Person", confidence=0.45, x1=0, y1=0, x2=100, y2=200)
    head = det("Person", confidence=0.50, x1=10, y1=0, x2=90, y2=70)  # contained
    kept = _dedup_persons([body, head], iou_threshold=0.55, containment_threshold=0.70)
    persons = [d for d in kept if d.class_name == "Person"]
    assert len(persons) == 1
    # The larger full-body box survives.
    assert persons[0] is body


def test_dedup_keeps_distinct_persons():
    a = det("Person", x1=0, y1=0, x2=100, y2=200)
    b = det("Person", x1=300, y1=0, x2=400, y2=200)  # no overlap
    kept = _dedup_persons([a, b], iou_threshold=0.55, containment_threshold=0.70)
    assert len([d for d in kept if d.class_name == "Person"]) == 2


def test_dedup_never_touches_ppe_boxes():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    hardhat = det("Hardhat", x1=10, y1=0, x2=90, y2=40)  # inside the person
    kept = _dedup_persons([person, hardhat], iou_threshold=0.55, containment_threshold=0.70)
    assert hardhat in kept  # PPE inside a person is expected, never merged away


# --------------------------- candidate derivation ---------------------------

def test_model_candidate_from_no_x_box():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    nohardhat = det("NO-Hardhat", x1=10, y1=0, x2=90, y2=40)  # head region
    cands = derive_candidates([person, nohardhat], *FRAME, **KW)
    hh = [c for c in cands if c.violation_type == "NO-Hardhat"]
    assert len(hh) == 1
    assert hh[0].source == "model"


def test_derived_candidate_for_bare_person():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    cands = derive_candidates([person], *FRAME, **KW)
    hh = [c for c in cands if c.violation_type == "NO-Hardhat"]
    assert len(hh) == 1
    assert hh[0].source == "derived"
    assert hh[0].confidence == person.confidence


def test_no_candidate_when_compliant():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    hardhat = det("Hardhat", x1=10, y1=0, x2=90, y2=40)  # on the head
    cands = derive_candidates([person, hardhat], *FRAME, **KW)
    assert [c for c in cands if c.violation_type == "NO-Hardhat"] == []


def test_derivation_respects_person_floor():
    person = det("Person", confidence=0.40, x1=0, y1=0, x2=100, y2=200)  # < 0.55
    cands = derive_candidates([person], *FRAME, **KW)
    assert [c for c in cands if c.source == "derived"] == []


def test_derivation_can_be_disabled():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    cands = derive_candidates(
        [person], *FRAME,
        mask_enabled=True, violation_confidence=0.25,
        enable_derivation=False, derivation_person_conf=0.55,
    )
    assert cands == []


def test_mask_disabled_suppresses_no_mask():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    cands = derive_candidates(
        [person], *FRAME,
        mask_enabled=False, violation_confidence=0.25,
        enable_derivation=True, derivation_person_conf=0.55,
    )
    assert [c for c in cands if c.violation_type == "NO-Mask"] == []


def test_track_id_carried_onto_candidate():
    person = det("Person", x1=0, y1=0, x2=100, y2=200, track_id=42)
    cands = derive_candidates([person], *FRAME, **KW)
    assert cands and all(c.track_id == 42 for c in cands)


# --------------------------- pose guard ---------------------------

def test_pose_guard_skips_derivation_for_lying_person():
    # Wider than tall (200x100) — lying/crawling, not upright.
    person = det("Person", x1=0, y1=0, x2=200, y2=100)
    cands = derive_candidates([person], *FRAME, **KW)
    assert cands == []


def test_pose_guard_skips_model_breach_for_lying_person():
    # NO-Hardhat box positioned in what would be the "head region" band for an
    # upright person, but the only nearby person is lying down — must not match.
    person = det("Person", x1=0, y1=0, x2=200, y2=100)
    nohardhat = det("NO-Hardhat", x1=20, y1=0, x2=80, y2=30)
    cands = derive_candidates([person, nohardhat], *FRAME, **KW)
    assert cands == []


def test_upright_person_still_flagged():
    # Sanity check: a normal upright bare person (taller than wide) is
    # unaffected by the pose guard and still yields a derived breach.
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    cands = derive_candidates([person], *FRAME, **KW)
    assert [c for c in cands if c.violation_type == "NO-Hardhat"]


def test_pose_guard_disabled_derives_for_lying_person():
    # With the guard off, a non-upright (wide) bare person must still yield a
    # derived breach — PPE is enforced regardless of posture.
    person = det("Person", x1=0, y1=0, x2=200, y2=100)
    kw = {**KW, "pose_guard_enabled": False}
    cands = derive_candidates([person], *FRAME, **kw)
    hh = [c for c in cands if c.violation_type == "NO-Hardhat"]
    assert len(hh) == 1
    assert hh[0].source == "derived"


def test_pose_guard_disabled_keeps_model_breach_for_lying_person():
    # With the guard off, an explicit NO-Hardhat box on a lying person must
    # associate and produce a model breach.
    person = det("Person", x1=0, y1=0, x2=200, y2=100)
    nohardhat = det("NO-Hardhat", x1=20, y1=0, x2=80, y2=30)
    kw = {**KW, "pose_guard_enabled": False}
    cands = derive_candidates([person, nohardhat], *FRAME, **kw)
    hh = [c for c in cands if c.violation_type == "NO-Hardhat" and c.source == "model"]
    assert len(hh) == 1


def test_pose_guard_does_not_affect_fallback_person():
    # The synthetic full-frame fallback person (640x480, wider than tall) must
    # still be evaluated for model breaches — the pose guard only applies to
    # real YOLO Person boxes, not the close-up fallback sentinel.
    nohardhat = det("NO-Hardhat", x1=270, y1=0, x2=370, y2=150, confidence=0.9)
    cands = derive_candidates([nohardhat], *FRAME, **KW)
    hh = [c for c in cands if c.violation_type == "NO-Hardhat" and c.source == "model"]
    assert len(hh) == 1


# --------------------------- display filtering ---------------------------

def test_display_drops_unassociated_vest_box():
    # A "Safety Vest" box far from any person (e.g. a dark background misfire)
    # must not be drawn.
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    stray_vest = det("Safety Vest", x1=500, y1=400, x2=560, y2=440)
    shown = filter_displayable_detections([person, stray_vest], *FRAME)
    assert stray_vest not in shown
    assert person in shown


def test_display_keeps_vest_on_torso():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    vest = det("Safety Vest", x1=10, y1=60, x2=90, y2=160)  # torso region
    shown = filter_displayable_detections([person, vest], *FRAME)
    assert vest in shown


def test_display_drops_hardhat_off_head_region():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    # Sitting in the torso band, not the head band — wrong region for a hardhat.
    misplaced_hardhat = det("Hardhat", x1=10, y1=120, x2=90, y2=160)
    shown = filter_displayable_detections([person, misplaced_hardhat], *FRAME)
    assert misplaced_hardhat not in shown


def test_display_keeps_hardhat_on_head():
    person = det("Person", x1=0, y1=0, x2=100, y2=200)
    hardhat = det("Hardhat", x1=10, y1=0, x2=90, y2=40)  # head region
    shown = filter_displayable_detections([person, hardhat], *FRAME)
    assert hardhat in shown


def test_display_keeps_non_ppe_classes_unfiltered():
    vehicle = det("Vehicle", x1=500, y1=400, x2=560, y2=440)
    shown = filter_displayable_detections([vehicle], *FRAME)
    assert vehicle in shown


def test_display_pose_guard_drops_ppe_on_lying_person():
    lying_person = det("Person", x1=0, y1=0, x2=200, y2=100)  # wider than tall
    vest = det("Safety Vest", x1=20, y1=40, x2=180, y2=90)
    shown = filter_displayable_detections([lying_person, vest], *FRAME)
    assert lying_person in shown  # person box itself is always shown
    assert vest not in shown


def test_display_pose_guard_disabled_keeps_ppe_on_lying_person():
    lying_person = det("Person", x1=0, y1=0, x2=200, y2=100)  # wider than tall
    vest = det("Safety Vest", x1=20, y1=40, x2=180, y2=90)
    shown = filter_displayable_detections(
        [lying_person, vest], *FRAME, pose_guard_enabled=False
    )
    assert lying_person in shown
    assert vest in shown


def test_display_debug_bypasses_filtering():
    stray_vest = det("Safety Vest", x1=500, y1=400, x2=560, y2=440)
    shown = filter_displayable_detections([stray_vest], *FRAME, debug=True)
    assert stray_vest in shown
