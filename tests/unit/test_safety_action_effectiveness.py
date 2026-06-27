from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import (
    Camera,
    PayrollRiskAnalysisLog,
    SafetyActionEffectivenessLog,
    SafetyActionTask,
    Violation,
    Worker,
)

TEST_KEY = "test-n8n-key"
KEY_HEADER = {"X-N8N-API-KEY": TEST_KEY}


def _build_app(db_session, *, bypass_jwt: bool):
    from fastapi import FastAPI

    from backend.routes.safety_actions import router as safety_actions_router

    app = FastAPI()
    app.include_router(safety_actions_router, prefix="/api/v1")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    if bypass_jwt:
        app.dependency_overrides[verify_supabase_token] = lambda: {
            "sub": "admin-user",
            "email": "admin@example.com",
        }
    return app


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setattr(settings, "N8N_SAFETY_ACTION_AGENT_API_KEY", TEST_KEY)
    # Use 0-day window so tests can evaluate tasks completed moments ago
    monkeypatch.setattr(settings, "EFFECTIVENESS_REVIEW_WINDOW_DAYS", 0)


@pytest.fixture
async def client(db_session):
    app = _build_app(db_session, bypass_jwt=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def real_auth_client(db_session):
    app = _build_app(db_session, bypass_jwt=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _worker(db, employee_id="EMP-EFF-1", name="Eff Worker"):
    w = Worker(employee_id=employee_id, name=name, department="Block B")
    db.add(w)
    await db.flush()
    return w


async def _camera(db):
    c = Camera(name="Cam-Eff", source_type="webcam", source_uri="0")
    db.add(c)
    await db.flush()
    return c


async def _risk_log(db, month="2025-07", execution_id="exec-eff-1"):
    log = PayrollRiskAnalysisLog(
        n8n_execution_id=execution_id,
        month=month,
        status="success",
        total_workers_analyzed=1,
        high_risk_workers_count=1,
        recommendations_count=1,
    )
    db.add(log)
    await db.flush()
    return log


async def _completed_task(db, worker, log, risk_reason="Repeat offender: NO-Hardhat issue", completed_days_ago=14):
    completed_at = datetime.utcnow() - timedelta(days=completed_days_ago)
    task = SafetyActionTask(
        worker_id=worker.id,
        month=date(2025, 7, 1),
        risk_reason_hash=f"hash-eff-{worker.id}-{completed_days_ago}",
        risk_reason=risk_reason,
        action_title="Mandatory NO-Hardhat compliance re-training",
        priority="P2",
        status="completed",
        deadline_date=date.today(),
        created_from_log_id=log.id,
        completed_at=completed_at,
        completed_by_admin_id="admin@example.com",
    )
    db.add(task)
    await db.flush()
    return task


async def _violation(db, worker, camera, violation_type="NO-Hardhat", ts: datetime | None = None):
    v = Violation(
        camera_id=camera.id,
        violation_type=violation_type,
        confidence=0.9,
        timestamp=ts or datetime.utcnow(),
        worker_id=worker.id,
        is_false_positive=False,
    )
    db.add(v)
    await db.flush()
    return v


async def test_endpoint_rejects_missing_key(client, db_session):
    resp = await client.post("/api/v1/admin/safety-actions/agent/evaluate-effectiveness")
    assert resp.status_code == 401


async def test_endpoint_rejects_wrong_key(client, db_session):
    resp = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers={"X-N8N-API-KEY": "wrong-key"},
    )
    assert resp.status_code == 401


async def test_endpoint_accepts_correct_key(client, db_session):
    await db_session.commit()
    resp = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reviewed_count"] == 0
    assert data["skipped_duplicates"] == 0


async def test_pending_tasks_not_evaluated(client, db_session):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    task = SafetyActionTask(
        worker_id=worker.id,
        month=date(2025, 7, 1),
        risk_reason_hash="hash-pending",
        risk_reason="NO-Hardhat issues",
        action_title="Action",
        priority="P2",
        status="pending",
        deadline_date=date.today(),
        created_from_log_id=log.id,
    )
    db_session.add(task)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )
    assert resp.status_code == 200
    assert resp.json()["reviewed_count"] == 0


async def test_completed_task_is_evaluated(client, db_session):
    worker = await _worker(db_session)
    camera = await _camera(db_session)
    log = await _risk_log(db_session)
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)

    completed_at = task.completed_at
    # 5 violations before completion
    for i in range(5):
        await _violation(db_session, worker, camera, ts=completed_at - timedelta(days=i + 1))
    # 1 violation after completion
    await _violation(db_session, worker, camera, ts=completed_at + timedelta(hours=1))
    await db_session.commit()

    resp = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["reviewed_count"] == 1
    assert data["effective"] == 1


