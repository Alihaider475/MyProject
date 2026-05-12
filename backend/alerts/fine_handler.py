from __future__ import annotations

import asyncio
import os

from backend.alerts.base import AlertHandler
from backend.core.logging import get_logger
from backend.core.violation_checker import ViolationEvent

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
            return True  # no identified worker — nothing to charge
        if violation.violation_id is None:
            logger.warning(
                "FineHandler: violation_id is None for camera=%d type=%s — skipping",
                violation.camera_id,
                violation.violation_type,
            )
            return True

        from backend.core.fine_calculator import apply_fine
        from backend.db.models import Worker
        from backend.db.session import AsyncSessionLocal
        from sqlalchemy import select

        try:
            async with AsyncSessionLocal() as session:
                worker = (
                    await session.execute(
                        select(Worker).where(Worker.id == violation.worker_id)
                    )
                ).scalar_one_or_none()

                fine = await apply_fine(
                    session, violation, violation.worker_id, settings.FINES_CURRENCY
                )
                await session.commit()

            logger.info(
                "Fine created: challan=%s worker=%s violation_type=%s amount=%.2f %s",
                fine.challan_number,
                worker.name if worker else "Unknown",
                violation.violation_type,
                fine.fine_amount,
                fine.currency,
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
