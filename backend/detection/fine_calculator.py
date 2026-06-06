from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)

_DEFAULT_FINES: dict[str, float] = {
    "NO-Hardhat": settings.DEFAULT_HARDHAT_FINE,
    "NO-Mask": settings.DEFAULT_MASK_FINE,
    "NO-Safety Vest": settings.DEFAULT_VEST_FINE,
}


async def get_fine_amount(db: AsyncSession, violation_type: str) -> float:
    from backend.database.models import FineConfig

    row = (
        await db.execute(
            select(FineConfig).where(
                FineConfig.violation_type == violation_type,
                FineConfig.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()

    if row is not None:
        return row.fine_amount
    return _DEFAULT_FINES.get(violation_type, 0.0)


async def _next_sequence(db: AsyncSession, year: int) -> int:
    from backend.database.models import Fine

    count = (
        await db.execute(
            select(func.count(Fine.id)).where(
                func.extract("year", Fine.fine_date) == year
            )
        )
    ).scalar_one()
    return int(count) + 1


def _generate_challan_number(year: int, seq: int) -> str:
    return f"CH-{year}-{seq:03d}"


async def apply_fine(
    db: AsyncSession,
    violation_event: ViolationEvent,
    worker_id: int,
    currency: str,
) -> "Fine":  # noqa: F821
    from backend.database.models import Fine

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    year = now.year
    fine_amount = await get_fine_amount(db, violation_event.violation_type)
    seq = await _next_sequence(db, year)
    challan_number = _generate_challan_number(year, seq)

    fine = Fine(
        worker_id=worker_id,
        violation_id=violation_event.violation_id,
        fine_amount=fine_amount,
        currency=currency,
        fine_date=now,
        challan_number=challan_number,
        status="pending",
    )
    db.add(fine)
    await db.flush()
    return fine
