from __future__ import annotations

import io

from PIL import Image as PILImage

from backend.detection.association import derive_candidates

# Maps each PPE item → its corresponding "missing" violation class in the model.
PPE_PAIRS: dict[str, str] = {
    "Hardhat": "NO-Hardhat",
    "Mask": "NO-Mask",
    "Safety Vest": "NO-Safety Vest",
}


def compress(jpeg_bytes: bytes, max_width: int = 800, quality: int = 85) -> bytes:
    img = PILImage.open(io.BytesIO(jpeg_bytes))
    w, h = img.size
    if w > max_width:
        img = img.resize((max_width, int(h * max_width / w)), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def build_violations(
    detections: list, frame_w: int, frame_h: int
) -> tuple[list[dict], int]:
    """Per-PPE-item compliance for a single frame: violation / compliant / not assessed.

    Uses the SAME shared hybrid logic as the live camera path
    (:func:`backend.detection.association.derive_candidates`), so the same frame
    yields the same violations whether it arrives via the webcam stream, an
    uploaded image, or an uploaded video. A breach is recognised when either the
    model emits a NO-X box on a person (``source="model"``) OR a confident person
    has no matching PPE and no NO-X box (``source="derived"``).

    ``violation_count`` is the number of persons in breach for that type.

    Note: derivation re-introduces "person present but no PPE" inference, which is
    gated (in association) behind a person-confidence floor. It can be disabled
    site-wide via ``ENABLE_VIOLATION_DERIVATION=False`` if single-frame precision
    matters more than recall.
    """
    candidates = derive_candidates(detections, frame_w, frame_h)
    by_type: dict[str, list] = {}
    for c in candidates:
        by_type.setdefault(c.violation_type, []).append(c)

    rows = []
    violation_total = 0
    for ppe_item, missing_class in PPE_PAIRS.items():
        type_cands = by_type.get(missing_class, [])
        missing_count = len(type_cands)
        present_count = sum(1 for d in detections if d.class_name == ppe_item)

        if missing_count > 0:
            max_conf = max((c.confidence for c in type_cands), default=0.0)
            status = "violation"
            violation_total += missing_count
        elif present_count > 0:
            max_conf = max(
                (d.confidence for d in detections if d.class_name == ppe_item),
                default=0.0,
            )
            status = "compliant"
        else:
            max_conf = 0.0
            status = "not_assessed"

        rows.append({
            "ppe_item": ppe_item,
            "violation_class": missing_class,
            "status": status,
            "violation_count": missing_count,
            "compliant_count": present_count,
            "max_confidence": round(float(max_conf), 3) if max_conf > 0 else None,
        })
    return rows, violation_total
