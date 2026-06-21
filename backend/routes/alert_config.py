from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.database.connection import get_db
from backend.database.settings_store import save_alert_config_fields

logger = get_logger(__name__)

router = APIRouter(prefix="/alerts/config", tags=["alert-config"])


# ─── Response schemas ─────────────────────────────────────────────────────────

class SmtpConfigOut(BaseModel):
    enabled: bool
    host: str
    port: int
    sender_email: str
    receiver_email: str
    password_set: bool
    use_tls: bool


class MqttConfigOut(BaseModel):
    enabled: bool
    broker: str
    port: int
    topic: str
    username: str
    password_set: bool


class WebhookConfigOut(BaseModel):
    enabled: bool
    url: str


class AlertConfigOut(BaseModel):
    smtp: SmtpConfigOut
    mqtt: MqttConfigOut
    webhook: WebhookConfigOut


class TestAlertResult(BaseModel):
    channel: str
    success: bool
    message: str


# ─── Input schemas ────────────────────────────────────────────────────────────

class SmtpConfigIn(BaseModel):
    enabled: bool
    host: str = ""
    port: int = 587
    sender_email: str = ""
    receiver_email: str = ""
    password: str = ""
    use_tls: bool = True

    @model_validator(mode="after")
    def validate_required_when_enabled(self) -> SmtpConfigIn:
        if not self.enabled:
            return self
        if not self.host.strip():
            raise ValueError("SMTP host is required when email alerts are enabled")
        if not (1 <= self.port <= 65535):
            raise ValueError("SMTP port must be between 1 and 65535")
        if not self.sender_email.strip() or "@" not in self.sender_email:
            raise ValueError("A valid sender email is required when email alerts are enabled")
        if not self.receiver_email.strip() or "@" not in self.receiver_email:
            raise ValueError("A valid receiver email is required when email alerts are enabled")
        if not self.password and not settings.EMAIL_PASSWORD:
            raise ValueError("SMTP password is required when email alerts are enabled")
        return self


class MqttConfigIn(BaseModel):
    enabled: bool
    broker: str = ""
    port: int = 1883
    topic: str = "ppe/alerts"
    username: str = ""
    password: str = ""

    @model_validator(mode="after")
    def validate_required_when_enabled(self) -> MqttConfigIn:
        if not self.enabled:
            return self
        if not self.broker.strip():
            raise ValueError("MQTT broker host is required when MQTT alerts are enabled")
        if not (1 <= self.port <= 65535):
            raise ValueError("MQTT port must be between 1 and 65535")
        return self


class WebhookConfigIn(BaseModel):
    enabled: bool
    url: str = ""

    @model_validator(mode="after")
    def validate_required_when_enabled(self) -> WebhookConfigIn:
        if not self.enabled:
            return self
        if not self.url.strip():
            raise ValueError("Webhook URL is required when webhook alerts are enabled")
        if not (self.url.startswith("http://") or self.url.startswith("https://")):
            raise ValueError("Webhook URL must start with http:// or https://")
        return self


# ─── Helper ───────────────────────────────────────────────────────────────────

def _build_response() -> AlertConfigOut:
    return AlertConfigOut(
        smtp=SmtpConfigOut(
            enabled=settings.EMAIL_ALERTS_ENABLED,
            host=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            sender_email=settings.SENDER_EMAIL,
            receiver_email=settings.RECEIVER_EMAIL,
            password_set=bool(settings.EMAIL_PASSWORD),
            use_tls=settings.SMTP_USE_TLS,
        ),
        mqtt=MqttConfigOut(
            enabled=settings.MQTT_ENABLED,
            broker=settings.MQTT_BROKER,
            port=settings.MQTT_PORT,
            topic=settings.MQTT_TOPIC,
            username=settings.MQTT_USERNAME,
            password_set=bool(settings.MQTT_PASSWORD),
        ),
        webhook=WebhookConfigOut(
            enabled=settings.WEBHOOK_ENABLED,
            url=settings.WEBHOOK_URL,
        ),
    )


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("", response_model=AlertConfigOut)
async def get_alert_config(_user=Depends(verify_supabase_token)):
    return _build_response()


