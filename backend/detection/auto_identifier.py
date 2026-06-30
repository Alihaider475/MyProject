from __future__ import annotations

import asyncio
import json

import cv2
import numpy as np

from backend.core.config import settings
from backend.core.logging import get_logger
from backend.storage import supabase_storage

logger = get_logger(__name__)


def _person_bbox_from_violation(violation) -> tuple[int, int, int, int] | None:
    if not getattr(violation, "person_bbox", None):
        return None
    try:
        raw = json.loads(violation.person_bbox)
        bbox = tuple(int(n) for n in raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return bbox if len(bbox) == 4 else None


def _single_person_bbox(detections) -> tuple[int, int, int, int] | None:
    boxes = [
        (d.x1, d.y1, d.x2, d.y2)
        for d in detections
        if getattr(d, "class_name", None) == "Person"
    ]
    return boxes[0] if len(boxes) == 1 else None


async def _load_frame(frame_path: str):
    """Fetch a violation frame from Supabase Storage and decode it for OpenCV."""
    url = supabase_storage.public_url(settings.SUPABASE_VIOLATION_BUCKET, frame_path)
    raw = await supabase_storage.fetch_bytes(url)
    if raw is None:
        return None
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, cv2.imdecode, np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR
    )


async def auto_identify_single(violation_id: int, detector, face_recognizer) -> bool:
    """Immediately attempt to identify the worker for a single violation.

    Called as a fire-and-forget background task right after a violation is saved
    with worker_id=None. Returns True if identification succeeded.
    """
    from sqlalchemy import select

    from backend.detection.fine_calculator import apply_fine, get_fine_amount
    from backend.detection.violation_checker import ViolationEvent
    from backend.database.models import Violation
    from backend.database.connection import AsyncSessionLocal

    loop = asyncio.get_running_loop()

    async with AsyncSessionLocal() as session:
        violation = await session.get(Violation, violation_id)
        if violation is None or violation.worker_id is not None:
            return False  # already assigned or deleted
        if not violation.frame_path:
            return False

        frame = await _load_frame(violation.frame_path)
        if frame is None:
            return False

        person_bbox = _person_bbox_from_violation(violation)
        if person_bbox is None:
            detections = await loop.run_in_executor(None, detector.detect, frame)
            person_bbox = _single_person_bbox(detections)
        if person_bbox is None:
            return False

        worker_id = await loop.run_in_executor(
            None, face_recognizer.identify_face, frame, person_bbox
        )

        if worker_id is None:
            return False

        violation.worker_id = worker_id

        fine_amount = await get_fine_amount(session, violation.violation_type)
        fine = None
        if fine_amount is not None:
            event = ViolationEvent(
                camera_id=violation.camera_id,
                violation_type=violation.violation_type,
                confidence=violation.confidence,
                frame_path=violation.frame_path,
                worker_id=worker_id,
                fine_amount=fine_amount,
                violation_id=violation.id,
            )
            fine = await apply_fine(session, event, worker_id, settings.FINES_CURRENCY)
            if fine is not None:
                violation.fine_amount = fine_amount
        else:
            logger.info(
                "[FINE] Skipped: no active fine config for type=%s (violation=%d, auto-identify)",
                violation.violation_type, violation_id,
            )
        await session.commit()

        logger.info(
            "Instant auto-identified violation %d -> worker %d%s",
            violation_id, worker_id,
            f", fine {fine_amount:.2f} {settings.FINES_CURRENCY}" if fine is not None else " (no fine)",
        )
        return True


