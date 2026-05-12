from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

# BGR colours used for detection overlays.
CLASS_COLORS: dict[int, tuple[int, int, int]] = {
    0: (255, 0, 0),    # Hardhat
    1: (0, 255, 0),    # Mask
    2: (0, 0, 255),    # NO-Hardhat
    3: (255, 255, 0),  # NO-Mask
    4: (255, 0, 255),  # NO-Safety Vest
    5: (0, 255, 255),  # Person
    6: (128, 0, 128),  # Safety Cone
    7: (128, 128, 0),  # Safety Vest
    8: (0, 128, 128),  # Machinery
    9: (128, 128, 128),  # Vehicle
}

# Pairs of (PPE-present class, violation class) used for conflict suppression
# and confidence-floor filtering.
CONFLICT_PAIRS: list[tuple[str, str]] = [
    ("Hardhat", "NO-Hardhat"),
    ("Mask", "NO-Mask"),
    ("Safety Vest", "NO-Safety Vest"),
]
VIOLATION_CLASSES: set[str] = {v for _, v in CONFLICT_PAIRS}


@dataclass
class Detection:
    class_id: int
    class_name: str
    confidence: float
    x1: int
    y1: int
    x2: int
    y2: int
    color: tuple[int, int, int]


def _iou(a: Detection, b: Detection) -> float:
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = max(0, a.x2 - a.x1) * max(0, a.y2 - a.y1)
    area_b = max(0, b.x2 - b.x1) * max(0, b.y2 - b.y1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _has_helmet_color(frame: np.ndarray, det: Detection) -> bool:
    """True if the upper portion of the bbox contains a substantial bright,
    saturated region — characteristic of safety helmets (orange/yellow/red/
    white/blue). Used to veto NO-Hardhat false positives.
    """
    h, w = frame.shape[:2]
    box_h = det.y2 - det.y1
    # Focus on top half — that's where the helmet would be on a person bbox,
    # or the entire box if the detection is already a head-sized region.
    y2_head = det.y1 + max(1, box_h // 2) if box_h > 6 else det.y2
    x1, y1 = max(0, det.x1), max(0, det.y1)
    x2, y2 = min(w, det.x2), min(h, y2_head)
    if x2 <= x1 or y2 <= y1:
        return False
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return False
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1]
    val = hsv[..., 2]
    # Bright AND saturated (any safety hue) OR very bright + low sat (white helmet)
    safety_hue = (sat >= 110) & (val >= 110)
    white_hat  = (sat <  60)  & (val >= 200)
    mask = safety_hue | white_hat
    return float(mask.mean()) > 0.18  # >18% of head region


def _suppress_conflicts(
    detections: list[Detection],
    iou_threshold: float,
) -> list[Detection]:
    """When a PPE-present class and its NO-X counterpart overlap on the same
    region, keep only the higher-confidence detection.
    """
    if not detections:
        return detections
    by_class: dict[str, list[Detection]] = {}
    for d in detections:
        by_class.setdefault(d.class_name, []).append(d)

    suppressed: set[int] = set()
    for present_cls, missing_cls in CONFLICT_PAIRS:
        present_dets = by_class.get(present_cls, [])
        missing_dets = by_class.get(missing_cls, [])
        if not present_dets or not missing_dets:
            continue
        for pd in present_dets:
            for md in missing_dets:
                if _iou(pd, md) < iou_threshold:
                    continue
                loser = md if pd.confidence >= md.confidence else pd
                suppressed.add(id(loser))

    return [d for d in detections if id(d) not in suppressed]


class PPEDetector:
    def __init__(self, model_path: str, confidence: float = 0.5) -> None:
        from ultralytics import YOLO

        self.model = YOLO(model_path)
        self.confidence = confidence
        self.violation_confidence = settings.VIOLATION_CONFIDENCE
        self.conflict_iou = settings.CONFLICT_IOU_THRESHOLD
        self.hardhat_color_veto = settings.ENABLE_HARDHAT_COLOR_VETO
        logger.info(
            "PPEDetector loaded: %s (conf=%.2f, viol_conf=%.2f, color_veto=%s)",
            model_path, confidence, self.violation_confidence, self.hardhat_color_veto,
        )

    @property
    def class_names(self) -> dict[int, str]:
        return self.model.names

    def detect(self, frame: np.ndarray, conf: float | None = None) -> list[Detection]:
        effective_conf = conf if conf is not None else self.confidence
        results = self.model(frame, conf=effective_conf, verbose=False)
        detections: list[Detection] = []

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls = int(box.cls[0])
                class_name = self.model.names[cls]
                confidence = float(box.conf[0])

                # Stricter floor for "NO-X" violation classes — these are the
                # noisiest predictions on most off-the-shelf PPE YOLO models.
                if class_name in VIOLATION_CLASSES and confidence < self.violation_confidence:
                    continue

                detections.append(
                    Detection(
                        class_id=cls,
                        class_name=class_name,
                        confidence=confidence,
                        x1=int(box.xyxy[0][0]),
                        y1=int(box.xyxy[0][1]),
                        x2=int(box.xyxy[0][2]),
                        y2=int(box.xyxy[0][3]),
                        color=CLASS_COLORS.get(cls, (200, 200, 200)),
                    )
                )

        # Class-pair NMS: kill (Hardhat ↔ NO-Hardhat), (Mask ↔ NO-Mask),
        # (Safety Vest ↔ NO-Safety Vest) overlaps by keeping the higher-conf box.
        detections = _suppress_conflicts(detections, self.conflict_iou)

        # Color-based veto for NO-Hardhat: hardhats are visually distinctive
        # safety colors, and the model commonly mislabels a real hardhat as
        # NO-Hardhat. If the head region is brightly saturated, drop the box.
        if self.hardhat_color_veto:
            kept: list[Detection] = []
            for d in detections:
                if d.class_name == "NO-Hardhat" and _has_helmet_color(frame, d):
                    logger.debug(
                        "Vetoed NO-Hardhat (%.2f) at [%d,%d,%d,%d] — helmet color present",
                        d.confidence, d.x1, d.y1, d.x2, d.y2,
                    )
                    continue
                kept.append(d)
            detections = kept

        return detections
