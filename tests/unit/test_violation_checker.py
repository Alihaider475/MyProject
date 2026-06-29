from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.detection.detector import Detection
from backend.detection.violation_checker import ViolationChecker


def make_detection(
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


# A full-body person box plus a NO-Hardhat box sitting on the head region. The
# checker now requires a NO-X box that is associated with a person in the
# correct body region before it will emit a violation.
def make_person(x1=0, y1=0, x2=100, y2=200, track_id=None) -> Detection:
    return make_detection("Person", x1=x1, y1=y1, x2=x2, y2=y2, track_id=track_id)


def make_no_hardhat(conf: float = 0.9) -> Detection:
    # Head region of a (0,0,100,200) person → vertical centre at y=20 (rel_y=0.1).
    return make_detection("NO-Hardhat", confidence=conf, x1=10, y1=0, x2=90, y2=40)


def make_no_mask(conf: float = 0.9) -> Detection:
    return make_detection("NO-Mask", confidence=conf, x1=10, y1=0, x2=90, y2=40)


# Frame dims for the person-centric size/edge checks.
FRAME = {"frame_w": 640, "frame_h": 480}


@pytest.fixture
def checker():
    return ViolationChecker(cooldown_seconds=10, persist_seconds=5)


def test_no_violation_when_all_ppe_present(checker):
    detections = [
        make_detection("Hardhat"), make_detection("Mask"),
        make_detection("Safety Vest"), make_person(),
    ]
    result = checker.check(camera_id=1, detections=detections, **FRAME)
    assert result == []


def test_no_violation_when_no_person_but_confident_no_x_by_default(checker):
    camera_id = 7
    detections = [make_no_hardhat(conf=0.9)]
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0
        result = checker.check(camera_id=camera_id, detections=detections, **FRAME)
    assert result == []
    assert checker.fallback_count(camera_id) == 0


def test_opt_in_violation_when_no_person_but_confident_no_x(checker, monkeypatch):
    # Close-up webcam: only a head/torso is visible so YOLO misses the Person
    # box, but a confident NO-Hardhat is present. The person fallback treats the
    # full frame as the person region so the breach is not silently dropped.
    from backend.core.config import settings

    monkeypatch.setattr(settings, "ENABLE_NO_PERSON_VIOLATION_FALLBACK", True)
    camera_id = 7
    detections = [make_no_hardhat(conf=0.9)]
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0
        result = checker.check(camera_id=camera_id, detections=detections, **FRAME)
    assert len(result) == 1
    assert result[0].violation_type == "NO-Hardhat"
    assert checker.fallback_count(camera_id) == 1


def test_no_fallback_when_no_person_and_low_confidence(checker):
    # A weak NO-X box with no person stays a false positive — the fallback only
    # rescues boxes that clear the violation confidence floor.
    camera_id = 8
    detections = [make_no_hardhat(conf=0.1)]
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0
        result = checker.check(camera_id=camera_id, detections=detections, **FRAME)
    assert result == []
    assert checker.fallback_count(camera_id) == 0


def test_no_violation_for_box_not_on_a_person(checker):
    # A NO-Hardhat box far from the person (e.g. on a wall) must not anchor a
    # violation. The person here is fully compliant (hardhat/mask/vest on the
    # correct body regions), so hybrid derivation produces nothing either — the
    # only thing that *could* fire is the stray wall box, and it is rejected.
    person = make_person(x1=0, y1=0, x2=100, y2=200)
    hardhat = make_detection("Hardhat", x1=10, y1=0, x2=90, y2=40)
    mask = make_detection("Mask", x1=10, y1=0, x2=90, y2=40)
    vest = make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160)
    wall_box = make_detection("NO-Hardhat", x1=500, y1=400, x2=560, y2=440)
    with patch("time.time", return_value=1000.0):
        checker._get_state(1).get(None, "NO-Hardhat").first_seen = 990.0
        result = checker.check(
            camera_id=1, detections=[person, hardhat, mask, vest, wall_box], **FRAME
        )
    assert result == []


def test_derived_violation_for_bare_person(checker):
    # Hybrid behaviour: a confident person with NO hardhat and NO NO-X box is a
    # derived breach (the model often fails to emit NO-Hardhat on close-ups).
    camera_id = 9
    person = make_person(x1=0, y1=0, x2=100, y2=200)  # conf 0.9 > derivation floor
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0
        result = checker.check(camera_id=camera_id, detections=[person], **FRAME)
    types = {v.violation_type for v in result}
    assert "NO-Hardhat" in types  # derived, no NO-Hardhat detection present


def test_no_violation_before_persist_threshold(checker):
    detections = [make_person(), make_no_hardhat()]
    # last_safe_time defaults to 0.0; at t=3.0 the breach has only persisted 3s
    # (< persist_seconds=5), so no violation yet.
    with patch("time.time", return_value=3.0):
        result = checker.check(camera_id=1, detections=detections, **FRAME)
    assert result == []


def test_first_detection_initializes_timer_without_saving(checker):
    camera_id = 12
    detections = [
        make_person(),
        make_no_hardhat(),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]

    with patch("time.time", return_value=1000.0):
        first = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    state = checker._get_state(camera_id).get(None, "NO-Hardhat")
    assert first == []
    assert state.first_seen == 1000.0


