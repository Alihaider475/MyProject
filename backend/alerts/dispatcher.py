from __future__ import annotations

import asyncio

from backend.alerts.base import AlertHandler, AlertResult
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


def build_dispatcher(include_db: bool = True, include_fine: bool = True) -> AlertDispatcher:
    """Build a dispatcher with the standard handler set.

    Email/webhook/MQTT handlers are registered unconditionally — each one
    skips safely (and is audited as skipped) when its config is missing or
    the channel is disabled.
    """
    from backend.core.config import settings

    handlers: list[AlertHandler] = []
    if include_db:
        from backend.alerts.db_handler import DatabaseHandler
        handlers.append(DatabaseHandler())
    if include_fine and settings.FINES_ENABLED:
        from backend.alerts.fine_handler import FineHandler
        handlers.append(FineHandler())
    from backend.alerts.email_handler import EmailHandler
    from backend.alerts.webhook_handler import WebhookHandler
    from backend.alerts.mqtt_handler import MQTTHandler
    handlers.append(EmailHandler())
    handlers.append(WebhookHandler())
    handlers.append(MQTTHandler())
    return AlertDispatcher(handlers)


class AlertDispatcher:
    def __init__(self, handlers: list[AlertHandler]) -> None:
        self.handlers = handlers
        self._db_handler = next((h for h in handlers if h.__class__.__name__ == "DatabaseHandler"), None)
        self._fine_handler = next((h for h in handlers if h.__class__.__name__ == "FineHandler"), None)
        self._non_db_handlers = [h for h in handlers if h.handler_type != "db"]

    async def dispatch(self, violation: ViolationEvent) -> None:
        """Full workflow: DB insert first, then fine + external alerts."""
        await self.dispatch_db_only(violation)
        await self.dispatch_non_db(violation)

    async def dispatch_db_only(self, violation: ViolationEvent) -> None:
        """Save violation to DB only (fast INSERT, no fine/email/webhook)."""
        if self._db_handler:
            await self._run(self._db_handler, violation)

    async def dispatch_non_db(self, violation: ViolationEvent) -> None:
        """Run fine handler + all non-DB handlers (email, webhook, MQTT)."""
        logger.info(
            "Alert dispatch started: violation=%s camera=%d type=%s",
            violation.violation_id,
            violation.camera_id,
            violation.violation_type,
        )
        results: list[tuple[str, AlertResult]] = []

        # FineHandler runs first (sequentially) so fine/challan data is on the
        # event before the external channels build their payloads.
        if self._fine_handler:
            results.append(
                ("fine", await self._run(self._fine_handler, violation))
            )

        channel_results: list[tuple[str, AlertResult]] = []
        if self._non_db_handlers:
            gathered = await asyncio.gather(
                *[self._run(h, violation) for h in self._non_db_handlers],
                return_exceptions=True,
            )
            for handler, result in zip(self._non_db_handlers, gathered):
                if isinstance(result, BaseException):
                    # _run already guards handler exceptions; this is a last resort.
                    logger.error("Handler %s raised: %s", handler.handler_type, result)
                    result = AlertResult.failed(str(result))
                channel_results.append((handler.handler_type, result))
        results.extend(channel_results)

        failed = [name for name, r in results if r.status == "failed"]
        summary = " ".join(f"{name}={r.status}" for name, r in results) or "no handlers"
        if failed:
            logger.warning(
                "Alert dispatch partially failed (violation=%s): %s",
                violation.violation_id,
                summary,
            )
        else:
            logger.info(
                "Alert dispatch completed (violation=%s): %s",
                violation.violation_id,
                summary,
            )

        # Audit external channel outcomes (sent/skipped/failed) in AlertLog.
        await self._record_alert_logs(violation, channel_results)

    async def _record_alert_logs(
        self,
        violation: ViolationEvent,
        channel_results: list[tuple[str, AlertResult]],
    ) -> None:
        """Persist one AlertLog row per external channel attempt.

        Must never raise — an AlertLog write failure cannot be allowed to
        break violation logging, fine generation, or alert dispatch.
        """
        if violation.violation_id is None or not channel_results:
            return
        try:
            from backend.database.connection import AsyncSessionLocal
            from backend.database.models import AlertLog

            async with AsyncSessionLocal() as session:
                for handler_type, result in channel_results:
                    if result.status == "skipped":
                        error_msg = f"skipped: {result.detail}"
                    elif result.status == "failed":
                        error_msg = result.detail
                    else:
                        error_msg = None
                    session.add(
                        AlertLog(
                            violation_id=violation.violation_id,
                            handler_type=handler_type,
                            success=result.status != "failed",
                            error_msg=error_msg[:1000] if error_msg else None,
                        )
                    )
                await session.commit()
        except Exception as exc:
            logger.error(
                "Failed to write AlertLog records for violation=%s: %s",
                violation.violation_id,
                exc,
            )

    async def _run(self, handler: AlertHandler, violation: ViolationEvent) -> AlertResult:
        try:
            result = await handler.send(violation)
            # Normalize legacy bool returns from custom handlers.
            if isinstance(result, bool):
                result = AlertResult.sent() if result else AlertResult.failed("handler reported failure")
            if result.status == "failed":
                logger.warning(
                    "Handler %s failed: %s", handler.handler_type, result.detail
                )
            return result
        except Exception as exc:
            logger.exception("Handler %s exception: %s", handler.handler_type, exc)
            return AlertResult.failed(str(exc))
