"""Backend QA smoke suite — confirms the real running API works end to end
and writes land in the configured database (Supabase PostgreSQL) before
Dockerization. See tests/smoke/conftest.py for how to point this at a
running backend and supply an auth token.

Run:
    .venv\\Scripts\\python.exe -m pytest tests/smoke -v -s
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from tests.smoke.conftest import API_PREFIX, requires_jwt, requires_write, report


async def test_health(client):
    r = await client.get("/health")
    report("GET", f"{API_PREFIX}/health", r, f"status={r.json().get('status')!r}")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_ready(client):
    r = await client.get("/ready")
    report("GET", f"{API_PREFIX}/ready", r, f"model_status={r.json().get('status')!r}")
    assert r.status_code in (200, 503)


async def test_metrics(client):
    r = await client.get("/metrics")
    report("GET", f"{API_PREFIX}/metrics", r, f"cameras={r.json().get('cameras')}")
    assert r.status_code == 200


@requires_jwt
async def test_list_workers(client):
    r = await client.get("/workers")
    report("GET", f"{API_PREFIX}/workers", r, f"{len(r.json()) if r.status_code == 200 else r.text} workers")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@requires_jwt
async def test_list_violations(client):
    r = await client.get("/violations", params={"page": 1, "page_size": 5})
    body = r.json() if r.status_code == 200 else {}
    report("GET", f"{API_PREFIX}/violations", r, f"total={body.get('total')}")
    assert r.status_code == 200
    assert "items" in r.json()


@requires_jwt
async def test_violation_stats(client):
    r = await client.get("/violations/stats")
    body = r.json() if r.status_code == 200 else {}
    report("GET", f"{API_PREFIX}/violations/stats", r, f"total={body.get('total')}")
    assert r.status_code == 200


@requires_jwt
async def test_fine_config_list(client):
    r = await client.get("/fines/config")
    report("GET", f"{API_PREFIX}/fines/config", r, f"{len(r.json()) if r.status_code == 200 else r.text} configs")
    assert r.status_code == 200
    types = {c["violation_type"] for c in r.json()}
    # Seeded by init_db() in backend/database/connection.py
    assert {"NO-Hardhat", "NO-Mask", "NO-Safety Vest"}.issubset(types)


@requires_jwt
async def test_alert_logs_list(client):
    r = await client.get("/alert-logs", params={"page": 1, "page_size": 5})
    body = r.json() if r.status_code == 200 else {}
    report("GET", f"{API_PREFIX}/alert-logs", r, f"total={body.get('total')}")
    assert r.status_code == 200


@requires_jwt
async def test_settings_get(client):
    r = await client.get("/settings")
    report("GET", f"{API_PREFIX}/settings", r, f"{r.json() if r.status_code == 200 else r.text}")
    assert r.status_code == 200


@requires_jwt
async def test_dashboard_summary(client):
    r = await client.get("/dashboard/summary")
    body = r.json() if r.status_code == 200 else {}
    report(
        "GET", f"{API_PREFIX}/dashboard/summary", r,
        f"active_cameras={body.get('active_cameras')} total_violations={body.get('total_violations')}",
    )
    assert r.status_code == 200


@requires_jwt
@requires_write
async def test_camera_create_list_delete(client):
    """Create a uniquely-named test camera, confirm it is persisted (visible
    on a fresh GET /cameras), then delete it so no junk data is left behind
    in the real database."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    name = f"Claude Test Camera {timestamp}"
    payload = {
        "name": name,
        "source_type": "rtsp",
        "source_uri": f"rtsp://smoke-test-{timestamp}.invalid/stream",
        "detection_confidence": 0.5,
    }

    r_create = await client.post("/cameras", json=payload)
    report("POST", f"{API_PREFIX}/cameras", r_create, f"created {name!r}" if r_create.status_code == 201 else r_create.text)
    assert r_create.status_code == 201, r_create.text
    camera_id = r_create.json()["id"]

    try:
        r_list = await client.get("/cameras")
        report("GET", f"{API_PREFIX}/cameras", r_list, f"{len(r_list.json())} cameras")
        assert r_list.status_code == 200
        assert any(c["id"] == camera_id and c["name"] == name for c in r_list.json()), (
            "Created camera did not appear in GET /cameras — write may not have reached the database"
        )
    finally:
        r_delete = await client.delete(f"/cameras/{camera_id}")
        report("DELETE", f"{API_PREFIX}/cameras/{camera_id}", r_delete, "cleanup")
        assert r_delete.status_code == 204
