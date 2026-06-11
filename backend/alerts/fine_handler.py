from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from backend.alerts.base import AlertHandler
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class FineHandler(AlertHandler):
    """Creates a Fine record (with challan number) for every violation
    that has an identified worker.  Must run after DatabaseHandler so that
    violation.violation_id is already set."""

    handler_type = "db"  # sequential — runs after DatabaseHandler in the same loop

    async def send(self, violation: ViolationEvent) -> bool:
        from backend.core.config import settings

        if not settings.FINES_ENABLED:
            return True
        if violation.worker_id is None:
            # no identified worker — nothing to charge
            logger.debug(
                "[FINE] Skipped: worker unidentified (camera=%d type=%s)",
                violation.camera_id,
                violation.violation_type,
            )
            return True
        if violation.violation_id is None:
            # violation_id=None means DatabaseHandler suppressed this violation
            # due to the cooldown dedup check — nothing to fine.
            logger.debug(
                "[FINE] Skipped: violation suppressed by cooldown (camera=%d type=%s)",
                violation.camera_id,
                violation.violation_type,
            )
            return True

        from backend.detection.fine_calculator import apply_fine
        from backend.database.models import Fine, Violation, Worker
        from backend.database.connection import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as session:
                # Dedup: skip if a fine already exists for this worker+type within cooldown.
                # Naive UTC cutoff — fine_date is stored naive, and an aware cutoff
                # breaks SQLite string comparisons (see db_handler.py).
                cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
                    seconds=settings.ALERT_COOLDOWN_SECONDS
                )
                stmt = (
                    select(func.count())
                    .select_from(Fine)
                    .where(
                        Fine.worker_id == violation.worker_id,
                        Fine.fine_date > cutoff,
                    )
                    .join(Violation, Fine.violation_id == Violation.id)
                    .where(Violation.violation_type == violation.violation_type)
                )
                result = await session.execute(stmt)
                if result.scalar() > 0:
                    logger.info(
                        "[FINE] Skipped duplicate fine for worker=%d type=%s",
                        violation.worker_id,
                        violation.violation_type,
                    )
                    return True
                worker = (
                    await session.execute(
                        select(Worker).where(Worker.id == violation.worker_id)
                    )
                ).scalar_one_or_none()

                fine = await apply_fine(
                    session, violation, violation.worker_id, settings.FINES_CURRENCY
                )
                if fine is None:
                    # apply_fine already logged why (duplicate / no active config)
                    return True
                await session.commit()

            logger.info(
                "[FINE] Applied fine %s=%.2f to worker=%d (challan=%s type=%s)",
                settings.FINES_CURRENCY,
                fine.fine_amount,
                violation.worker_id,
                fine.challan_number,
                violation.violation_type,
            )

            # Generate challan PDF in a thread so we don't block the event loop
            from backend.reports import challan_generator

            loop = asyncio.get_running_loop()
            pdf_bytes = await loop.run_in_executor(
                None,
                challan_generator.create_challan_pdf,
                fine, worker, violation,
            )
            if pdf_bytes:
                challan_path = os.path.join(settings.CHALLANS_DIR, f"{fine.challan_number}.pdf")
                os.makedirs(settings.CHALLANS_DIR, exist_ok=True)
                await loop.run_in_executor(
                    None, lambda: open(challan_path, "wb").write(pdf_bytes)
                )
            return True

        except Exception as exc:
            logger.error("FineHandler failed: %s", exc, exc_info=True)
            return False
