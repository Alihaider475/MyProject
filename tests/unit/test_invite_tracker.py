from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.database.models import Worker, WorkerInviteLog
from backend.services.invite_tracker_service import (
    create_or_update_invite_log,
    update_invite_status,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _make_worker(db, *, name: str = "Alice", email: str = "alice@test.com") -> Worker:
    w = Worker(employee_id=f"EMP-{name[:3].upper()}", name=name, email=email)
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


async def _seed_log(db, worker: Worker) -> WorkerInviteLog:
    return await create_or_update_invite_log(worker.id, worker.email, worker.name, db)


# ─── Service-level tests ───────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_invite_log_sets_invited_status(db_session):
    worker = await _make_worker(db_session)
    row = await _seed_log(db_session, worker)
    assert row.status == "invited"
    assert row.invited_at is not None
    assert row.resend_count == 0


@pytest.mark.anyio
async def test_re_invite_increments_resend_count(db_session):
    worker = await _make_worker(db_session, name="Bob", email="bob@test.com")
    await _seed_log(db_session, worker)
    row = await create_or_update_invite_log(worker.id, worker.email, worker.name, db_session)
    assert row.resend_count == 1
    assert row.status == "invited"
    row2 = await create_or_update_invite_log(worker.id, worker.email, worker.name, db_session)
    assert row2.resend_count == 2


@pytest.mark.anyio
async def test_update_status_clicked(db_session):
    worker = await _make_worker(db_session, name="Carol", email="carol@test.com")
    await _seed_log(db_session, worker)
    row = await update_invite_status(worker.id, "clicked", db_session)
    assert row.status == "clicked"
    assert row.clicked_at is not None


@pytest.mark.anyio
async def test_update_status_registered(db_session):
    worker = await _make_worker(db_session, name="Dave", email="dave@test.com")
    await _seed_log(db_session, worker)
    await update_invite_status(worker.id, "clicked", db_session)
    row = await update_invite_status(worker.id, "registered", db_session)
    assert row.status == "registered"
    assert row.registered_at is not None


@pytest.mark.anyio
async def test_update_status_logged_in_sets_first_login(db_session):
    worker = await _make_worker(db_session, name="Eve", email="eve@test.com")
    await _seed_log(db_session, worker)
    await update_invite_status(worker.id, "clicked", db_session)
    await update_invite_status(worker.id, "registered", db_session)
    row = await update_invite_status(worker.id, "logged_in", db_session)
    assert row.status == "logged_in"
    assert row.first_login_at is not None


@pytest.mark.anyio
async def test_first_login_at_not_overwritten_on_second_login(db_session):
    worker = await _make_worker(db_session, name="Frank", email="frank@test.com")
    await _seed_log(db_session, worker)
    row1 = await update_invite_status(worker.id, "logged_in", db_session)
    first_ts = row1.first_login_at
    # Second call must not overwrite first_login_at
    row2 = await update_invite_status(worker.id, "logged_in", db_session)
    assert row2.first_login_at == first_ts


@pytest.mark.anyio
async def test_status_does_not_downgrade(db_session):
    worker = await _make_worker(db_session, name="Grace", email="grace@test.com")
    await _seed_log(db_session, worker)
    await update_invite_status(worker.id, "logged_in", db_session)
    # Trying to move to "clicked" (lower) must be a no-op
    row = await update_invite_status(worker.id, "clicked", db_session)
    assert row.status == "logged_in"


@pytest.mark.anyio
async def test_update_status_returns_none_for_unknown_worker(db_session):
    row = await update_invite_status(99999, "clicked", db_session)
    assert row is None


# ─── API-level tests ───────────────────────────────────────────────────────────

def _make_admin_client(db_session):
    """Return an AsyncClient with admin role JWT override."""
    from backend.main import create_app
    from backend.auth.supabase_auth import verify_supabase_token
    from backend.database.connection import get_db

    app = create_app()

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_supabase_token] = lambda: {
        "sub": "admin-user",
        "user_metadata": {"role": "admin"},
    }
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _make_worker_client(db_session, worker: Worker):
    """Return an AsyncClient with worker role JWT override, linked to a specific worker."""
    from backend.main import create_app
    from backend.auth.supabase_auth import verify_supabase_token
    from backend.database.connection import get_db

    app = create_app()

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_supabase_token] = lambda: {
        "sub": "worker-user",
        "email": worker.email,
        "user_metadata": {"role": "worker", "worker_id": worker.id},
    }
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_admin_tracker_returns_correct_data(db_session):
    worker = await _make_worker(db_session, name="Hank", email="hank@test.com")
    await _seed_log(db_session, worker)

    async with _make_admin_client(db_session) as client:
        r = await client.get("/api/v1/admin/worker-invites/tracker")
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["total"] >= 1
    assert body["summary"]["invited"] >= 1
    assert any(item["worker_id"] == worker.id for item in body["items"])