@router.put("/smtp", response_model=AlertConfigOut)
async def update_smtp_config(
    body: SmtpConfigIn,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    # In-memory first so alert dispatch honors changes even if DB write fails
    settings.EMAIL_ALERTS_ENABLED = body.enabled
    settings.SMTP_HOST = body.host
    settings.SMTP_PORT = body.port
    settings.SENDER_EMAIL = body.sender_email
    settings.RECEIVER_EMAIL = body.receiver_email
    settings.SMTP_USE_TLS = body.use_tls
    if body.password:
        settings.EMAIL_PASSWORD = body.password

    fields: dict[str, str] = {
        "email_alerts_enabled": "true" if body.enabled else "false",
        "smtp_host": body.host,
        "smtp_port": str(body.port),
        "smtp_sender_email": body.sender_email,
        "smtp_receiver_email": body.receiver_email,
        "smtp_use_tls": "true" if body.use_tls else "false",
    }
    if body.password:
        fields["smtp_password"] = body.password

    try:
        await save_alert_config_fields(fields, db)
    except Exception as exc:
        logger.warning("Failed to persist SMTP config (in-memory applied): %s", exc)

    return _build_response()


@router.put("/mqtt", response_model=AlertConfigOut)
async def update_mqtt_config(
    body: MqttConfigIn,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    settings.MQTT_ENABLED = body.enabled
    settings.MQTT_BROKER = body.broker
    settings.MQTT_PORT = body.port
    settings.MQTT_TOPIC = body.topic
    settings.MQTT_USERNAME = body.username
    if body.password:
        settings.MQTT_PASSWORD = body.password

    fields: dict[str, str] = {
        "mqtt_enabled": "true" if body.enabled else "false",
        "mqtt_broker": body.broker,
        "mqtt_port": str(body.port),
        "mqtt_topic": body.topic,
        "mqtt_username": body.username,
    }
    if body.password:
        fields["mqtt_password"] = body.password

    try:
        await save_alert_config_fields(fields, db)
    except Exception as exc:
        logger.warning("Failed to persist MQTT config (in-memory applied): %s", exc)

    return _build_response()


@router.put("/webhook", response_model=AlertConfigOut)
async def update_webhook_config(
    body: WebhookConfigIn,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    settings.WEBHOOK_ENABLED = body.enabled
    settings.WEBHOOK_URL = body.url

    fields: dict[str, str] = {
        "webhook_enabled": "true" if body.enabled else "false",
        "webhook_url": body.url,
    }

    try:
        await save_alert_config_fields(fields, db)
    except Exception as exc:
        logger.warning("Failed to persist webhook config (in-memory applied): %s", exc)

    return _build_response()


@router.post("/test/{channel}", response_model=TestAlertResult)
async def test_alert_channel(
    channel: str,
    _user=Depends(verify_supabase_token),
):
    """Send a sample alert through the specified channel to verify configuration."""
    if channel not in ("smtp", "mqtt", "webhook"):
        return TestAlertResult(channel=channel, success=False, message="Unknown channel")

    from backend.detection.violation_checker import ViolationEvent

    fake_event = ViolationEvent(
        camera_id=0,
        violation_type="NO-Hardhat",
        confidence=0.95,
        frame_path=None,
        violation_id=None,
    )

    if channel == "smtp":
        from backend.alerts.email_handler import EmailHandler
        handler: object = EmailHandler()
    elif channel == "mqtt":
        from backend.alerts.mqtt_handler import MQTTHandler
        handler = MQTTHandler()
    else:
        from backend.alerts.webhook_handler import WebhookHandler
        handler = WebhookHandler()

    try:
        result = await handler.send(fake_event)  # type: ignore[attr-defined]
        if result.status == "sent":
            return TestAlertResult(channel=channel, success=True, message="Test alert sent successfully")
        return TestAlertResult(channel=channel, success=False, message=result.detail or result.status)
    except Exception as exc:
        logger.warning("Test alert failed for channel %s: %s", channel, exc)
        return TestAlertResult(channel=channel, success=False, message=str(exc))