def test_violation_saves_only_after_persistence_duration(checker):
    camera_id = 13
    detections = [
        make_person(),
        make_no_hardhat(),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]

    with patch("time.time", return_value=1000.0):
        assert checker.check(camera_id=camera_id, detections=detections, **FRAME) == []
    with patch("time.time", return_value=1004.9):
        assert checker.check(camera_id=camera_id, detections=detections, **FRAME) == []
    with patch("time.time", return_value=1005.0):
        result = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    assert [v.violation_type for v in result] == ["NO-Hardhat"]


def test_separate_violation_types_keep_separate_timers(checker):
    camera_id = 14
    first_frame = [
        make_person(),
        make_no_hardhat(),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]
    second_frame = [
        make_person(),
        make_no_hardhat(),
        make_no_mask(),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]

    with patch("time.time", return_value=1000.0):
        assert checker.check(camera_id=camera_id, detections=first_frame, **FRAME) == []
    with patch("time.time", return_value=1005.0):
        result = checker.check(camera_id=camera_id, detections=second_frame, **FRAME)

    assert [v.violation_type for v in result] == ["NO-Hardhat"]
    assert checker._get_state(camera_id).get(None, "NO-Mask").first_seen == 1005.0


def _churn_frame(track_id):
    # One person without a hardhat (but compliant on mask/vest), tagged with a
    # given track_id — used to simulate ByteTrack reassigning the id mid-breach.
    return [
        make_person(x1=0, y1=0, x2=100, y2=200, track_id=track_id),
        make_detection("NO-Hardhat", confidence=0.9, x1=10, y1=0, x2=90, y2=40),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]


def test_persistence_survives_track_id_churn(checker):
    # The live no-save bug: a single continuous breach must still log even when
    # the tracker hands the person a new track_id on every frame. Persistence is
    # timed per (camera, violation_type), so the 5s clock keeps accumulating
    # across id changes instead of restarting each time.
    camera_id = 15

    with patch("time.time", return_value=1000.0):
        assert checker.check(camera_id=camera_id, detections=_churn_frame(1), **FRAME) == []
    with patch("time.time", return_value=1002.0):
        assert checker.check(camera_id=camera_id, detections=_churn_frame(2), **FRAME) == []
    # By t=1005 the breach has persisted 5s despite three different track ids.
    with patch("time.time", return_value=1005.0):
        result = checker.check(camera_id=camera_id, detections=_churn_frame(3), **FRAME)

    assert [v.violation_type for v in result] == ["NO-Hardhat"]


def test_churning_track_not_logged_as_duplicate(checker):
    # The inverse risk: once a breach is logged, a churning track_id must NOT
    # produce a second record within the cooldown window, because cooldown is
    # keyed per (camera, violation_type) — not per track.
    camera_id = 16

    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0
        first = checker.check(camera_id=camera_id, detections=_churn_frame(1), **FRAME)
    # 5s later the cooldown (10s) is still active and the id has changed.
    with patch("time.time", return_value=1005.0):
        second = checker.check(camera_id=camera_id, detections=_churn_frame(2), **FRAME)

    assert len(first) == 1
    assert second == []


def test_violation_after_persist_threshold(checker):
    camera_id = 1
    detections = [make_person(), make_no_hardhat()]

    # Push last_safe_time far into the past
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 990.0

    with patch("time.time", return_value=1000.0):
        result = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    assert len(result) > 0
    assert result[0].violation_type == "NO-Hardhat"
    assert result[0].camera_id == camera_id


def test_cooldown_prevents_duplicate_alert(checker):
    camera_id = 2
    detections = [
        make_person(),
        make_no_hardhat(),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]

    # First alert at t=1000
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 980.0
        first = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    # Second check at t=1005 (only 5s later, cooldown=10)
    with patch("time.time", return_value=1005.0):
        second = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    assert len(first) > 0
    assert second == []


def test_alert_fires_again_after_cooldown(checker):
    camera_id = 3
    detections = [
        make_person(),
        make_no_hardhat(),
        make_detection("Mask", x1=10, y1=0, x2=90, y2=40),
        make_detection("Safety Vest", x1=10, y1=60, x2=90, y2=160),
    ]

    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get(None, "NO-Hardhat").first_seen = 980.0
        first = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    # After cooldown (10s) + a bit more
    with patch("time.time", return_value=1015.0):
        second = checker.check(camera_id=camera_id, detections=detections, **FRAME)

    assert len(first) > 0
    assert len(second) > 0


def test_per_camera_isolation(checker):
    detections_violation = [make_person(), make_no_hardhat()]
    detections_with_ppe = [
        make_detection("Hardhat"), make_detection("Mask"),
        make_detection("Safety Vest"), make_person(),
    ]

    with patch("time.time", return_value=1000.0):
        checker._get_state(1).get(None, "NO-Hardhat").first_seen = 980.0
        checker._get_state(2).get(None, "NO-Hardhat").first_seen = 980.0

    with patch("time.time", return_value=1000.0):
        result_cam1 = checker.check(1, detections_violation, **FRAME)
        result_cam2 = checker.check(2, detections_with_ppe, **FRAME)

    assert len(result_cam1) > 0
    assert result_cam2 == []


def test_reset_clears_state(checker):
    camera_id = 4
    checker._get_state(camera_id)
    assert camera_id in checker._states
    checker.reset(camera_id)
    assert camera_id not in checker._states
