from __future__ import annotations

import asyncio
import os

import cv2

from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)


async def auto_identify_single(violation_id: int, detector, face_recognizer) -> bool:
    """Immediately attempt to identify the worker for a single violation.

    Called as a fire-and-forget background task right after a violation is saved
    with worker_id=None. Returns True if identification succeeded.
    """
    from sqlalchemy import select

    from backend.core.fine_calculator import apply_fine, get_fine_amount
    from backend.core.violation_checker import ViolationEvent
    from backend.db.models import Violation
    from backend.db.session import AsyncSessionLocal

    loop = asyncio.get_running_loop()

    async with AsyncSessionLocal() as session:
        violation = await session.get(Violation, violation_id)
        if violation is None or violation.worker_id is not None:
            return False  # already assigned or deleted
        if not violation.frame_path:
            return False

        abs_path = os.path.join(settings.FRAMES_DIR, violation.frame_path)
        if not os.path.isfile(abs_path):
            return False

        frame = await loop.run_in_executor(None, cv2.imread, abs_path)
        if frame is None:
            return False

        detections = await loop.run_in_executor(None, detector.detect, frame)
        person_dets = [d for d in detections if d.class_name == "Person"]

        worker_id = None
        for pd in person_dets:
            wid = await loop.run_in_executor(
                None,
                face_recognizer.identify_face,
                frame,
                (pd.x1, pd.y1, pd.x2, pd.y2),
            )
            if wid is not None:
                worker_id = wid
                break

        if worker_id is None:
            return False

        fine_amount = await get_fine_amount(session, violation.violation_type)
        violation.worker_id = worker_id
        violation.fine_amount = fine_amount

        event = ViolationEvent(
            camera_id=violation.camera_id,
            violation_type=violation.violation_type,
            confidence=violation.confidence,
            frame_path=violation.frame_path,
            worker_id=worker_id,
            fine_amount=fine_amount,
            violation_id=violation.id,
        )
        await apply_fine(session, event, worker_id, settings.FINES_CURRENCY)
        await session.commit()

        logger.info(
            "Instant auto-identified violation %d -> worker %d, fine %.2f %s",
            violation_id, worker_id, fine_amount, settings.FINES_CURRENCY,
        )
        return True


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

    from backend.core.fine_calculator import apply_fine, get_fine_amount
    from backend.core.violation_checker import ViolationEvent
    from backend.db.models import Violation
    from backend.db.session import AsyncSessionLocal

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
        abs_path = os.path.join(settings.FRAMES_DIR, v.frame_path)
        if not os.path.isfile(abs_path):
            continue

        frame = await loop.run_in_executor(None, cv2.imread, abs_path)
        if frame is None:
            continue

        # Re-run YOLO to find person bounding boxes in the saved frame
        detections = await loop.run_in_executor(None, detector.detect, frame)
        person_dets = [d for d in detections if d.class_name == "Person"]

        worker_id = None
        for pd in person_dets:
            wid = await loop.run_in_executor(
                None,
                face_recognizer.identify_face,
                frame,
                (pd.x1, pd.y1, pd.x2, pd.y2),
            )
            if wid is not None:
                worker_id = wid
                break

        if worker_id is None:
            continue

        # Update the violation record and create a Fine
        async with AsyncSessionLocal() as session:
            violation = await session.get(Violation, v.id)
            if violation is None or violation.worker_id is not None:
                continue  # already assigned by another process

            fine_amount = await get_fine_amount(session, violation.violation_type)
            violation.worker_id = worker_id
            violation.fine_amount = fine_amount

            event = ViolationEvent(
                camera_id=violation.camera_id,
                violation_type=violation.violation_type,
                confidence=violation.confidence,
                frame_path=violation.frame_path,
                worker_id=worker_id,
                fine_amount=fine_amount,
                violation_id=violation.id,
            )
            await apply_fine(session, event, worker_id, settings.FINES_CURRENCY)
            await session.commit()

            identified += 1
            details.append({
                "violation_id": v.id,
                "worker_id": worker_id,
                "fine_amount": fine_amount,
            })
            logger.info(
                "Auto-identified violation %d -> worker %d, fine %.2f %s",
                v.id, worker_id, fine_amount, settings.FINES_CURRENCY,
            )

    return {"processed": processed, "identified": identified, "details": details}
