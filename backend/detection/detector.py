from __future__ import annotations

import pathlib
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

# Defensive normalization of raw model labels to the canonical class names the
# rest of the pipeline (violation_checker, detect routes, fines, annotation)
# keys on. Lookup is case-insensitive. Canonical names map to themselves; this
# is a no-op for the current ppe.pt model and only matters if a model emitting
# variant labels (no_helmet, NO-Vest, ...) is swapped in.
_LABEL_ALIASES: dict[str, str] = {
    "no_helmet": "NO-Hardhat",
    "no-helmet": "NO-Hardhat",
    "no_hardhat": "NO-Hardhat",
    "no-hardhat": "NO-Hardhat",
    "no_mask": "NO-Mask",
    "no-mask": "NO-Mask",
    "no_vest": "NO-Safety Vest",
    "no-vest": "NO-Safety Vest",
    "no_safety_vest": "NO-Safety Vest",
    "no-safety-vest": "NO-Safety Vest",
    "helmet": "Hardhat",
    "hardhat": "Hardhat",
    "mask": "Mask",
    "vest": "Safety Vest",
    "safety_vest": "Safety Vest",
    "safety-vest": "Safety Vest",
    "person": "Person",
}


def normalize_class_name(raw: str) -> str:
    """Map a raw model label to its canonical pipeline name (identity if unknown)."""
    return _LABEL_ALIASES.get(raw.strip().lower(), raw)


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
    track_id: int | None = None


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


