from __future__ import annotations

from datetime import datetime

from backend.database.models import Camera, Fine, Violation, Worker


async def _seed_fine(
    db_session,
    *,
    status: str = "pending",
    fine_amount: float = 500.0,
    fine_date: datetime | None = None,
    challan_suffix: str = "001",
    **extra,
) -> Fine:
    """Create a worker, camera, violation, and fine in the given status."""
    worker = Worker(employee_id=f"EMP-{challan_suffix}", name="Test Worker")
    camera = Camera(name="Cam", source_type="webcam", source_uri="0")
    db_session.add_all([worker, camera])
    await db_session.flush()

    violation = Violation(
        camera_id=camera.id,
        violation_type="NO-Hardhat",
        confidence=0.9,
        worker_id=worker.id,
    )
    db_session.add(violation)
    await db_session.flush()

    fine = Fine(
        worker_id=worker.id,
        violation_id=violation.id,
        fine_amount=fine_amount,
        challan_number=f"CH-TEST-{challan_suffix}",
        status=status,
        fine_date=fine_date or datetime.utcnow(),
        **extra,
    )
    db_session.add(fine)
    await db_session.commit()
    await db_session.refresh(fine)
    return fine


async def test_settle_paid_requires_payment_method(test_client, db_session):
    fine = await _seed_fine(db_session, challan_suffix="P1")

    r = await test_client.patch(f"/api/v1/fines/{fine.id}/settle", json={"status": "paid"})
    assert r.status_code == 400

    r = await test_client.patch(
        f"/api/v1/fines/{fine.id}/settle",
        json={"status": "paid", "payment_method": "cash", "notes": "paid in cash"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "paid"
    assert data["payment_method"] == "cash"
    assert data["paid_at"] is not None
    assert data["settled_at"] is not None
    assert data["settlement_notes"] == "paid in cash"
    assert data["settled_by"] == "test-user"


async def test_settle_deducted_requires_valid_month(test_client, db_session):
    fine = await _seed_fine(db_session, challan_suffix="D1")

    r = await test_client.patch(f"/api/v1/fines/{fine.id}/settle", json={"status": "deducted"})
    assert r.status_code == 400

    r = await test_client.patch(
        f"/api/v1/fines/{fine.id}/settle",
        json={"status": "deducted", "deduction_month": "2026-13"},
    )
    assert r.status_code == 400

    r = await test_client.patch(
        f"/api/v1/fines/{fine.id}/settle",
        json={"status": "deducted", "deduction_month": "2026-06"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "deducted"
    assert data["deduction_month"] == "2026-06"


async def test_settle_waived_requires_reason(test_client, db_session):
    fine = await _seed_fine(db_session, challan_suffix="W1")

    r = await test_client.patch(f"/api/v1/fines/{fine.id}/settle", json={"status": "waived"})
    assert r.status_code == 400

    r = await test_client.patch(
        f"/api/v1/fines/{fine.id}/settle",
        json={"status": "waived", "waive_reason": "False detection confirmed"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "waived"
    assert data["waive_reason"] == "False detection confirmed"


async def test_settle_invalid_status_rejected(test_client, db_session):
    fine = await _seed_fine(db_session, challan_suffix="I1")

    r = await test_client.patch(f"/api/v1/fines/{fine.id}/settle", json={"status": "bogus"})
    assert r.status_code == 422


async def test_settle_already_settled_returns_409(test_client, db_session):
    fine = await _seed_fine(db_session, status="deducted", challan_suffix="A1", deduction_month="2026-01")

    r = await test_client.patch(
        f"/api/v1/fines/{fine.id}/settle",
        json={"status": "waived", "waive_reason": "test"},
    )
    assert r.status_code == 409


async def test_settle_fine_not_found(test_client, db_session):
    r = await test_client.patch(
        "/api/v1/fines/9999/settle",
        json={"status": "paid", "payment_method": "cash"},
    )
    assert r.status_code == 404


async def test_monthly_report_status_totals(test_client, db_session):
    month = "2026-01"
    target_date = datetime(2026, 1, 15)
    await _seed_fine(db_session, status="pending", fine_amount=100.0, fine_date=target_date, challan_suffix="M1")
    await _seed_fine(db_session, status="paid", fine_amount=200.0, fine_date=target_date, challan_suffix="M2")
    await _seed_fine(db_session, status="deducted", fine_amount=300.0, fine_date=target_date, challan_suffix="M3")
    await _seed_fine(db_session, status="waived", fine_amount=400.0, fine_date=target_date, challan_suffix="M4")

    r = await test_client.get("/api/v1/fines/monthly-report", params={"month": month})
    assert r.status_code == 200
    data = r.json()

    assert data["total_pending"] == 100.0
    assert data["total_paid"] == 200.0
    assert data["total_deducted"] == 300.0
    assert data["total_waived"] == 400.0
    # total_amount still excludes only "waived" — pending + paid + deducted.
    assert data["total_amount"] == 600.0
