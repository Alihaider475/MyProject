from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from backend.alerts.base import AlertHandler
from backend.core.logging import get_logger
from backend.core.violation_checker import ViolationEvent

logger = get_logger(__name__)


class DatabaseHandler(AlertHandler):
    handler_type = "db"

    async def send(self, violation: ViolationEvent) -> bool:
        from backend.core.config import settings
        from backend.db.models import AlertLog, Violation
        from backend.db.session import AsyncSessionLocal

        try:
            async with AsyncSessionLocal() as session:
                # --- DB-persistent cooldown dedup ---
                # Query the violations table for any matching record within the
                # cooldown window.  This check survives camera restarts and server
                # restarts because it reads from the database, not from memory.
                # Use naive UTC to match SQLite storage format (server_default=func.now()
                # stores as "YYYY-MM-DD HH:MM:SS" without timezone).  An aware cutoff
                # can render with "+00:00" which breaks SQLite string comparisons.
                cutoff: datetime = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
                    seconds=settings.ALERT_COOLDOWN_SECONDS
                )
                recent_stmt = (
                    select(func.count())
                    .select_from(Violation)
                    .where(
                        Violation.camera_id == violation.camera_id,
                        Violation.violation_type == violation.violation_type,
                        Violation.timestamp > cutoff,
                    )
                )
                # When track_id is available, dedup per-track; otherwise per-camera
                if violation.track_id is not None:
                    recent_stmt = recent_stmt.where(Violation.track_id == violation.track_id)
                recent_count: int = (await session.execute(recent_stmt)).scalar() or 0
                if recent_count > 0:
                    # Compute elapsed for the log message (best-effort — uses last record)
                    latest_stmt = (
                        select(func.max(Violation.timestamp))
                        .where(
                            Violation.camera_id == violation.camera_id,
                            Violation.violation_type == violation.violation_type,
                        )
                    )
                    latest_ts: datetime | None = (
                        await session.execute(latest_stmt)
                    ).scalar()
                    elapsed: float = 0.0
                    if latest_ts is not None:
                        # SQLite stores timestamps as naive UTC; normalise to aware.
                        if latest_ts.tzinfo is None:
                            latest_ts = latest_ts.replace(tzinfo=timezone.utc)
                        elapsed = (datetime.now(timezone.utc) - latest_ts).total_seconds()
                    logger.info(
                        "[COOLDOWN] Skipped duplicate: camera=%d type=%s elapsed=%.1fs cooldown=%ds",
                        violation.camera_id,
                        violation.violation_type,
                        elapsed,
                        settings.ALERT_COOLDOWN_SECONDS,
                    )
                    # Signal callers that this violation was suppressed so they
                    # skip fine / email / webhook steps too.
                    violation.violation_id = None
                    return True

                # --- Insert new violation record ---
                db_violation = Violation(
                    camera_id=violation.camera_id,
                    violation_type=violation.violation_type,
                    confidence=violation.confidence,
                    frame_path=violation.frame_path,
                    worker_id=violation.worker_id,
                    fine_amount=violation.fine_amount,
                    track_id=violation.track_id,
                    person_bbox=violation.person_bbox,
                )
                session.add(db_violation)
                await session.flush()  # populate db_violation.id
                violation.violation_id = db_violation.id  # expose ID to subsequent db handlers

                log = AlertLog(
                    violation_id=db_violation.id,
                    handler_type=self.handler_type,
                    success=True,
                )
                session.add(log)
                await session.commit()

            logger.info(
                "[SAVED] New violation: camera=%d type=%s worker=%s",
                violation.camera_id,
                violation.violation_type,
                violation.worker_id,
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
