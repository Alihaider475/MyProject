from __future__ import annotations

import asyncio

import httpx

from backend.alerts.base import AlertHandler, AlertResult, build_alert_payload
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class WebhookHandler(AlertHandler):
    handler_type = "webhook"

    def __init__(self, url: str | None = None, timeout: float | None = None) -> None:
        # Explicit args are test/override hooks; production reads settings at
        # send time so the handler can be registered unconditionally and skip
        # safely when WEBHOOK_URL is not configured.
        self._url_override = url
        self._timeout_override = timeout

    async def send(self, violation: ViolationEvent) -> AlertResult:
        if not settings.WEBHOOK_ENABLED:
            logger.debug("Webhook alert skipped — WEBHOOK_ENABLED is false")
            return AlertResult.skipped("webhook alerts disabled")
        url = self._url_override or settings.WEBHOOK_URL
        if not url:
            logger.debug("Webhook alert skipped — WEBHOOK_URL not configured")
            return AlertResult.skipped("WEBHOOK_URL not configured")
        timeout = self._timeout_override or settings.WEBHOOK_TIMEOUT

        payload = build_alert_payload(violation)

        last_exc: Exception | None = None
        for attempt in range(1, settings.WEBHOOK_RETRY_COUNT + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(url, json=payload)
                    resp.raise_for_status()
                logger.info(
                    "Webhook alert sent: camera=%d type=%s url=%s",
                    violation.camera_id,
                    violation.violation_type,
                    url,
                )
                return AlertResult.sent()
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Webhook alert failed (attempt %d/%d): %s",
                    attempt,
                    settings.WEBHOOK_RETRY_COUNT,
                    exc,
                )
                if attempt < settings.WEBHOOK_RETRY_COUNT:
                    await asyncio.sleep(settings.WEBHOOK_RETRY_DELAY)

        logger.error(
            "Webhook alert failed after %d attempts for camera %d: %s",
            settings.WEBHOOK_RETRY_COUNT,
            violation.camera_id,
            last_exc,
        )
        return AlertResult.failed(
            f"failed after {settings.WEBHOOK_RETRY_COUNT} attempts: {last_exc}"
        )