@pytest.mark.anyio
async def test_admin_tracker_status_filter(db_session):
    worker = await _make_worker(db_session, name="Ida", email="ida@test.com")
    await _seed_log(db_session, worker)

    async with _make_admin_client(db_session) as client:
        r_invited = await client.get("/api/v1/admin/worker-invites/tracker", params={"status": "invited"})
        r_logged = await client.get("/api/v1/admin/worker-invites/tracker", params={"status": "logged_in"})

    assert r_invited.status_code == 200
    assert all(i["status"] == "invited" for i in r_invited.json()["items"])
    assert r_logged.status_code == 200
    assert all(i["status"] == "logged_in" for i in r_logged.json()["items"])


@pytest.mark.anyio
async def test_admin_tracker_view_pending(db_session):
    worker = await _make_worker(db_session, name="Jake", email="jake@test.com")
    await _seed_log(db_session, worker)

    async with _make_admin_client(db_session) as client:
        r = await client.get("/api/v1/admin/worker-invites/tracker", params={"view": "pending"})
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["status"] in ("invited", "clicked")


@pytest.mark.anyio
async def test_admin_tracker_view_completed(db_session):
    worker = await _make_worker(db_session, name="Kate", email="kate@test.com")
    await _seed_log(db_session, worker)
    await update_invite_status(worker.id, "logged_in", db_session)

    async with _make_admin_client(db_session) as client:
        r = await client.get("/api/v1/admin/worker-invites/tracker", params={"view": "completed"})
    assert r.status_code == 200
    for item in r.json()["items"]:
        assert item["status"] in ("registered", "logged_in")


@pytest.mark.anyio
async def test_non_admin_cannot_access_tracker(test_client):
    # test_client uses verify_supabase_token → {"sub": "test-user"} (no role)
    r = await test_client.get("/api/v1/admin/worker-invites/tracker")
    assert r.status_code == 403


@pytest.mark.anyio
async def test_non_admin_cannot_create_invite_log(test_client):
    r = await test_client.post("/api/v1/admin/worker-invites/1", json={"email": "x@x.com", "full_name": "X"})
    assert r.status_code == 403


@pytest.mark.anyio
async def test_worker_track_invite_clicked(db_session):
    worker = await _make_worker(db_session, name="Leo", email="leo@test.com")
    await _seed_log(db_session, worker)

    async with _make_worker_client(db_session, worker) as client:
        r = await client.post("/api/v1/worker/me/track-invite", json={"event": "clicked"})
    assert r.status_code == 200
    assert r.json()["status"] == "clicked"


@pytest.mark.anyio
async def test_worker_track_invite_registered(db_session):
    worker = await _make_worker(db_session, name="Mia", email="mia@test.com")
    await _seed_log(db_session, worker)
    await update_invite_status(worker.id, "clicked", db_session)

    async with _make_worker_client(db_session, worker) as client:
        r = await client.post("/api/v1/worker/me/track-invite", json={"event": "registered"})
    assert r.status_code == 200
    assert r.json()["status"] == "registered"


@pytest.mark.anyio
async def test_worker_track_invite_invalid_event(db_session):
    worker = await _make_worker(db_session, name="Ned", email="ned@test.com")

    async with _make_worker_client(db_session, worker) as client:
        r = await client.post("/api/v1/worker/me/track-invite", json={"event": "logged_in"})
    assert r.status_code == 400