async def test_before_and_after_counts_correct(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-2", name="Count Worker")
    camera = await _camera(db_session)
    log = await _risk_log(db_session, execution_id="exec-eff-2")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)

    completed_at = task.completed_at
    # 3 before, 2 after
    for i in range(3):
        await _violation(db_session, worker, camera, ts=completed_at - timedelta(hours=i + 2))
    for i in range(2):
        await _violation(db_session, worker, camera, ts=completed_at + timedelta(hours=i + 1))
    await db_session.commit()

    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    log_row = (
        await db_session.execute(
            select(SafetyActionEffectivenessLog).where(
                SafetyActionEffectivenessLog.task_id == task.id
            )
        )
    ).scalar_one()
    assert log_row.before_count == 3
    assert log_row.after_count == 2


async def test_improvement_percentage_none_when_before_zero(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-3", name="Zero Worker")
    log = await _risk_log(db_session, execution_id="exec-eff-3")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)
    await db_session.commit()

    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    log_row = (
        await db_session.execute(
            select(SafetyActionEffectivenessLog).where(
                SafetyActionEffectivenessLog.task_id == task.id
            )
        )
    ).scalar_one()
    assert log_row.improvement_percentage is None
    assert log_row.status == "no_after_data"


async def test_status_partially_effective(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-4", name="Partial Worker")
    camera = await _camera(db_session)
    log = await _risk_log(db_session, execution_id="exec-eff-4")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)

    completed_at = task.completed_at
    # 10 before, 6 after — decreased but not by 50%
    for i in range(10):
        await _violation(db_session, worker, camera, ts=completed_at - timedelta(hours=i + 2))
    for i in range(6):
        await _violation(db_session, worker, camera, ts=completed_at + timedelta(hours=i + 1))
    await db_session.commit()

    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    log_row = (
        await db_session.execute(
            select(SafetyActionEffectivenessLog).where(
                SafetyActionEffectivenessLog.task_id == task.id
            )
        )
    ).scalar_one()
    assert log_row.status == "partially_effective"


async def test_status_not_effective(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-5", name="Worse Worker")
    camera = await _camera(db_session)
    log = await _risk_log(db_session, execution_id="exec-eff-5")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)

    completed_at = task.completed_at
    # 3 before, 5 after — got worse
    for i in range(3):
        await _violation(db_session, worker, camera, ts=completed_at - timedelta(hours=i + 2))
    for i in range(5):
        await _violation(db_session, worker, camera, ts=completed_at + timedelta(hours=i + 1))
    await db_session.commit()

    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    log_row = (
        await db_session.execute(
            select(SafetyActionEffectivenessLog).where(
                SafetyActionEffectivenessLog.task_id == task.id
            )
        )
    ).scalar_one()
    assert log_row.status == "not_effective"


async def test_duplicate_logs_not_created(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-6", name="Dedup Worker")
    log = await _risk_log(db_session, execution_id="exec-eff-6")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)
    await db_session.commit()

    first = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )
    assert first.json()["reviewed_count"] == 1
    assert first.json()["skipped_duplicates"] == 0

    second = await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )
    assert second.json()["reviewed_count"] == 0
    assert second.json()["skipped_duplicates"] == 1

    count = (
        await db_session.execute(
            select(SafetyActionEffectivenessLog).where(
                SafetyActionEffectivenessLog.task_id == task.id
            )
        )
    ).scalars().all()
    assert len(count) == 1


async def test_admin_get_effectiveness_requires_jwt(real_auth_client, db_session):
    resp = await real_auth_client.get(
        "/api/v1/admin/safety-actions/effectiveness",
        headers=KEY_HEADER,
    )
    assert resp.status_code in (401, 403)


async def test_admin_get_effectiveness_returns_logs(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-7", name="List Worker")
    log = await _risk_log(db_session, execution_id="exec-eff-7")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)
    await db_session.commit()

    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    resp = await client.get("/api/v1/admin/safety-actions/effectiveness")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["logs"]) == 1
    assert data["logs"][0]["task_id"] == task.id
    assert data["logs"][0]["worker_name"] == "List Worker"


async def test_list_safety_actions_includes_effectiveness(client, db_session):
    worker = await _worker(db_session, employee_id="EMP-EFF-8", name="Join Worker")
    log = await _risk_log(db_session, execution_id="exec-eff-8")
    task = await _completed_task(db_session, worker, log, completed_days_ago=14)
    await db_session.commit()

    # Before evaluation — effectiveness should be null
    resp_before = await client.get("/api/v1/admin/safety-actions")
    tasks_before = resp_before.json()["tasks"]
    assert any(t["id"] == task.id and t["effectiveness"] is None for t in tasks_before)

    # After evaluation — effectiveness should be populated
    await client.post(
        "/api/v1/admin/safety-actions/agent/evaluate-effectiveness",
        headers=KEY_HEADER,
    )

    resp_after = await client.get("/api/v1/admin/safety-actions")
    tasks_after = resp_after.json()["tasks"]
    matched = next(t for t in tasks_after if t["id"] == task.id)
    assert matched["effectiveness"] is not None
    assert matched["effectiveness"]["status"] in (
        "effective", "partially_effective", "not_effective", "no_after_data"
    )
