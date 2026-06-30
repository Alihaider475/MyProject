from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from backend.alerts import safety_action_mqtt
from backend.alerts.base import AlertResult
from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import PayrollRiskAnalysisLog, SafetyActionTask, Worker

TEST_KEY = "test-n8n-key"
KEY_HEADER = {"X-N8N-API-KEY": TEST_KEY}


async def _drain_mqtt_tasks():
    """Await any fire-and-forget MQTT publish tasks spawned by the route."""
    pending = list(safety_action_mqtt._safety_mqtt_tasks)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


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


@pytest.fixture(autouse=True)
def _mock_mqtt(monkeypatch):
    """Replace the real MQTT publish call so existing tests never attempt a
    real broker connection from the new fire-and-forget call sites. Tests
    that care about MQTT behavior can still inspect/override this mock.
    """
    mock = AsyncMock(return_value=AlertResult.sent())
    monkeypatch.setattr("backend.alerts.safety_action_mqtt.publish_mqtt", mock)
    return mock


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


async def test_create_from_risk_analysis_publishes_mqtt_for_created_only(
    client, db_session, _mock_mqtt
):
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
    await _drain_mqtt_tasks()
    assert first.status_code == 201
    created_task_id = first.json()["task_ids"][0]

    assert _mock_mqtt.call_count == 1
    topics, mqtt_payload = _mock_mqtt.call_args.args
    assert topics == [safety_action_mqtt.TOPIC_CREATED]
    assert mqtt_payload["event_type"] == "safety_action_created"
    assert mqtt_payload["action_id"] == created_task_id
    assert mqtt_payload["worker_id"] == worker.id

    # Second call is an all-duplicate retry — must not publish again.
    second = await client.post(
        "/api/v1/admin/safety-actions/agent/create-from-risk-analysis",
        json=payload,
        headers=KEY_HEADER,
    )
    await _drain_mqtt_tasks()
    assert second.status_code == 201
    assert second.json()["created"] == 0
    assert _mock_mqtt.call_count == 1


async def test_complete_safety_action_publishes_mqtt_event(client, db_session, _mock_mqtt):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    task = await _task(db_session, worker, log, priority="P2", status="escalated")
    await db_session.commit()

    response = await client.patch(
        f"/api/v1/admin/safety-actions/{task.id}/complete",
        json={"completion_notes": "Worker completed remedial training."},
    )
    await _drain_mqtt_tasks()
    assert response.status_code == 200

    assert _mock_mqtt.call_count == 1
    topics, mqtt_payload = _mock_mqtt.call_args.args
    assert topics == [safety_action_mqtt.TOPIC_COMPLETED]
    completed_at = mqtt_payload.pop("completed_at")
    assert isinstance(completed_at, str) and completed_at
    assert mqtt_payload == {
        "event_type": "safety_action_completed",
        "action_id": task.id,
        "worker_id": worker.id,
        "worker_name": worker.name,
        "action_type": task.action_title,
        "completed_by": "admin@example.com",
    }


async def test_complete_safety_action_succeeds_when_mqtt_broker_down(
    client, db_session, _mock_mqtt
):
    worker = await _worker(db_session)
    log = await _risk_log(db_session)
    task = await _task(db_session, worker, log, priority="P2", status="pending")
    await db_session.commit()

    _mock_mqtt.side_effect = RuntimeError("broker unreachable")

    response = await client.patch(
        f"/api/v1/admin/safety-actions/{task.id}/complete",
        json={"completion_notes": "demo"},
    )
    await _drain_mqtt_tasks()

    assert response.status_code == 200
    assert response.json()["status"] == "completed"

    db_task = await db_session.get(SafetyActionTask, task.id)
    assert db_task.status == "completed"
    assert db_task.completion_notes == "demo"
