from __future__ import annotations

import numpy as np

from backend.core.detector import Detection, _iou
from backend.core.logging import get_logger

logger = get_logger(__name__)


class PersonTracker:
    """Wraps deep-sort-realtime to assign persistent track IDs to Person detections."""

    def __init__(
        self,
        max_age: int = 30,
        n_init: int = 3,
        max_cosine_distance: float = 0.3,
        embedder: str = "mobilenet",
    ) -> None:
        self._max_age = max_age
        self._n_init = n_init
        self._max_cosine_distance = max_cosine_distance
        self._embedder = embedder
        # One DeepSort instance per camera (lazy-init)
        self._trackers: dict[int, object] = {}

    def _get_tracker(self, camera_id: int):
        if camera_id not in self._trackers:
            from deep_sort_realtime.deepsort_tracker import DeepSort

            self._trackers[camera_id] = DeepSort(
                max_age=self._max_age,
                n_init=self._n_init,
                max_cosine_distance=self._max_cosine_distance,
                embedder=self._embedder,
            )
            logger.info("DeepSORT tracker created for camera %d", camera_id)
        return self._trackers[camera_id]

    def track(
        self, camera_id: int, detections: list[Detection], frame: np.ndarray
    ) -> list[Detection]:
        """Enrich Person detections with track_id. Returns the full (mutated) list."""
        person_dets = [d for d in detections if d.class_name == "Person"]
        if not person_dets:
            return detections

        tracker = self._get_tracker(camera_id)

        # DeepSORT input: list of ([x, y, w, h], confidence, class_name)
        raw = []
        for d in person_dets:
            w = d.x2 - d.x1
            h = d.y2 - d.y1
            raw.append(([d.x1, d.y1, w, h], d.confidence, "Person"))

        tracks = tracker.update_tracks(raw, frame=frame)

        # Match confirmed tracks back to Person detections by highest IoU
        confirmed = [t for t in tracks if t.is_confirmed()]
        for track in confirmed:
            ltrb = track.to_ltrb()
            # Create a temporary Detection for IoU calculation
            track_det = Detection(
                class_id=5,
                class_name="Person",
                confidence=0.0,
                x1=int(ltrb[0]),
                y1=int(ltrb[1]),
                x2=int(ltrb[2]),
                y2=int(ltrb[3]),
                color=(0, 0, 0),
            )
            best_iou = 0.0
            best_det = None
            for d in person_dets:
                iou = _iou(track_det, d)
                if iou > best_iou:
                    best_iou = iou
                    best_det = d
            if best_det is not None and best_iou > 0.3:
                best_det.track_id = track.track_id

        return detections

    def reset(self, camera_id: int) -> None:
        """Remove tracker state for a camera (called on stop)."""
        removed = self._trackers.pop(camera_id, None)
        if removed:
            logger.info("DeepSORT tracker reset for camera %d", camera_id)
