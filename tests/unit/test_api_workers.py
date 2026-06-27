from __future__ import annotations

from backend.database.models import Camera, Violation, Worker


async def _seed_worker_with_history(db_session, *, employee_id: str = "EMP-900") -> Worker:
    """Create a worker with a camera + violation + fine attached, so soft-delete
    tests can assert the historical relationship survives."""
    worker = Worker(employee_id=employee_id, name="Test Worker")
    camera = Camera(name="Cam", source_type="webcam", source_uri="0")
    db_session.add_all([worker, camera])
    await db_session.flush()

    violation = Violation(
        camera_id=camera.id,
        violation_type="NO-Hardhat",
        confidence=0.9,
        worker_id=worker.id,
        fine_amount=500.0,
    )
    db_session.add(violation)
    await db_session.commit()
    await db_session.refresh(worker)
    return worker


async def test_new_worker_defaults_to_active(test_client):
    r = await test_client.post("/api/v1/workers", json={"employee_id": "EMP-901", "name": "Newbie"})
    assert r.status_code == 201
    assert r.json()["is_active"] is True


async def test_delete_endpoint_soft_deletes_and_keeps_history(test_client, db_session):
    worker = await _seed_worker_with_history(db_session, employee_id="EMP-902")

    r = await test_client.delete(f"/api/v1/workers/{worker.id}")
    assert r.status_code == 200
    body = r.json()
    assert body["is_active"] is False
    assert body["violation_count"] == 1
    assert body["total_fines"] == 500.0

    # The row itself, and its violation FK, must still exist (no hard delete).
    from sqlalchemy import select
    still_there = (await db_session.execute(select(Worker).where(Worker.id == worker.id))).scalar_one()
    assert still_there is not None
    assert still_there.is_active is False

    linked_violation = (
        await db_session.execute(select(Violation).where(Violation.worker_id == worker.id))
    ).scalar_one()
    assert linked_violation.worker_id == worker.id


async def test_reactivate_via_update_endpoint(test_client, db_session):
    worker = await _seed_worker_with_history(db_session, employee_id="EMP-903")
    await test_client.delete(f"/api/v1/workers/{worker.id}")

    r = await test_client.put(f"/api/v1/workers/{worker.id}", json={"is_active": True})
    assert r.status_code == 200
    assert r.json()["is_active"] is True


async def test_active_only_filter_excludes_deactivated(test_client, db_session):
    active = await _seed_worker_with_history(db_session, employee_id="EMP-904")
    inactive = await _seed_worker_with_history(db_session, employee_id="EMP-905")
    await test_client.delete(f"/api/v1/workers/{inactive.id}")

    r = await test_client.get("/api/v1/workers", params={"active_only": "true"})
    assert r.status_code == 200
    ids = [w["id"] for w in r.json()]
    assert active.id in ids
    assert inactive.id not in ids

    # Default (no filter) still returns both, so the admin table sees everyone.
    r_all = await test_client.get("/api/v1/workers")
    ids_all = [w["id"] for w in r_all.json()]
    assert active.id in ids_all
    assert inactive.id in ids_all


async def test_deactivate_missing_worker_404(test_client):
    r = await test_client.delete("/api/v1/workers/999999")
    assert r.status_code == 404