async def assign_worker_to_violations(violation_ids: list[int], worker_id: int) -> int:
    """Assign an already-resolved worker to violations and create their fines.

    Used by the upload path, which resolves the worker ONCE from the in-memory frame
    (no disk reload, no redundant YOLO pass) and applies it to every violation saved
    from that same image. Returns the count newly assigned.
    """
    from backend.detection.fine_calculator import apply_fine, get_fine_amount
    from backend.detection.violation_checker import ViolationEvent
    from backend.database.models import Violation
    from backend.database.connection import AsyncSessionLocal

    assigned = 0
    async with AsyncSessionLocal() as session:
        for vid in violation_ids:
            violation = await session.get(Violation, vid)
            if violation is None or violation.worker_id is not None:
                continue
            violation.worker_id = worker_id

            fine_amount = await get_fine_amount(session, violation.violation_type)
            if fine_amount is not None:
                event = ViolationEvent(
                    camera_id=violation.camera_id,
                    violation_type=violation.violation_type,
                    confidence=violation.confidence,
                    frame_path=violation.frame_path,
                    worker_id=worker_id,
                    fine_amount=fine_amount,
                    violation_id=violation.id,
                )
                fine = await apply_fine(session, event, worker_id, settings.FINES_CURRENCY)
                if fine is not None:
                    violation.fine_amount = fine_amount
            assigned += 1
        await session.commit()

    if assigned:
        logger.info(
            "Upload auto-identify: assigned worker %d to %d violation(s)", worker_id, assigned
        )
    return assigned


async def auto_identify_unassigned(detector, face_recognizer) -> dict:
    """Re-process unassigned violations using saved frames.

    For each violation with no worker_id:
      1. Load the saved violation JPEG from disk
      2. Run YOLO to find person bounding boxes
      3. Run face recognition on each person detection
      4. If a match is found, assign the worker and create a Fine record

    Returns a summary dict: {processed, identified, details}.
    """
    from sqlalchemy import select

    from backend.detection.fine_calculator import apply_fine, get_fine_amount
    from backend.detection.violation_checker import ViolationEvent
    from backend.database.models import Violation
    from backend.database.connection import AsyncSessionLocal

    # Fetch unassigned violations that have a saved frame
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Violation)
            .where(Violation.worker_id.is_(None))
            .where(Violation.frame_path.isnot(None))
            .where(Violation.is_false_positive.is_(False))
            .order_by(Violation.timestamp.desc())
            .limit(50)
        )
        unassigned = result.scalars().all()

    if not unassigned:
        return {"processed": 0, "identified": 0, "details": []}

    loop = asyncio.get_running_loop()
    processed = 0
    identified = 0
    details: list[dict] = []

    for v in unassigned:
        processed += 1
        if not v.frame_path:
            continue

        frame = await _load_frame(v.frame_path)
        if frame is None:
            continue

        person_bbox = _person_bbox_from_violation(v)
        if person_bbox is None:
            # Legacy rows may not have person_bbox. Only auto-identify them when
            # the frame contains exactly one person, so we do not guess.
            detections = await loop.run_in_executor(None, detector.detect, frame)
            person_bbox = _single_person_bbox(detections)
        if person_bbox is None:
            continue

        worker_id = await loop.run_in_executor(
            None, face_recognizer.identify_face, frame, person_bbox
        )

        if worker_id is None:
            continue

        # Update the violation record and create a Fine
        async with AsyncSessionLocal() as session:
            violation = await session.get(Violation, v.id)
            if violation is None or violation.worker_id is not None:
                continue  # already assigned by another process

            violation.worker_id = worker_id

            fine_amount = await get_fine_amount(session, violation.violation_type)
            fine = None
            if fine_amount is not None:
                event = ViolationEvent(
                    camera_id=violation.camera_id,
                    violation_type=violation.violation_type,
                    confidence=violation.confidence,
                    frame_path=violation.frame_path,
                    worker_id=worker_id,
                    fine_amount=fine_amount,
                    violation_id=violation.id,
                )
                fine = await apply_fine(session, event, worker_id, settings.FINES_CURRENCY)
                if fine is not None:
                    violation.fine_amount = fine_amount
            else:
                logger.info(
                    "[FINE] Skipped: no active fine config for type=%s (violation=%d, auto-identify)",
                    violation.violation_type, v.id,
                )
            await session.commit()

            identified += 1
            details.append({
                "violation_id": v.id,
                "worker_id": worker_id,
                "fine_amount": fine_amount if fine is not None else None,
            })
            logger.info(
                "Auto-identified violation %d -> worker %d%s",
                v.id, worker_id,
                f", fine {fine_amount:.2f} {settings.FINES_CURRENCY}" if fine is not None else " (no fine)",
            )

    return {"processed": processed, "identified": identified, "details": details}
