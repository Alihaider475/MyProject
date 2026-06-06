from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from backend.alerts.base import AlertHandler
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class EmailHandler(AlertHandler):
    handler_type = "email"

    async def send(self, violation: ViolationEvent) -> bool:
        if not settings.EMAIL_ALERTS_ENABLED:
            logger.debug("Email alerts disabled via settings")
            return False
        if not settings.SENDER_EMAIL or not settings.EMAIL_PASSWORD:
            logger.debug("Email handler inactive — SENDER_EMAIL not configured")
            return False

        message = MIMEMultipart()
        message["From"] = settings.SENDER_EMAIL
        message["To"] = settings.RECEIVER_EMAIL
        message["Subject"] = (
            f"[PPE ALERT] {violation.violation_type} Camera {violation.camera_id}"
        )

        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        body = (
            f"PPE Safety Violation Detected\n\n"
            f"Camera:     {violation.camera_id}\n"
            f"Type:       {violation.violation_type}\n"
            f"Confidence: {violation.confidence:.0%}\n"
            f"Timestamp:  {ts}\n\n"
            "Please review the attached snapshot."
        )
        message.attach(MIMEText(body, "plain"))

        if violation.frame_path:
            full_path = os.path.join(settings.FRAMES_DIR, violation.frame_path)
            if os.path.exists(full_path):
                with open(full_path, "rb") as f:
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(f.read())
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        f"attachment; filename={os.path.basename(full_path)}",
                    )
                    message.attach(part)
            else:
                logger.warning(
                    "Snapshot not found at %s — sending email without attachment",
                    full_path,
                )

        last_exc: Exception | None = None
        for attempt in range(1, settings.EMAIL_RETRY_COUNT + 1):
            smtp = aiosmtplib.SMTP(
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                start_tls=True,
            )
            try:
                await smtp.connect()
                await smtp.login(settings.SENDER_EMAIL, settings.EMAIL_PASSWORD)
                await smtp.send_message(message)
                logger.info(
                    "Email alert sent: camera=%d type=%s to=%s",
                    violation.camera_id,
                    violation.violation_type,
                    settings.RECEIVER_EMAIL,
                )
                return True
            except aiosmtplib.SMTPAuthenticationError as exc:
                logger.error(
                    "Email authentication failed (check EMAIL_PASSWORD): %s", exc
                )
                return False
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Email send failed (attempt %d/%d): %s",
                    attempt,
                    settings.EMAIL_RETRY_COUNT,
                    exc,
                )
                if attempt < settings.EMAIL_RETRY_COUNT:
                    await asyncio.sleep(settings.EMAIL_RETRY_DELAY)
            finally:
                try:
                    await smtp.quit()
                except Exception:
                    pass

        logger.error(
            "Email alert failed after %d attempts for camera %d: %s",
            settings.EMAIL_RETRY_COUNT,
            violation.camera_id,
            last_exc,
        )
        return False