def _containment(inner: Detection, outer: Detection) -> float:
    """Fraction of ``inner``'s area that lies inside ``outer`` (0..1)."""
    ix1, iy1 = max(inner.x1, outer.x1), max(inner.y1, outer.y1)
    ix2, iy2 = min(inner.x2, outer.x2), min(inner.y2, outer.y2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    inner_area = max(0, inner.x2 - inner.x1) * max(0, inner.y2 - inner.y1)
    return inter / inner_area if inner_area > 0 else 0.0


def _area(d: Detection) -> int:
    return max(0, d.x2 - d.x1) * max(0, d.y2 - d.y1)


def _dedup_persons(
    detections: list[Detection],
    iou_threshold: float,
    containment_threshold: float,
    dbg: bool = False,
) -> list[Detection]:
    """Collapse duplicate/ghost Person boxes onto one body.

    Belt-and-suspenders for the case where a low-confidence head/body box on the
    same person has IoU below YOLO's own (class-aware) NMS threshold. Two Person
    boxes are treated as the same body when they overlap by ``iou_threshold`` IoU
    OR one is ``containment_threshold`` contained in the other. The larger
    full-body box is kept (it wins ties on confidence). Only Person boxes are
    considered — PPE boxes legitimately sit inside a person and are never merged
    or dropped here.
    """
    persons = [d for d in detections if d.class_name == "Person"]
    if len(persons) < 2:
        return detections

    # Largest first so a body box absorbs the smaller head/partial boxes.
    order = sorted(persons, key=lambda d: (_area(d), d.confidence), reverse=True)
    suppressed: set[int] = set()
    for i, keep in enumerate(order):
        if id(keep) in suppressed:
            continue
        for other in order[i + 1:]:
            if id(other) in suppressed:
                continue
            if _iou(keep, other) >= iou_threshold or _containment(other, keep) >= containment_threshold:
                suppressed.add(id(other))
                if dbg:
                    logger.info(
                        "[DETECT] merged duplicate Person (%.2f) at [%d,%d,%d,%d] "
                        "into larger box (%.2f) — ghost-person dedup",
                        other.confidence, other.x1, other.y1, other.x2, other.y2,
                        keep.confidence,
                    )

    return [d for d in detections if id(d) not in suppressed]


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


def _resolve_model_backend(model_path: str) -> tuple[str, str]:
    """Pick the fastest CPU-runnable model artifact available next to model_path.

    Prefers an OpenVINO export folder, then an ONNX export, falling back to the
    configured .pt weights if neither optimized artifact exists or its runtime
    package isn't installed. Never raises — a missing optimized backend is a
    silent fallback, not a startup failure. Returns (resolved_path, backend)
    where backend is one of "openvino", "onnx", "pt".
    """
    base_dir = pathlib.Path(model_path).parent
    openvino_dir = base_dir / "ppe_openvino_model"
    onnx_path = base_dir / "ppe.onnx"

    if openvino_dir.is_dir():
        try:
            import openvino  # noqa: F401

            return str(openvino_dir), "openvino"
        except ImportError:
            logger.warning(
                "Found OpenVINO export at %s but the 'openvino' package is not "
                "installed — falling back. Run: pip install openvino",
                openvino_dir,
            )

    if onnx_path.is_file():
        try:
            import onnxruntime  # noqa: F401

            return str(onnx_path), "onnx"
        except ImportError:
            logger.warning(
                "Found ONNX export at %s but the 'onnxruntime' package is not "
                "installed — falling back. Run: pip install onnxruntime",
                onnx_path,
            )

    return model_path, "pt"


def _detect_fixed_input_size(resolved_path: str, backend: str) -> int | None:
    """Return the model's required square input size if its export has a
    static (non-dynamic) input shape, else None.

    A static-shape ONNX/OpenVINO export (one not exported with
    ``dynamic=True``) raises an opaque shape-mismatch error from the runtime
    if ``model.predict()`` is ever called with a different ``imgsz`` — e.g.
    the image/video upload paths' smaller IMAGE_YOLO_IMGSZ/VIDEO_YOLO_IMGSZ.
    Detecting this at load time lets _detect_at force the correct size
    instead of letting that reach the caller as a 500. Never raises — failure
    to introspect just means no clamp is applied (same as today, for any
    backend whose shape can't be determined).
    """
    try:
        if backend == "onnx":
            import onnxruntime

            sess = onnxruntime.InferenceSession(resolved_path, providers=["CPUExecutionProvider"])
            shape = sess.get_inputs()[0].shape  # e.g. [1, 3, 640, 640] or [1, 3, 'height', 'width']
            h, w = shape[2], shape[3]
            if isinstance(h, int) and isinstance(w, int) and h == w:
                return h
        elif backend == "openvino":
            import openvino as ov

            core = ov.Core()
            base = pathlib.Path(resolved_path)
            xml = base if base.is_file() else next(base.glob("*.xml"))
            ov_model = core.read_model(str(xml))
            shape = ov_model.inputs[0].get_partial_shape()
            h_dim, w_dim = shape[2], shape[3]
            if h_dim.is_static and w_dim.is_static and h_dim.get_length() == w_dim.get_length():
                return h_dim.get_length()
    except Exception as exc:
        logger.debug("Could not introspect %s input shape for %s: %s", backend, resolved_path, exc)
    return None


class PPEDetector:
    def __init__(self, model_path: str, confidence: float = 0.5) -> None:
        from ultralytics import YOLO

        resolved_path, backend = _resolve_model_backend(model_path)
        self.model = YOLO(resolved_path)
        self.model.overrides['verbose'] = False
        self._is_cpu_optimized = backend in ("openvino", "onnx")
        # Device used for both model.overrides and every model.predict() call
        # below. OpenVINO is the only backend Ultralytics can route to a
        # non-CPU device (see settings.YOLO_OPENVINO_DEVICE) — its GPU plugin
        # falls back to AUTO/CPU on its own if the device isn't available.
        # ONNX Runtime only ever checks torch.cuda.is_available() (no
        # Intel/DirectML provider support) and .pt always runs via torch, so
        # both stay pinned to 'cpu'.
        self._predict_device = settings.YOLO_OPENVINO_DEVICE if backend == "openvino" else 'cpu'
        self.model.overrides['device'] = self._predict_device
        # ONNX Runtime (CPU EP) / .pt-on-CPU do not support FP16; applying the
        # half override would cause a silent fallback. Skip it for both — FP32
        # is used instead. OpenVINO's IR precision is fixed at export time,
        # not by this runtime override, so this skip is unaffected by which
        # device it runs on.
        if not self._is_cpu_optimized:
            self.model.overrides['half'] = settings.YOLO_HALF_PRECISION
        # If this export has a static input shape, every detect() call must
        # use that exact size — see _detect_fixed_input_size.
        self._fixed_imgsz = (
            _detect_fixed_input_size(resolved_path, backend) if self._is_cpu_optimized else None
        )
        if self._fixed_imgsz:
            logger.info(
                "PPEDetector: %s export has a static %dx%d input — every "
                "detect() call will use this size regardless of requested imgsz.",
                backend, self._fixed_imgsz, self._fixed_imgsz,
            )
        self.confidence = confidence
        self.violation_confidence = settings.VIOLATION_CONFIDENCE
        self.conflict_iou = settings.CONFLICT_IOU_THRESHOLD
        self.hardhat_color_veto = settings.ENABLE_HARDHAT_COLOR_VETO
        self.person_floor = settings.PERSON_CONFIDENCE_FLOOR
        self.person_dedup_iou = settings.PERSON_DEDUP_IOU
        self.person_dedup_containment = settings.PERSON_DEDUP_CONTAINMENT
        # Per-class confidence floors, applied uniformly in _detect_at. Person and
        # NO-X classes already had dedicated floors; Hardhat/Mask/Safety Vest each
        # get their own too — Safety Vest sits higher because large solid-color
        # background regions are this class's main false-positive source.
        self.class_confidence_floors: dict[str, float] = {
            "Person": self.person_floor,
            "Hardhat": settings.HARDHAT_MASK_CONFIDENCE_FLOOR,
            "Mask": settings.HARDHAT_MASK_CONFIDENCE_FLOOR,
            "Safety Vest": settings.VEST_CONFIDENCE_FLOOR,
            "NO-Hardhat": self.violation_confidence,
            "NO-Mask": self.violation_confidence,
            "NO-Safety Vest": self.violation_confidence,
        }
        logger.info(
            "PPEDetector loaded: %s [%s -> %s] (conf=%.2f, viol_conf=%.2f, color_veto=%s)",
            resolved_path, backend, self._predict_device,
            confidence, self.violation_confidence, self.hardhat_color_veto,
        )

    @property
    def class_names(self) -> dict[int, str]:
        return self.model.names

    def detect(
        self,
        frame: np.ndarray,
        conf: float | None = None,
        debug: bool | None = None,
        stats: dict | None = None,
        imgsz: int | None = None,
    ) -> list[Detection]:
        """Run detection at the per-camera (or default) confidence.

        Tiered fallback: if the frame yields no ``Person`` at the configured
        threshold, retry once at ``max(0.20, conf - 0.20)``. This recovers
        borderline frames (indoor webcam, motion blur) without lowering the
        admin-set threshold for normal site cameras. When ``stats`` is given,
        ``stats["tiered_fallback"]`` is set True if the retry was used.

        ``imgsz`` overrides the YOLO input size for this call only (defaults to
        ``settings.YOLO_IMGSZ``). The uploaded-video path passes a smaller size
        to keep CPU inference fast; the live camera leaves it None.
        """
        effective_conf = conf if conf is not None else self.confidence
        dbg = settings.WEBCAM_DEBUG if debug is None else debug
        effective_imgsz = imgsz if imgsz is not None else settings.YOLO_IMGSZ

        detections = self._detect_at(frame, effective_conf, dbg, effective_imgsz)

        if not any(d.class_name == "Person" for d in detections):
            retry_conf = max(0.20, round(effective_conf - 0.20, 2))
            if retry_conf < effective_conf:
                retry_dets = self._detect_at(frame, retry_conf, dbg, effective_imgsz)
                if retry_dets:
                    if dbg:
                        logger.info(
                            "[DETECT] tiered fallback: no Person at conf>=%.2f, "
                            "retried at conf>=%.2f -> %d box(es)",
                            effective_conf, retry_conf, len(retry_dets),
                        )
                    if stats is not None:
                        stats["tiered_fallback"] = True
                    detections = retry_dets

        return detections

    def _detect_at(
        self, frame: np.ndarray, effective_conf: float, dbg: bool,
        imgsz: int | None = None,
    ) -> list[Detection]:
        # Frame bounds — every bbox is clamped inside these so a box can never
        # be drawn (or matched) outside the visible image.
        frame_h, frame_w = frame.shape[:2]

        # CPU preprocessing shortcut: shrink the frame (aspect-preserved)
        # before YOLO's own letterbox/resize step, so it has fewer pixels to
        # process. Boxes are rescaled back to frame_w/frame_h below, so every
        # downstream consumer still sees the original frame's coordinates.
        predict_source = frame
        scale_x = scale_y = 1.0
        max_w = settings.YOLO_PREPROCESS_MAX_WIDTH
        if max_w and frame_w > max_w:
            scale = max_w / frame_w
            new_w = max_w
            new_h = max(1, int(round(frame_h * scale)))
            predict_source = cv2.resize(frame, (new_w, new_h))
            scale_x = frame_w / new_w
            scale_y = frame_h / new_h

        results = self.model.predict(
            source=predict_source,
            conf=effective_conf,
            iou=settings.YOLO_NMS_IOU,
            imgsz=self._fixed_imgsz or (imgsz if imgsz is not None else settings.YOLO_IMGSZ),
            vid_stride=settings.YOLO_VID_STRIDE,
            half=settings.YOLO_HALF_PRECISION and not self._is_cpu_optimized,
            device=self._predict_device,
            verbose=settings.YOLO_VERBOSE,
            stream=True,
        )
        detections: list[Detection] = []
        raw_log: list[str] = []

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls = int(box.cls[0])
                class_name = normalize_class_name(self.model.names[cls])
                confidence = float(box.conf[0])
                if dbg:
                    raw_log.append(f"{class_name}={confidence:.2f}")

                # Per-class confidence floor (Person, Hardhat/Mask, Safety Vest,
                # NO-X each have their own — see PPEDetector.__init__). Classes
                # with no dedicated floor (Vehicle, Machinery, Cone) just use the
                # base detection threshold already applied by model.predict().
                floor = self.class_confidence_floors.get(class_name)
                if floor is not None and confidence < floor:
                    if dbg:
                        logger.info(
                            "[DETECT] dropped %s (%.2f) — below %s floor %.2f",
                            class_name, confidence, class_name, floor,
                        )
                    continue

                # Scale back up to the original frame (no-op when the
                # pre-inference downscale above didn't trigger), then clamp to
                # frame bounds — YOLO can emit coords a few px outside the
                # image, which otherwise produces boxes/labels drawn off-frame.
                x1 = max(0, min(int(box.xyxy[0][0] * scale_x), frame_w - 1))
                y1 = max(0, min(int(box.xyxy[0][1] * scale_y), frame_h - 1))
                x2 = max(0, min(int(box.xyxy[0][2] * scale_x), frame_w - 1))
                y2 = max(0, min(int(box.xyxy[0][3] * scale_y), frame_h - 1))
                if x2 <= x1 or y2 <= y1:
                    continue  # degenerate after clamping

                detections.append(
                    Detection(
                        class_id=cls,
                        class_name=class_name,
                        confidence=confidence,
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                        color=CLASS_COLORS.get(cls, (200, 200, 200)),
                    )
                )

        if dbg:
            logger.info(
                "[DETECT] raw YOLO (conf>=%.2f): %s",
                effective_conf, ", ".join(raw_log) if raw_log else "(none)",
            )

        # Class-pair NMS: kill (Hardhat ↔ NO-Hardhat), (Mask ↔ NO-Mask),
        # (Safety Vest ↔ NO-Safety Vest) overlaps by keeping the higher-conf box.
        # Secondary person-dedup safety net: collapse near-duplicate Person boxes
        # (one body counted twice) that slipped past YOLO's own NMS. Runs before
        # conflict suppression so a phantom person can't anchor a stray NO-X box.
        detections = _dedup_persons(
            detections, self.person_dedup_iou, self.person_dedup_containment, dbg,
        )

        before_conflict = detections
        detections = _suppress_conflicts(detections, self.conflict_iou)
        if dbg and len(detections) != len(before_conflict):
            kept_ids = {id(d) for d in detections}
            for d in before_conflict:
                if id(d) not in kept_ids:
                    logger.info(
                        "[DETECT] dropped %s (%.2f) — conflict NMS (overlapping PPE pair)",
                        d.class_name, d.confidence,
                    )

        # Color-based veto for NO-Hardhat: hardhats are visually distinctive
        # safety colors, and the model commonly mislabels a real hardhat as
        # NO-Hardhat. If the head region is brightly saturated, drop the box.
        if self.hardhat_color_veto:
            kept: list[Detection] = []
            for d in detections:
                if d.class_name == "NO-Hardhat" and _has_helmet_color(frame, d):
                    if dbg:
                        logger.info(
                            "[DETECT] dropped NO-Hardhat (%.2f) at [%d,%d,%d,%d] — helmet color veto",
                            d.confidence, d.x1, d.y1, d.x2, d.y2,
                        )
                    continue
                kept.append(d)
            detections = kept

        return detections
