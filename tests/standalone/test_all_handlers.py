"""
Standalone test runner for all alert handlers.
Usage:
    python test_all_handlers.py
Reads config from .env and tests each handler that is configured.
"""
from __future__ import annotations

import asyncio
import sys

from backend.core.config import settings
from backend.detection.violation_checker import ViolationEvent

# ── helpers ──────────────────────────────────────────────────────────────────

PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"

results: list[tuple[str, str, str]] = []  # (handler, status, detail)


def record(handler: str, status: str, detail: str) -> None:
    results.append((handler, status, detail))
    tag = {"PASS": "OK  ", "FAIL": "FAIL", "SKIP": "SKIP"}[status]
    print(f"  [{tag}] {handler}: {detail}")


def make_test_violation() -> ViolationEvent:
    return ViolationEvent(
        camera_id=0,
        violation_type="TEST",
        confidence=1.0,
    )


# ── handler tests ────────────────────────────────────────────────────────────

async def test_database() -> None:
    record("DatabaseHandler", SKIP, "Requires running database — test via the app")


async def test_fine_handler() -> None:
    record("FineHandler", SKIP, "Requires DB + worker record — test via the app")


async def test_email() -> None:
    if not settings.SENDER_EMAIL:
        record("EmailHandler", SKIP, "SENDER_EMAIL not set")
        return
    if not settings.EMAIL_PASSWORD or settings.EMAIL_PASSWORD == "your_app_password":
        record("EmailHandler", SKIP, "EMAIL_PASSWORD is placeholder — set a real App Password")
        return

    from backend.alerts.email_handler import EmailHandler

    handler = EmailHandler()
    try:
        ok = await handler.send(make_test_violation())
        if ok:
            record("EmailHandler", PASS, f"Email sent to {settings.RECEIVER_EMAIL}")
        else:
            record("EmailHandler", FAIL, "handler.send() returned False")
    except Exception as exc:
        record("EmailHandler", FAIL, str(exc))


async def test_webhook() -> None:
    if not settings.WEBHOOK_URL:
        record("WebhookHandler", SKIP, "WEBHOOK_URL not set")
        return

    from backend.alerts.webhook_handler import WebhookHandler

    handler = WebhookHandler(url=settings.WEBHOOK_URL)
    try:
        ok = await handler.send(make_test_violation())
        if ok:
            record("WebhookHandler", PASS, f"POST sent to {settings.WEBHOOK_URL}")
        else:
            record("WebhookHandler", FAIL, "handler.send() returned False")
    except Exception as exc:
        record("WebhookHandler", FAIL, str(exc))


async def test_mqtt() -> None:
    if not settings.MQTT_BROKER:
        record("MQTTHandler", SKIP, "MQTT_BROKER not set")
        return

    from backend.alerts.mqtt_handler import MQTTHandler

    handler = MQTTHandler()
    try:
        ok = await handler.send(make_test_violation())
        if ok:
            record("MQTTHandler", PASS, f"Published to {settings.MQTT_BROKER}:{settings.MQTT_PORT}")
        else:
            record("MQTTHandler", FAIL, "handler.send() returned False")
    except Exception as exc:
        record("MQTTHandler", FAIL, str(exc))


# ── main ─────────────────────────────────────────────────────────────────────

async def _main() -> None:
    print("=" * 60)
    print("  Alert Handler Test Runner")
    print("=" * 60)
    print()

    await test_database()
    await test_fine_handler()
    await test_email()
    await test_webhook()
    await test_mqtt()

    # ── summary table ────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print(f"  {'Handler':<20} {'Status':<8} {'Detail'}")
    print("-" * 60)
    for handler, status, detail in results:
        print(f"  {handler:<20} {status:<8} {detail}")
    print("=" * 60)

    passed = sum(1 for _, s, _ in results if s == PASS)
    failed = sum(1 for _, s, _ in results if s == FAIL)
    skipped = sum(1 for _, s, _ in results if s == SKIP)
    print(f"  Totals: {passed} passed, {failed} failed, {skipped} skipped")
    print()

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(_main())
