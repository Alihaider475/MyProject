from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from backend.core.config import settings
from backend.database.settings_store import (
    PERSISTABLE_SETTINGS,
    load_runtime_settings,
    save_runtime_setting,
)

TOGGLE_ATTRS = tuple(PERSISTABLE_SETTINGS.values())


@pytest.fixture(autouse=True)
def restore_settings():
    snapshot = {attr: getattr(settings, attr) for attr in TOGGLE_ATTRS}
    yield
    for attr, val in snapshot.items():
        setattr(settings, attr, val)


@pytest.fixture
async def settings_client(db_session):
    """Client with auth bypassed — settings routes are JWT-protected.

    Mounts only the settings router (importing backend.main rewraps
    sys.stdout/stderr, which breaks pytest's capture on Windows).
    """
    from fastapi import FastAPI

    from backend.auth.supabase_auth import verify_supabase_token
    from backend.database.connection import get_db
    from backend.routes.settings import router as settings_router

    app = FastAPI()
    app.include_router(settings_router, prefix="/api/v1")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_supabase_token] = lambda: {"sub": "test-user"}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _fetch_rows(db_session, key: str):
    result = await db_session.execute(
        text("SELECT value FROM system_settings WHERE key = :key"), {"key": key}
    )
    return result.fetchall()


# ---------------------------------------------------------------------------
# Store-level tests
# ---------------------------------------------------------------------------

async def test_env_defaults_kept_when_no_persisted_rows(db_session):
    for attr in TOGGLE_ATTRS:
        setattr(settings, attr, True)
    await load_runtime_settings(db_session)
    for attr in TOGGLE_ATTRS:
        assert getattr(settings, attr) is True


async def test_save_then_update_is_single_upserted_row(db_session):
    await save_runtime_setting("email_alerts_enabled", False, db_session)
    rows = await _fetch_rows(db_session, "email_alerts_enabled")
    assert [r[0] for r in rows] == ["false"]

    await save_runtime_setting("email_alerts_enabled", True, db_session)
    rows = await _fetch_rows(db_session, "email_alerts_enabled")
    assert [r[0] for r in rows] == ["true"]


@pytest.mark.parametrize("key,attr", list(PERSISTABLE_SETTINGS.items()))
async def test_restart_restores_persisted_override(db_session, key, attr):
    await save_runtime_setting(key, False, db_session)
    # Simulate a fresh boot: singleton back at its .env default, then reload.
    setattr(settings, attr, True)
    await load_runtime_settings(db_session)
    assert getattr(settings, attr) is False


async def test_unknown_key_rejected(db_session):
    with pytest.raises(ValueError):
        await save_runtime_setting("smtp_password", True, db_session)
    assert await _fetch_rows(db_session, "smtp_password") == []


async def test_load_ignores_unknown_rows(db_session):
    await db_session.execute(
        text("INSERT INTO system_settings (key, value) VALUES ('bogus_key', 'true')")
    )
    await db_session.commit()
    await load_runtime_settings(db_session)  # must not raise or set anything


# ---------------------------------------------------------------------------
# Route-level tests
# ---------------------------------------------------------------------------

async def test_get_settings_shape(settings_client):
    r = await settings_client.get("/api/v1/settings")
    assert r.status_code == 200
    data = r.json()
    assert set(data) == {
        "email_alerts_enabled",
        "mqtt_enabled",
        "webhook_enabled",
        "smtp_configured",
        "mqtt_configured",
        "webhook_configured",
    }


@pytest.mark.parametrize(
    "path,key,attr,response_field",
    [
        ("/api/v1/settings/email-alerts", "email_alerts_enabled", "EMAIL_ALERTS_ENABLED", "email_alerts_enabled"),
        ("/api/v1/settings/mqtt-alerts", "mqtt_enabled", "MQTT_ENABLED", "mqtt_enabled"),
        ("/api/v1/settings/webhook-alerts", "webhook_enabled", "WEBHOOK_ENABLED", "webhook_enabled"),
    ],
)
async def test_put_toggle_persists_and_applies(settings_client, db_session, path, key, attr, response_field):
    r = await settings_client.put(path, json={"enabled": False})
    assert r.status_code == 200
    assert r.json()[response_field] is False
    assert getattr(settings, attr) is False
    rows = await _fetch_rows(db_session, key)
    assert [row[0] for row in rows] == ["false"]


# ---------------------------------------------------------------------------
# Handler skip behavior
# ---------------------------------------------------------------------------

def _make_violation():
    from backend.detection.violation_checker import ViolationEvent

    return ViolationEvent(camera_id=1, violation_type="NO-Hardhat", confidence=0.9)


async def test_mqtt_handler_skips_when_disabled():
    from backend.alerts.mqtt_handler import MQTTHandler

    settings.MQTT_ENABLED = False
    result = await MQTTHandler().send(_make_violation())
    assert result.status == "skipped"
    assert "disabled" in result.detail


async def test_webhook_handler_skips_when_disabled():
    from backend.alerts.webhook_handler import WebhookHandler

    settings.WEBHOOK_ENABLED = False
    result = await WebhookHandler(url="http://example.invalid/hook").send(_make_violation())
    assert result.status == "skipped"
    assert "disabled" in result.detail
