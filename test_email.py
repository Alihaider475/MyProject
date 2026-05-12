"""
Standalone Email connectivity test.
Usage:
    python test_email.py
Reads SMTP settings from .env (same as the main app).
"""
from __future__ import annotations

import asyncio
import sys

import aiosmtplib

from backend.core.config import settings

# ── helpers ──────────────────────────────────────────────────────────────────

def _print(label: str, msg: str) -> None:
    print(f"[{label}] {msg}")

def ok(msg: str)   -> None: _print("OK  ", msg)
def fail(msg: str) -> None: _print("FAIL", msg)
def info(msg: str) -> None: _print("INFO", msg)


# ── checks ───────────────────────────────────────────────────────────────────

def check_config() -> bool:
    info(f"SENDER_EMAIL   = {settings.SENDER_EMAIL!r}")
    info(f"RECEIVER_EMAIL = {settings.RECEIVER_EMAIL!r}")
    info(f"SMTP_HOST      = {settings.SMTP_HOST!r}")
    info(f"SMTP_PORT      = {settings.SMTP_PORT}")
    info(f"RETRY_COUNT    = {settings.EMAIL_RETRY_COUNT}")

    if not settings.SENDER_EMAIL:
        fail("SENDER_EMAIL is empty — set it in your .env file")
        return False
    if not settings.EMAIL_PASSWORD or settings.EMAIL_PASSWORD == "your_app_password":
        fail(
            "EMAIL_PASSWORD is empty or still the placeholder 'your_app_password'.\n"
            "       Generate a Gmail App Password at:\n"
            "       https://myaccount.google.com/apppasswords"
        )
        return False
    ok("Config loaded")
    return True


async def check_connect() -> bool:
    info(f"Connecting to {settings.SMTP_HOST}:{settings.SMTP_PORT} ...")
    smtp = aiosmtplib.SMTP(
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
    )
    try:
        await smtp.connect()
        try:
            await smtp.starttls()
        except aiosmtplib.SMTPException:
            pass  # already using TLS
        await smtp.login(settings.SENDER_EMAIL, settings.EMAIL_PASSWORD)
        ok(f"Authenticated as {settings.SENDER_EMAIL}")
        return True
    except aiosmtplib.SMTPAuthenticationError as exc:
        fail(f"Authentication failed — check EMAIL_PASSWORD: {exc}")
        return False
    except Exception as exc:
        fail(f"Connection failed: {exc}")
        return False
    finally:
        try:
            await smtp.quit()
        except Exception:
            pass


async def check_send() -> bool:
    from backend.alerts.email_handler import EmailHandler
    from backend.core.violation_checker import ViolationEvent

    violation = ViolationEvent(
        camera_id=0,
        violation_type="TEST",
        confidence=1.0,
    )
    handler = EmailHandler()
    info(f"Sending test email to {settings.RECEIVER_EMAIL} ...")
    result = await handler.send(violation)
    if result:
        ok("Test email sent — check your inbox")
    else:
        fail("Email handler returned False — see logs above")
    return result


# ── main ─────────────────────────────────────────────────────────────────────

async def _main() -> None:
    print("=" * 50)
    print("  Email Connectivity Test")
    print("=" * 50)

    if not check_config():
        sys.exit(1)

    connected = await check_connect()
    if not connected:
        sys.exit(1)

    sent = await check_send()

    print("=" * 50)
    if sent:
        ok("All checks passed")
    else:
        fail("Send step failed — SMTP connected but email not delivered")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(_main())
