from __future__ import annotations

from backend.alerts.base import AlertHandler
from backend.core.logging import get_logger
from backend.core.violation_checker import ViolationEvent

logger = get_logger(__name__)


class DatabaseHandler(AlertHandler):
    handler_type = "db"

    async def send(self, violation: ViolationEvent) -> bool:
        from backend.db.models import AlertLog, Violation
        from backend.db.session import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as session:
                db_violation = Violation(
                    camera_id=violation.camera_id,
                    violation_type=violation.violation_type,
                    confidence=violation.confidence,
                    frame_path=violation.frame_path,
                )
                session.add(db_violation)
                await session.flush()  # populate db_violation.id

                log = AlertLog(
                    violation_id=db_violation.id,
                    handler_type=self.handler_type,
                    success=True,
                )
                session.add(log)
                await session.commit()

            logger.info(
                "Violation saved to DB: id=%d camera=%d type=%s",
                db_violation.id,
                violation.camera_id,
                violation.violation_type,
            )
            return True

        except Exception as exc:
            logger.error(
                "Failed to save violation to DB (camera=%d type=%s): %s",
                violation.camera_id,
                violation.violation_type,
                exc,
                exc_info=True,
            )
            # Cannot write AlertLog without a valid violation ID,
            # but the error is captured in logs above.
            return False
