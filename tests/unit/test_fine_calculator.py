from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Camera, Fine, FineConfig, Violation, Worker
from backend.detection.fine_calculator import apply_fine, get_fine_amount
from backend.detection.violation_checker import ViolationEvent


async def _seed(db: AsyncSession, *, config_active: bool = True, with_config: bool = True) -> ViolationEvent:
    """Create a worker, camera, violation, and (optionally) a fine config."""
    worker = Worker(employee_id="EMP-001", name="Test Worker")
    camera = Camera(name="Cam 1", source_type="webcam", source_uri="0")
    db.add_all([worker, camera])
    await db.flush()

    violation = Violation(
        camera_id=camera.id,
        violation_type="NO-Hardhat",
        confidence=0.9,
        worker_id=worker.id,
    )
    db.add(violation)
    if with_config:
        db.add(FineConfig(violation_type="NO-Hardhat", fine_amount=500.0, currency="PKR", is_active=config_active))
    await db.flush()

    return ViolationEvent(
        camera_id=camera.id,
        violation_type="NO-Hardhat",
        confidence=0.9,
        worker_id=worker.id,
        violation_id=violation.id,
    )


async def test_apply_fine_creates_pending_fine(db_session: AsyncSession):
    event = await _seed(db_session)

    fine = await apply_fine(db_session, event, event.worker_id, "PKR")

    assert fine is not None
    assert fine.status == "pending"
    assert fine.fine_amount == 500.0
    assert fine.violation_id == event.violation_id
    assert fine.worker_id == event.worker_id
    assert re.fullmatch(r"CH-\d{4}-\d{3,}", fine.challan_number)


async def test_apply_fine_skips_duplicate_for_same_violation(db_session: AsyncSession):
    event = await _seed(db_session)

    first = await apply_fine(db_session, event, event.worker_id, "PKR")
    second = await apply_fine(db_session, event, event.worker_id, "PKR")

    assert first is not None
    assert second is None
    count = (await db_session.execute(select(func.count(Fine.id)))).scalar_one()
    assert count == 1


async def test_apply_fine_skips_when_config_inactive(db_session: AsyncSession):
    event = await _seed(db_session, config_active=False)

    fine = await apply_fine(db_session, event, event.worker_id, "PKR")

    assert fine is None
    count = (await db_session.execute(select(func.count(Fine.id)))).scalar_one()
    assert count == 0


async def test_apply_fine_skips_when_no_config(db_session: AsyncSession):
    event = await _seed(db_session, with_config=False)

    fine = await apply_fine(db_session, event, event.worker_id, "PKR")

    assert fine is None
    assert await get_fine_amount(db_session, "NO-Hardhat") is None


async def test_challan_sequence_survives_deletion(db_session: AsyncSession):
    event = await _seed(db_session)
    first = await apply_fine(db_session, event, event.worker_id, "PKR")
    assert first is not None

    # Second violation for the same worker
    violation2 = Violation(
        camera_id=event.camera_id,
        violation_type="NO-Hardhat",
        confidence=0.8,
        worker_id=event.worker_id,
    )
    db_session.add(violation2)
    await db_session.flush()
    event2 = ViolationEvent(
        camera_id=event.camera_id,
        violation_type="NO-Hardhat",
        confidence=0.8,
        worker_id=event.worker_id,
        violation_id=violation2.id,
    )
    second = await apply_fine(db_session, event2, event.worker_id, "PKR")
    assert second is not None

    # Delete the first fine; the next challan number must not reuse the
    # second fine's number (count(*)-based numbering would collide here).
    second_number = second.challan_number
    await db_session.delete(first)
    await db_session.flush()

    violation3 = Violation(
        camera_id=event.camera_id,
        violation_type="NO-Hardhat",
        confidence=0.7,
        worker_id=event.worker_id,
    )
    db_session.add(violation3)
    await db_session.flush()
    event3 = ViolationEvent(
        camera_id=event.camera_id,
        violation_type="NO-Hardhat",
        confidence=0.7,
        worker_id=event.worker_id,
        violation_id=violation3.id,
    )
    third = await apply_fine(db_session, event3, event.worker_id, "PKR")
    assert third is not None
    assert third.challan_number != second_number
