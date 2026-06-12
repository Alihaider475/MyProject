from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from backend.database.models import AlertLog, Camera, Violation


def _build_app(db_session, *, bypass_auth: bool = True):
    """Mount only the alert-logs router (importing backend.main rewraps
    sys.stdout/stderr, which breaks pytest's capture on Windows)."""
    from fastapi import FastAPI

    from backend.auth.supabase_auth import verify_supabase_token
    from backend.database.connection import get_db
    from backend.routes.alert_logs import router as alert_logs_router

    app = FastAPI()
    app.include_router(alert_logs_router, prefix="/api/v1")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    if bypass_auth:
        app.dependency_overrides[verify_supabase_token] = lambda: {"sub": "test-user"}
    return app


@pytest.fixture
async def alert_logs_client(db_session):
    app = _build_app(db_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _seed_camera(db_session):
    cam = Camera(name="Test Cam", source_type="webcam", source_uri="0")
    db_session.add(cam)
    await db_session.commit()
    await db_session.refresh(cam)
    return cam


async def _seed_violation(db_session, camera_id: int):
    v = Violation(
        camera_id=camera_id,
        violation_type="NO-Hardhat",
        confidence=0.9,
    )
    db_session.add(v)
    await db_session.commit()
    await db_session.refresh(v)
    return v


async def _seed_log(
    db_session,
    violation_id: int,
    handler_type: str,
    success: bool,
    error_msg: str | None = None,
    sent_at: datetime | None = None,
):
    log = AlertLog(
        violation_id=violation_id,
        handler_type=handler_type,
        success=success,
        error_msg=error_msg,
    )
    if sent_at is not None:
        log.sent_at = sent_at
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)
    return log


async def _seed_sent_skipped_failed(db_session):
    """Seed one sent, one skipped, and one failed log with increasing sent_at."""
    cam = await _seed_camera(db_session)
    v = await _seed_violation(db_session, cam.id)
    base = datetime(2026, 6, 1, 12, 0, 0)
    sent = await _seed_log(db_session, v.id, "email", True, None, base)
    skipped = await _seed_log(
        db_session, v.id, "webhook", True,
        "skipped: WEBHOOK_URL not configured", base + timedelta(minutes=1),
    )
    failed = await _seed_log(
        db_session, v.id, "mqtt", False,
        "failed after 3 attempts: connection refused", base + timedelta(minutes=2),
    )
    return cam, v, sent, skipped, failed


async def test_list_alert_logs_empty(alert_logs_client):
    r = await alert_logs_client.get("/api/v1/alert-logs")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_list_alert_logs_newest_first_with_status(alert_logs_client, db_session):
    cam, v, sent, skipped, failed = await _seed_sent_skipped_failed(db_session)

    r = await alert_logs_client.get("/api/v1/alert-logs")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 3
    items = data["items"]
    assert [i["id"] for i in items] == [failed.id, skipped.id, sent.id]
    assert [i["status"] for i in items] == ["failed", "skipped", "sent"]
    # Joined context from the Violation row
    assert items[0]["violation_type"] == "NO-Hardhat"
    assert items[0]["camera_id"] == cam.id


async def test_filter_by_handler_type(alert_logs_client, db_session):
    await _seed_sent_skipped_failed(db_session)

    r = await alert_logs_client.get("/api/v1/alert-logs", params={"handler_type": "email"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["handler_type"] == "email"


async def test_filter_by_status(alert_logs_client, db_session):
    await _seed_sent_skipped_failed(db_session)

    r = await alert_logs_client.get("/api/v1/alert-logs", params={"status": "skipped"})
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["error_msg"].startswith("skipped:")

    r = await alert_logs_client.get("/api/v1/alert-logs", params={"status": "failed"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["success"] is False

    r = await alert_logs_client.get("/api/v1/alert-logs", params={"status": "sent"})
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["error_msg"] is None


async def test_filter_by_violation_id_and_date(alert_logs_client, db_session):
    cam, v, sent, skipped, failed = await _seed_sent_skipped_failed(db_session)
    other_violation = await _seed_violation(db_session, cam.id)
    await _seed_log(
        db_session, other_violation.id, "email", True, None,
        datetime(2026, 6, 1, 11, 0, 0),
    )

    r = await alert_logs_client.get(
        "/api/v1/alert-logs", params={"violation_id": other_violation.id}
    )
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["violation_id"] == other_violation.id

    # from filter excludes the older 11:00 log
    r = await alert_logs_client.get(
        "/api/v1/alert-logs", params={"from": "2026-06-01T12:00:00"}
    )
    assert r.json()["total"] == 3


async def test_pagination(alert_logs_client, db_session):
    cam, v, sent, skipped, failed = await _seed_sent_skipped_failed(db_session)

    r = await alert_logs_client.get(
        "/api/v1/alert-logs", params={"page_size": 1, "page": 2}
    )
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 3
    assert data["page"] == 2
    assert len(data["items"]) == 1
    assert data["items"][0]["id"] == skipped.id  # second-newest


async def test_error_msg_url_redacted(alert_logs_client, db_session):
    cam = await _seed_camera(db_session)
    v = await _seed_violation(db_session, cam.id)
    await _seed_log(
        db_session, v.id, "webhook", False,
        "failed after 3 attempts: Server error '500' for url 'https://hooks.example.com/secret-path'",
    )

    r = await alert_logs_client.get("/api/v1/alert-logs")
    assert r.status_code == 200
    msg = r.json()["items"][0]["error_msg"]
    assert "hooks.example.com" not in msg
    assert "[url redacted]" in msg


async def test_invalid_status_rejected(alert_logs_client):
    r = await alert_logs_client.get("/api/v1/alert-logs", params={"status": "bogus"})
    assert r.status_code == 422


async def test_requires_auth(db_session):
    app = _build_app(db_session, bypass_auth=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/alert-logs")
    assert r.status_code == 401
