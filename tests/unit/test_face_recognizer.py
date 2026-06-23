from __future__ import annotations

import math

import numpy as np
import pytest

from backend.core.config import settings
from backend.detection.face_recognizer import FaceRecognizer


def _vec(distance: float) -> np.ndarray:
    """2D unit vector whose cosine distance from query [1, 0] equals `distance`.

    cosine_distance = 1 - cos(theta), so cos(theta) = 1 - distance.
    """
    cos_theta = 1.0 - distance
    sin_theta = math.sqrt(max(0.0, 1.0 - cos_theta * cos_theta))
    return np.array([cos_theta, sin_theta], dtype=np.float32)


QUERY = np.array([1.0, 0.0], dtype=np.float32)


def _recognizer(*workers: tuple[int, float]) -> FaceRecognizer:
    fr = FaceRecognizer()
    for worker_id, distance in workers:
        fr.register_worker(worker_id, _vec(distance).tolist())
    return fr


def test_no_enrolled_workers_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "FACE_MATCH_THRESHOLD", 0.40)
    monkeypatch.setattr(settings, "FACE_MATCH_MARGIN", 0.08)
    fr = FaceRecognizer()

    worker_id, best, second, reason = fr.match_embedding(QUERY)

    assert worker_id is None
    assert reason == "no_enrolled_workers"


def test_below_threshold_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "FACE_MATCH_THRESHOLD", 0.40)
    monkeypatch.setattr(settings, "FACE_MATCH_MARGIN", 0.08)
    # Single enrolled worker that is far away (distance 0.5 >= threshold 0.40).
    fr = _recognizer((1, 0.5))

    worker_id, best, second, reason = fr.match_embedding(QUERY)

    assert worker_id is None
    assert reason == "below_threshold"
    assert best == pytest.approx(0.5, abs=1e-4)


def test_ambiguous_match_returns_none(monkeypatch):
    monkeypatch.setattr(settings, "FACE_MATCH_THRESHOLD", 0.40)
    monkeypatch.setattr(settings, "FACE_MATCH_MARGIN", 0.08)
    # Two confident-but-near-equidistant workers (0.10 and 0.12): both under the
    # threshold, but the gap (0.02) is smaller than the 0.08 margin -> ambiguous.
    fr = _recognizer((1, 0.10), (2, 0.12))

    worker_id, best, second, reason = fr.match_embedding(QUERY)

    assert worker_id is None
    assert reason == "ambiguous_match"


def test_clear_confident_match_returns_worker(monkeypatch):
    monkeypatch.setattr(settings, "FACE_MATCH_THRESHOLD", 0.40)
    monkeypatch.setattr(settings, "FACE_MATCH_MARGIN", 0.08)
    # Worker 1 is essentially identical (distance ~0), worker 2 is orthogonal
    # (distance 1.0): confident AND unambiguous.
    fr = _recognizer((1, 0.0), (2, 1.0))

    worker_id, best, second, reason = fr.match_embedding(QUERY)

    assert worker_id == 1
    assert reason == "matched"


def test_register_worker_replaces_existing_encoding(monkeypatch):
    monkeypatch.setattr(settings, "FACE_MATCH_THRESHOLD", 0.40)
    monkeypatch.setattr(settings, "FACE_MATCH_MARGIN", 0.08)
    # Worker 1 starts essentially identical to QUERY (distance ~0).
    fr = _recognizer((1, 0.0))

    # Re-enroll worker 1 with a brand-new, orthogonal (distance 1.0) embedding —
    # simulates re-registering a worker with a different face photo.
    fr.register_worker(1, _vec(1.0).tolist())

    assert len(fr._encodings) == 1
    assert len(fr._worker_ids) == 1

    # The OLD close encoding must be gone, not merely appended alongside the
    # new one — matching against QUERY should now reflect the new (far) encoding.
    worker_id, best, second, reason = fr.match_embedding(QUERY)
    assert reason == "below_threshold"
    assert worker_id is None
    assert best == pytest.approx(1.0, abs=1e-4)


def test_identify_face_no_face_detected_returns_none(monkeypatch):
    """enforce_detection=True means DeepFace raises ValueError when no face is
    found — identify_face() must catch this and return None, not fabricate a
    match from non-face pixels."""
    fr = FaceRecognizer()
    fr._model = object()  # bypass the "model not loaded" early return
    fr.register_worker(1, _vec(0.0).tolist())  # bypass the "no enrolled workers" early return

    def _raise_no_face(*args, **kwargs):
        raise ValueError("Face could not be detected.")

    monkeypatch.setattr("deepface.DeepFace.represent", _raise_no_face)

    frame = np.zeros((20, 20, 3), dtype=np.uint8)
    result = fr.identify_face(frame, (0, 0, 10, 10))

    assert result is None


def test_identify_face_passes_consistent_deepface_kwargs(monkeypatch):
    """encode_face() (enrollment) and identify_face() (recognition) must call
    DeepFace.represent with identical settings, or the two embeddings are not
    comparable."""
    fr = FaceRecognizer()
    fr._model = object()
    fr.register_worker(1, _vec(0.0).tolist())

    captured: dict = {}

    def _fake_represent(img, **kwargs):
        captured.update(kwargs)
        return [{"embedding": [1.0, 0.0]}]

    monkeypatch.setattr("deepface.DeepFace.represent", _fake_represent)
    monkeypatch.setattr(settings, "FACE_DETECTOR_BACKEND", "yunet")

    frame = np.zeros((20, 20, 3), dtype=np.uint8)
    fr.identify_face(frame, (0, 0, 10, 10))

    assert captured["model_name"] == "Facenet"
    assert captured["detector_backend"] == "yunet"
    assert captured["enforce_detection"] is True
    assert captured["align"] is True


def test_identify_unique_worker_single_match(monkeypatch):
    fr = FaceRecognizer()
    monkeypatch.setattr(fr, "identify_face", lambda frame, box: {(0, 0, 1, 1): 7}.get(box))

    assert fr.identify_unique_worker(None, [(0, 0, 1, 1)]) == 7


def test_identify_unique_worker_no_match(monkeypatch):
    fr = FaceRecognizer()
    monkeypatch.setattr(fr, "identify_face", lambda frame, box: None)

    assert fr.identify_unique_worker(None, [(0, 0, 1, 1), (2, 2, 3, 3)]) is None


def test_identify_unique_worker_duplicate_boxes_same_worker(monkeypatch):
    fr = FaceRecognizer()
    monkeypatch.setattr(fr, "identify_face", lambda frame, box: 3)

    assert fr.identify_unique_worker(None, [(0, 0, 1, 1), (2, 2, 3, 3)]) == 3


def test_identify_unique_worker_ambiguous_returns_none(monkeypatch):
    fr = FaceRecognizer()
    mapping = {(0, 0, 1, 1): 1, (2, 2, 3, 3): 2}
    monkeypatch.setattr(fr, "identify_face", lambda frame, box: mapping.get(box))

    assert fr.identify_unique_worker(None, list(mapping.keys())) is None


def test_identify_unique_worker_empty_boxes_returns_none(monkeypatch):
    fr = FaceRecognizer()
    monkeypatch.setattr(fr, "identify_face", lambda frame, box: 1)

    assert fr.identify_unique_worker(None, []) is None
