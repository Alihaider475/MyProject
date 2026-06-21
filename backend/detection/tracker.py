from __future__ import annotations

import numpy as np

from backend.detection.detector import Detection
from backend.core.logging import get_logger

logger = get_logger(__name__)


class _DetBoxes:
    """Minimal Ultralytics ``Boxes``-compatible view over a set of detections.

    ``BYTETracker.update`` only needs ``conf``/``cls``/``xywh`` arrays, boolean
    mask indexing (``boxes[mask]`` -> sliced view) and ``len()``. We back those
    with plain NumPy arrays built from our ``Detection`` objects so we can feed
    ByteTrack without constructing a full YOLO ``Results`` object.
    """

    __slots__ = ("xyxy", "xywh", "conf", "cls")

    def __init__(
        self,
        xyxy: np.ndarray,
        xywh: np.ndarray,
        conf: np.ndarray,
        cls: np.ndarray,
    ) -> None:
        self.xyxy = xyxy
        self.xywh = xywh
        self.conf = conf
        self.cls = cls

    def __len__(self) -> int:
        return len(self.conf)

    def __getitem__(self, mask) -> "_DetBoxes":
        return _DetBoxes(
            self.xyxy[mask], self.xywh[mask], self.conf[mask], self.cls[mask]
        )


class PersonTracker:
    """Wraps Ultralytics ByteTrack to assign persistent track IDs to Person detections.

    One ``BYTETracker`` instance is kept per camera (lazy-init) so multiple
    simultaneous feeds never share or collide track IDs. ByteTrack is a
    motion-only tracker (Kalman + IoU); it has no appearance embedder, which is
    why it replaced the previous DeepSORT + MobileNet pipeline.
    """

    def __init__(
        self,
        track_buffer: int = 30,
        match_thresh: float = 0.8,
        track_high_thresh: float = 0.25,
        track_low_thresh: float = 0.1,
        new_track_thresh: float = 0.25,
    ) -> None:
        from ultralytics.utils import IterableSimpleNamespace, YAML
        from ultralytics.utils.checks import check_yaml

        # Start from the shipped bytetrack.yaml so any fields BYTETracker expects
        # are present, then override the knobs we expose via settings.
        base = YAML.load(check_yaml("bytetrack.yaml"))
        base.update(
            {
                "track_buffer": track_buffer,
                "match_thresh": match_thresh,
                "track_high_thresh": track_high_thresh,
                "track_low_thresh": track_low_thresh,
                "new_track_thresh": new_track_thresh,
            }
        )
        self._args = IterableSimpleNamespace(**base)
        # One BYTETracker instance per camera (lazy-init)
        self._trackers: dict[int, object] = {}

    def _get_tracker(self, camera_id: int):
        if camera_id not in self._trackers:
            from ultralytics.trackers.byte_tracker import BYTETracker

            self._trackers[camera_id] = BYTETracker(self._args)
            logger.info("ByteTrack tracker created for camera %d", camera_id)
        return self._trackers[camera_id]

    def track(
        self, camera_id: int, detections: list[Detection], frame: np.ndarray
    ) -> list[Detection]:
        """Enrich Person detections with track_id. Returns the full (mutated) list."""
        person_dets = [d for d in detections if d.class_name == "Person"]
        if not person_dets:
            return detections

        tracker = self._get_tracker(camera_id)

        n = len(person_dets)
        xyxy = np.empty((n, 4), dtype=np.float32)
        xywh = np.empty((n, 4), dtype=np.float32)
        conf = np.empty(n, dtype=np.float32)
        cls = np.zeros(n, dtype=np.float32)  # single "Person" class
        for i, d in enumerate(person_dets):
            xyxy[i] = (d.x1, d.y1, d.x2, d.y2)
            w = d.x2 - d.x1
            h = d.y2 - d.y1
            xywh[i] = (d.x1 + w / 2.0, d.y1 + h / 2.0, w, h)
            conf[i] = d.confidence

        boxes = _DetBoxes(xyxy, xywh, conf, cls)

        # Rows: [x1, y1, x2, y2, track_id, score, cls, idx] — idx maps back to the
        # input Person detection exactly, so no IoU rematch is needed.
        rows = tracker.update(boxes, frame)
        for row in rows:
            idx = int(row[7])
            if 0 <= idx < n:
                person_dets[idx].track_id = int(row[4])

        return detections

    def reset(self, camera_id: int) -> None:
        """Remove tracker state for a camera (called on stop)."""
        removed = self._trackers.pop(camera_id, None)
        if removed is not None:
            logger.info("ByteTrack tracker reset for camera %d", camera_id)
