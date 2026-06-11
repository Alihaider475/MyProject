from __future__ import annotations

import asyncio

from backend.alerts.base import AlertHandler
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class AlertDispatcher:
    def __init__(self, handlers: list[AlertHandler]) -> None:
        self.handlers = handlers
        self._db_handler = next((h for h in handlers if h.__class__.__name__ == "DatabaseHandler"), None)
        self._fine_handler = next((h for h in handlers if h.__class__.__name__ == "FineHandler"), None)
        self._non_db_handlers = [h for h in handlers if h.handler_type != "db"]

    async def dispatch(self, violation: ViolationEvent) -> None:
        db_handlers = [h for h in self.handlers if h.handler_type == "db"]
        rest_handlers = [h for h in self.handlers if h.handler_type != "db"]

        for h in db_handlers:
            await self._run(h, violation)

        if rest_handlers:
            results = await asyncio.gather(
                *[self._run(h, violation) for h in rest_handlers],
                return_exceptions=True,
            )
            for handler, result in zip(rest_handlers, results):
                if isinstance(result, Exception):
                    logger.error("Handler %s raised: %s", handler.handler_type, result)

    async def dispatch_db_only(self, violation: ViolationEvent) -> None:
        """Save violation to DB only (fast INSERT, no fine/email/webhook)."""
        if self._db_handler:
            await self._run(self._db_handler, violation)

    async def dispatch_non_db(self, violation: ViolationEvent) -> None:
        """Run fine handler + all non-DB handlers (email, webhook, MQTT)."""
        if self._fine_handler:
            await self._run(self._fine_handler, violation)
        if self._non_db_handlers:
            results = await asyncio.gather(
                *[self._run(h, violation) for h in self._non_db_handlers],
                return_exceptions=True,
            )
            for handler, result in zip(self._non_db_handlers, results):
                if isinstance(result, Exception):
                    logger.error("Handler %s raised: %s", handler.handler_type, result)

    async def _run(self, handler: AlertHandler, violation: ViolationEvent) -> bool:
        try:
            success = await handler.send(violation)
            if not success:
                logger.warning("Handler %s reported failure", handler.handler_type)
            return success
        except Exception as exc:
            logger.exception("Handler %s exception: %s", handler.handler_type, exc)
            return False
