from types import SimpleNamespace

from backend.detection.auto_identifier import (
    _person_bbox_from_violation,
    _single_person_bbox,
)
from backend.detection.detector import Detection


def _person_box(x1=1, y1=2, x2=3, y2=4):
    return Detection(
        class_id=0,
        class_name="Person",
        confidence=0.95,
        x1=x1,
        y1=y1,
        x2=x2,
        y2=y2,
        color=(0, 255, 0),
    )


def test_person_bbox_from_violation_uses_stored_bbox():
    violation = SimpleNamespace(person_bbox="[10, 20, 30, 40]")

    assert _person_bbox_from_violation(violation) == (10, 20, 30, 40)


def test_person_bbox_from_violation_rejects_invalid_bbox():
    violation = SimpleNamespace(person_bbox="[10, 20, 30]")

    assert _person_bbox_from_violation(violation) is None


def test_single_person_bbox_requires_exactly_one_person():
    non_person = Detection(
        class_id=1,
        class_name="Hardhat",
        confidence=0.9,
        x1=9,
        y1=9,
        x2=12,
        y2=12,
        color=(255, 0, 0),
    )

    assert _single_person_bbox([_person_box(), non_person]) == (1, 2, 3, 4)
    assert _single_person_bbox([_person_box(), _person_box(5, 6, 7, 8)]) is None
    assert _single_person_bbox([non_person]) is None
