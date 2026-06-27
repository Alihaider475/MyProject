from __future__ import annotations

import pytest

from backend.database.models import Camera, Violation


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


async def test_list_violations_empty(test_client):
    r = await test_client.get("/api/v1/violations")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 0
    assert data["items"] == []


async def test_list_violations_with_data(test_client, db_session):
    cam = await _seed_camera(db_session)
    await _seed_violation(db_session, cam.id)

    r = await test_client.get("/api/v1/violations")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["violation_type"] == "NO-Hardhat"


async def test_get_violation_not_found(test_client):
    r = await test_client.get("/api/v1/violations/9999")
    assert r.status_code == 404


async def test_get_violation_found(test_client, db_session):
    cam = await _seed_camera(db_session)
    v = await _seed_violation(db_session, cam.id)

    r = await test_client.get(f"/api/v1/violations/{v.id}")
    assert r.status_code == 200
    assert r.json()["id"] == v.id


async def test_export_csv(test_client, db_session):
    cam = await _seed_camera(db_session)
    await _seed_violation(db_session, cam.id)

    r = await test_client.get("/api/v1/violations/export")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "NO-Hardhat" in r.text


async def test_violation_stats_fields(test_client, db_session):
    cam = await _seed_camera(db_session)
    await _seed_violation(db_session, cam.id)

    # Explicit `from` keeps this test's manual cache key isolated from any
    # other call to /violations/stats in the suite.
    r = await test_client.get("/api/v1/violations/stats", params={"from": "2000-01-01T00:00:00"})
    assert r.status_code == 200
    data = r.json()

    assert data["total"] == 1
    # Flat shape must stay intact — ReportModal.jsx still reads camera_id/count.
    assert data["by_camera"] == [{"camera_id": cam.id, "count": 1}]

    # New additive fields.
    assert data["by_camera_type"] == [{"camera_id": cam.id, "total": 1, "NO-Hardhat": 1}]

    bins = data["confidence_distribution"]
    assert [b["bin"] for b in bins] == [
        "< 0.3", "0.3-0.4", "0.4-0.5", "0.5-0.6",
        "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0",
    ]
    assert sum(b["count"] for b in bins) == 1
    # Seeded violation has confidence=0.9 -> falls in the top bin.
    assert next(b["count"] for b in bins if b["bin"] == "0.9-1.0") == 1
    assert data["mean_confidence"] == 0.9
