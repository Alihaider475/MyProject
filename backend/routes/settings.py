from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.database.connection import get_db
from backend.database.settings_store import save_runtime_setting

logger = get_logger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    email_alerts_enabled: bool
    mqtt_enabled: bool
    webhook_enabled: bool
    # Configured-status flags only — never the secret values themselves.
    smtp_configured: bool
    mqtt_configured: bool
    webhook_configured: bool


class AlertToggle(BaseModel):
    enabled: bool


def _settings_response() -> SettingsResponse:
    return SettingsResponse(
        email_alerts_enabled=settings.EMAIL_ALERTS_ENABLED,
        mqtt_enabled=settings.MQTT_ENABLED,
        webhook_enabled=settings.WEBHOOK_ENABLED,
        smtp_configured=bool(settings.SENDER_EMAIL and settings.EMAIL_PASSWORD),
        mqtt_configured=bool(settings.MQTT_BROKER),
        webhook_configured=bool(settings.WEBHOOK_URL),
    )


async def _apply_toggle(key: str, attr: str, enabled: bool, db: AsyncSession) -> SettingsResponse:
    # In-memory first: alert dispatch must honor the toggle even if the
    # database write below fails.
    setattr(settings, attr, enabled)
    try:
        await save_runtime_setting(key, enabled, db)
    except Exception as exc:
        logger.warning("Failed to persist setting %s=%s (in-memory value applied): %s", key, enabled, exc)
    return _settings_response()


@router.get("", response_model=SettingsResponse)
async def get_settings(_user=Depends(verify_supabase_token)):
    return _settings_response()


@router.put("/email-alerts", response_model=SettingsResponse)
async def toggle_email_alerts(
    body: AlertToggle,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    return await _apply_toggle("email_alerts_enabled", "EMAIL_ALERTS_ENABLED", body.enabled, db)


@router.put("/mqtt-alerts", response_model=SettingsResponse)
async def toggle_mqtt_alerts(
    body: AlertToggle,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    return await _apply_toggle("mqtt_enabled", "MQTT_ENABLED", body.enabled, db)


@router.put("/webhook-alerts", response_model=SettingsResponse)
async def toggle_webhook_alerts(
    body: AlertToggle,
    _user=Depends(verify_supabase_token),
    db: AsyncSession = Depends(get_db),
):
    return await _apply_toggle("webhook_enabled", "WEBHOOK_ENABLED", body.enabled, db)
