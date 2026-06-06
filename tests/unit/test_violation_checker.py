from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.detection.detector import Detection
from backend.detection.violation_checker import ViolationChecker


def make_detection(class_name: str, confidence: float = 0.9) -> Detection:
    return Detection(
        class_id=0,
        class_name=class_name,
        confidence=confidence,
        x1=0, y1=0, x2=100, y2=100,
        color=(255, 0, 0),
    )


@pytest.fixture
def checker():
    return ViolationChecker(cooldown_seconds=10, persist_seconds=5)


def test_no_violation_when_all_ppe_present(checker):
    detections = [
        make_detection("Hardhat"), make_detection("Mask"),
        make_detection("Safety Vest"), make_detection("Person"),
    ]
    result = checker.check(camera_id=1, detections=detections)
    assert result == []


def test_no_violation_when_no_person(checker):
    detections = [make_detection("Hardhat")]
    result = checker.check(camera_id=1, detections=detections)
    assert result == []


def test_no_violation_before_persist_threshold(checker):
    detections = [make_detection("Person")]
    # Should not trigger within persist_seconds=5
    with patch("time.time", return_value=3.0):
        result = checker.check(camera_id=1, detections=detections)
    assert result == []


def test_violation_after_persist_threshold(checker):
    camera_id = 1
    detections = [make_detection("Person")]

    # Push last_safe_time far into the past
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get("NO-Hardhat").last_safe_time = 990.0

    with patch("time.time", return_value=1000.0):
        result = checker.check(camera_id=camera_id, detections=detections)

    assert len(result) > 0
    assert result[0].violation_type == "NO-Hardhat"
    assert result[0].camera_id == camera_id


def test_cooldown_prevents_duplicate_alert(checker):
    camera_id = 2
    detections = [make_detection("Person")]

    # First alert at t=1000
    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get("NO-Hardhat").last_safe_time = 980.0
        first = checker.check(camera_id=camera_id, detections=detections)

    # Second check at t=1005 (only 5s later, cooldown=10)
    with patch("time.time", return_value=1005.0):
        second = checker.check(camera_id=camera_id, detections=detections)

    assert len(first) > 0
    assert second == []


def test_alert_fires_again_after_cooldown(checker):
    camera_id = 3
    detections = [make_detection("Person")]

    with patch("time.time", return_value=1000.0):
        checker._get_state(camera_id).get("NO-Hardhat").last_safe_time = 980.0
        first = checker.check(camera_id=camera_id, detections=detections)

    # After cooldown (10s) + a bit more
    with patch("time.time", return_value=1015.0):
        second = checker.check(camera_id=camera_id, detections=detections)

    assert len(first) > 0
    assert len(second) > 0


def test_per_camera_isolation(checker):
    detections_no_ppe = [make_detection("Person")]
    detections_with_ppe = [
        make_detection("Hardhat"), make_detection("Mask"),
        make_detection("Safety Vest"), make_detection("Person"),
    ]

    with patch("time.time", return_value=1000.0):
        checker._get_state(1).get("NO-Hardhat").last_safe_time = 980.0
        checker._get_state(2).get("NO-Hardhat").last_safe_time = 980.0

    with patch("time.time", return_value=1000.0):
        result_cam1 = checker.check(1, detections_no_ppe)
        result_cam2 = checker.check(2, detections_with_ppe)

    assert len(result_cam1) > 0
    assert result_cam2 == []


def test_reset_clears_state(checker):
    camera_id = 4
    checker._get_state(camera_id)
    assert camera_id in checker._states
    checker.reset(camera_id)
    assert camera_id not in checker._states
