from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


async def get_fine_amount(db: AsyncSession, violation_type: str) -> Optional[float]:
    """Return the configured fine amount for a violation type.

    Returns None when no *active* FineConfig exists — the caller must skip
    fine creation in that case (deactivating a config in the UI means
    "stop fining this violation type").
    """
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
    return None


async def _next_sequence(db: AsyncSession, year: int) -> int:
    from backend.database.models import Fine

    # Derive the next sequence from the highest existing challan number for
    # the year (not count(*)) so deleted rows can never cause a collision
    # with the unique challan_number constraint.
    prefix = f"CH-{year}-"
    max_challan = (
        await db.execute(
            select(func.max(Fine.challan_number)).where(
                Fine.challan_number.like(f"{prefix}%")
            )
        )
    ).scalar_one_or_none()
    if not max_challan:
        return 1
    try:
        return int(max_challan[len(prefix):]) + 1
    except ValueError:
        return 1


def _generate_challan_number(year: int, seq: int) -> str:
    return f"CH-{year}-{seq:03d}"


async def apply_fine(
    db: AsyncSession,
    violation_event: ViolationEvent,
    worker_id: int,
    currency: str,
) -> Optional["Fine"]:  # noqa: F821
    """Create a pending Fine for an identified violation.

    Returns None (and logs why) when the fine must be skipped:
    - a fine already exists for this violation_id
    - no active FineConfig exists for the violation type
    """
    from backend.database.models import Fine

    existing = (
        await db.execute(
            select(Fine).where(Fine.violation_id == violation_event.violation_id)
        )
    ).scalar_one_or_none()
    if existing is not None:
        logger.info(
            "[FINE] Skipped: fine already exists for violation=%s (challan=%s)",
            violation_event.violation_id,
            existing.challan_number,
        )
        return None

    fine_amount = await get_fine_amount(db, violation_event.violation_type)
    if fine_amount is None:
        logger.info(
            "[FINE] Skipped: no active fine config for type=%s (violation=%s)",
            violation_event.violation_type,
            violation_event.violation_id,
        )
        return None

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    year = now.year
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
    logger.info(
        "[FINE] Created: challan=%s amount=%.2f %s worker=%d violation=%s type=%s",
        challan_number,
        fine_amount,
        currency,
        worker_id,
        violation_event.violation_id,
        violation_event.violation_type,
    )
    return fine
