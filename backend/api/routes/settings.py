from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsResponse(BaseModel):
    email_alerts_enabled: bool


class EmailAlertToggle(BaseModel):
    enabled: bool


@router.get("", response_model=SettingsResponse)
async def get_settings(_user=Depends(verify_supabase_token)):
    return SettingsResponse(email_alerts_enabled=settings.EMAIL_ALERTS_ENABLED)


@router.put("/email-alerts", response_model=SettingsResponse)
async def toggle_email_alerts(body: EmailAlertToggle, _user=Depends(verify_supabase_token)):
    settings.EMAIL_ALERTS_ENABLED = body.enabled
    return SettingsResponse(email_alerts_enabled=settings.EMAIL_ALERTS_ENABLED)
