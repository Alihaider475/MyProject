from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from backend.alerts.base import AlertHandler, AlertResult
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class EmailHandler(AlertHandler):
    handler_type = "email"

    async def send(self, violation: ViolationEvent) -> AlertResult:
        if not settings.EMAIL_ALERTS_ENABLED:
            logger.debug("Email alert skipped — EMAIL_ALERTS_ENABLED is false")
            return AlertResult.skipped("email alerts disabled")
        if not settings.SENDER_EMAIL or not settings.EMAIL_PASSWORD:
            logger.debug(
                "Email alert skipped — SENDER_EMAIL/EMAIL_PASSWORD not configured"
            )
            return AlertResult.skipped("SMTP credentials not configured")

        message = MIMEMultipart()
        message["From"] = settings.SENDER_EMAIL
        message["To"] = settings.RECEIVER_EMAIL
        message["Subject"] = (
            f"[PPE ALERT] {violation.violation_type} Camera {violation.camera_id}"
        )

        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        lines = [
            "PPE Safety Violation Detected",
            "",
            f"Camera:       {violation.camera_id}",
            f"Type:         {violation.violation_type}",
            f"Confidence:   {violation.confidence:.0%}",
            f"Timestamp:    {ts}",
        ]
        if violation.violation_id is not None:
            lines.append(f"Violation ID: {violation.violation_id}")
        if violation.worker_name or violation.worker_id is not None:
            worker_label = violation.worker_name or f"#{violation.worker_id}"
            if violation.employee_id:
                worker_label += f" (Employee ID: {violation.employee_id})"
            lines.append(f"Worker:       {worker_label}")
        if violation.fine_amount is not None:
            fine_label = f"{violation.currency or ''} {violation.fine_amount:.2f}".strip()
            lines.append(f"Fine:         {fine_label}")
        if violation.challan_number:
            lines.append(f"Challan:      {violation.challan_number}")
        if violation.fine_status:
            lines.append(f"Fine status:  {violation.fine_status}")
        if violation.violation_counts:
            lines += ["", "Detected violations:"]
            for vtype, count in violation.violation_counts.items():
                lines.append(f"  - {vtype}: {count}")
        lines += ["", "Please review the attached snapshot."]
        message.attach(MIMEText("\n".join(lines), "plain"))

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
                start_tls=settings.SMTP_USE_TLS,
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
                return AlertResult.sent()
            except aiosmtplib.SMTPAuthenticationError as exc:
                logger.error(
                    "Email authentication failed (check EMAIL_PASSWORD): %s", exc
                )
                return AlertResult.failed("SMTP authentication failed")
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
        return AlertResult.failed(
            f"failed after {settings.EMAIL_RETRY_COUNT} attempts: {last_exc}"
        )
