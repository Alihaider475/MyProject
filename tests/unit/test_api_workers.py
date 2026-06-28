from __future__ import annotations

from sqlalchemy import select

from backend.database.models import Camera, Fine, Violation, Worker


async def _seed_worker_with_violation(db_session, *, employee_id: str = "EMP-900") -> Worker:
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


async def test_delete_endpoint_hard_deletes_worker(test_client, db_session):
    worker = await _seed_worker_with_violation(db_session, employee_id="EMP-902")
    worker_id = worker.id

    r = await test_client.delete(f"/api/v1/workers/{worker_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] is True
    assert body["worker_id"] == worker_id

    # Worker row must be gone
    gone = (await db_session.execute(select(Worker).where(Worker.id == worker_id))).scalar_one_or_none()
    assert gone is None

    # Violation must still exist but worker_id nullified
    violation = (await db_session.execute(select(Violation).where(Violation.camera_id != None))).scalar_one_or_none()
    assert violation is not None
    assert violation.worker_id is None


async def test_delete_missing_worker_404(test_client):
    r = await test_client.delete("/api/v1/workers/999999")
    assert r.status_code == 404


async def test_active_only_filter_shows_only_active(test_client, db_session):
    active = await _seed_worker_with_violation(db_session, employee_id="EMP-904")

    r = await test_client.get("/api/v1/workers", params={"active_only": "true"})
    assert r.status_code == 200
    ids = [w["id"] for w in r.json()]
    assert active.id in ids


async def test_deleted_worker_no_longer_in_list(test_client, db_session):
    worker = await _seed_worker_with_violation(db_session, employee_id="EMP-905")
    await test_client.delete(f"/api/v1/workers/{worker.id}")

    r = await test_client.get("/api/v1/workers")
    assert r.status_code == 200
    ids = [w["id"] for w in r.json()]
    assert worker.id not in ids
