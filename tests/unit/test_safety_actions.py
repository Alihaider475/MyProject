from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import PayrollRiskAnalysisLog, SafetyActionTask, Worker

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


async def _worker(db, employee_id="EMP-SA-1", name="Safety Worker"):
    w = Worker(employee_id=employee_id, name=name, department="Block A")
    db.add(w)
    await db.flush()
    return w


async def _risk_log(db, month="2025-07", execution_id="exec-sa-1"):
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


async def _task(db, worker, log, *, priority="P2", status="pending", deadline=None):
    n = datetime.utcnow().timestamp()
    task = SafetyActionTask(
        worker_id=worker.id,
        month=date(2025, 7, 1),
        risk_reason_hash=f"hash-{worker.id}-{priority}-{status}-{n}",
        risk_reason=f"{priority} {status} reason",
        action_title="Safety follow-up",
        priority=priority,
        status=status,
        deadline_date=deadline or date.today(),
        created_from_log_id=log.id,
        escalated_at=datetime.utcnow() if status == "escalated" else None,
        completed_at=datetime.utcnow() if status == "completed" else None,
        completed_by_admin_id="admin-old" if status == "completed" else None,
    )
    db.add(task)
    await db.flush()
    return task


async def test_create_from_risk_analysis_is_deduplicated(client, db_session):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    await db_session.commit()

    payload = {
        "log_id": log.id,
        "month": "2025-07",
        "high_risk_workers": [
            {
                "worker_id": worker.id,
                "risk_reason": "Missed 3 consecutive safety trainings",
                "suggested_priority": "P2",
            }
        ],
    }

    first = await client.post(
        "/api/v1/admin/safety-actions/agent/create-from-risk-analysis",
        json=payload,
        headers=KEY_HEADER,
    )
    assert first.status_code == 201
    assert first.json()["created"] == 1
    assert first.json()["skipped_duplicates"] == 0

    retry_payload = {
        **payload,
        "high_risk_workers": [
            {
                "worker_id": worker.id,
                "risk_reason": "  missed 3 consecutive safety trainings  ",
                "suggested_priority": "P1",
            }
        ],
    }
    second = await client.post(
        "/api/v1/admin/safety-actions/agent/create-from-risk-analysis",
        json=retry_payload,
        headers=KEY_HEADER,
    )
    assert second.status_code == 201
    assert second.json()["created"] == 0
    assert second.json()["skipped_duplicates"] == 1

    total = (
        await db_session.execute(select(func.count()).select_from(SafetyActionTask))
    ).scalar_one()
    assert total == 1
    task = (await db_session.execute(select(SafetyActionTask))).scalar_one()
    assert task.month == date(2025, 7, 1)
    assert task.priority == "P2"


async def test_escalate_overdue_guards_and_is_idempotent(client, db_session):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    overdue = date.today() - timedelta(days=1)
    future = date.today() + timedelta(days=1)

    p3 = await _task(db_session, worker, log, priority="P3", deadline=overdue)
    p1 = await _task(db_session, worker, log, priority="P1", deadline=overdue)
    completed = await _task(db_session, worker, log, priority="P2", status="completed", deadline=overdue)
    already_escalated = await _task(db_session, worker, log, priority="P2", status="escalated", deadline=overdue)
    future_pending = await _task(db_session, worker, log, priority="P2", deadline=future)
    await db_session.commit()

    first = await client.post(
        "/api/v1/admin/safety-actions/agent/escalate-overdue",
        headers=KEY_HEADER,
    )
    assert first.status_code == 200
    assert first.json() == {"escalated_count": 2}

    await db_session.refresh(p3)
    await db_session.refresh(p1)
    await db_session.refresh(completed)
    await db_session.refresh(already_escalated)
    await db_session.refresh(future_pending)

    assert p3.status == "escalated"
    assert p3.priority == "P2"
    assert p3.escalated_at is not None
    assert p1.status == "escalated"
    assert p1.priority == "P1"
    assert completed.status == "completed"
    assert completed.priority == "P2"
    assert already_escalated.status == "escalated"
    assert already_escalated.priority == "P2"
    assert future_pending.status == "pending"

    second = await client.post(
        "/api/v1/admin/safety-actions/agent/escalate-overdue",
        headers=KEY_HEADER,
    )
    assert second.status_code == 200
    assert second.json() == {"escalated_count": 0}


async def test_admin_can_complete_task_once(client, db_session):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    task = await _task(db_session, worker, log, priority="P2", status="escalated")
    await db_session.commit()

    response = await client.patch(
        f"/api/v1/admin/safety-actions/{task.id}/complete",
        json={"completion_notes": "Worker completed remedial training."},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert data["completed_by_admin_id"] == "admin@example.com"
    assert data["completion_notes"] == "Worker completed remedial training."

    repeat = await client.patch(
        f"/api/v1/admin/safety-actions/{task.id}/complete",
        json={"completion_notes": "repeat"},
    )
    assert repeat.status_code == 409


async def test_auth_isolation_between_agent_and_admin_routes(client, real_auth_client, db_session):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    task = await _task(db_session, worker, log)
    await db_session.commit()

    create_payload = {
        "log_id": log.id,
        "month": "2025-07",
        "high_risk_workers": [
            {"worker_id": worker.id, "risk_reason": "repeat violations", "suggested_priority": "P1"}
        ],
    }

    agent_without_key = await client.post(
        "/api/v1/admin/safety-actions/agent/create-from-risk-analysis",
        json=create_payload,
    )
    assert agent_without_key.status_code == 401

    list_with_key_only = await real_auth_client.get(
        "/api/v1/admin/safety-actions",
        headers=KEY_HEADER,
    )
    assert list_with_key_only.status_code in (401, 403)

    complete_with_key_only = await real_auth_client.patch(
        f"/api/v1/admin/safety-actions/{task.id}/complete",
        json={},
        headers=KEY_HEADER,
    )
    assert complete_with_key_only.status_code in (401, 403)
