"""Group C (audit log idempotency), Group D (history), Group E (regression)."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import (
    Camera,
    Fine,
    PayrollRiskAnalysisLog,
    Violation,
    Worker,
)
from backend.schemas.fine import MonthlyReport

TEST_KEY = "test-n8n-key"


def _build_app(db_session):
    from fastapi import FastAPI

    from backend.routes.payroll_agent import router as payroll_agent_router

    app = FastAPI()
    app.include_router(payroll_agent_router, prefix="/api/v1")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[verify_supabase_token] = lambda: {"sub": "admin-user"}
    return app


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setattr(settings, "N8N_PAYROLL_AGENT_API_KEY", TEST_KEY)


@pytest.fixture
async def client(db_session):
    app = _build_app(db_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


_KEY_HEADER = {"X-N8N-API-KEY": TEST_KEY}


def _payload(execution_id, month="2025-06", status="success"):
    return {
        "n8n_execution_id": execution_id,
        "month": month,
        "status": status,
        "total_workers_analyzed": 2,
        "high_risk_workers_count": 1,
        "medium_risk_workers_count": 1,
        "total_violations": 5,
        "total_fine_amount": 2500.0,
        "trend": "worsened",
        "recommendations_count": 3,
        "response_snapshot_json": {"selected_month": month, "status": status},
        "backend_version": "1.0.0",
    }


# ── Group C — idempotency ──────────────────────────────────────────────────────


async def test_new_log_created_201(client):
    r = await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-1"),
        headers=_KEY_HEADER,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["already_exists"] is False
    assert data["n8n_execution_id"] == "exec-1"
    assert data["response_snapshot_json"]["status"] == "success"


async def test_same_month_same_exec_returns_existing_200(client):
    first = await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-dup"),
        headers=_KEY_HEADER,
    )
    assert first.status_code == 201
    second = await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-dup"),
        headers=_KEY_HEADER,
    )
    assert second.status_code == 200
    assert second.json()["already_exists"] is True
    assert second.json()["id"] == first.json()["id"]


async def test_same_month_different_exec_creates_new_201(client):
    await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-A"),
        headers=_KEY_HEADER,
    )
    r = await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-B"),
        headers=_KEY_HEADER,
    )
    assert r.status_code == 201
    assert r.json()["already_exists"] is False


async def test_failed_status_with_error_message(client):
    payload = _payload("exec-fail", status="failed")
    payload["error_message"] = "backend timeout"
    r = await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=payload,
        headers=_KEY_HEADER,
    )
    assert r.status_code == 201
    assert r.json()["status"] == "failed"
    assert r.json()["error_message"] == "backend timeout"


# ── Group D — history ──────────────────────────────────────────────────────────


async def _seed_log(db, month, exec_id, created_at):
    log = PayrollRiskAnalysisLog(
        n8n_execution_id=exec_id,
        month=month,
        status="success",
        recommendations_count=0,
        created_at=created_at,
    )
    db.add(log)
    await db.flush()


async def test_history_desc_order_and_limit(client, db_session):
    base = datetime(2025, 1, 1, 12, 0, 0)
    await _seed_log(db_session, "2025-03", "e3", base + timedelta(days=2))
    await _seed_log(db_session, "2025-01", "e1", base)
    await _seed_log(db_session, "2025-02", "e2", base + timedelta(days=1))
    await db_session.commit()

    r = await client.get("/api/v1/admin/payroll/agent/risk-analysis-history?limit=2")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2  # limit respected
    assert data[0]["month"] == "2025-03"  # most recent first
    assert data[1]["month"] == "2025-02"


async def test_history_limit_max_clamped(client):
    r = await client.get("/api/v1/admin/payroll/agent/risk-analysis-history?limit=999")
    assert r.status_code == 422  # ge/le validation rejects out-of-range


async def test_history_month_filter(client, db_session):
    base = datetime(2025, 1, 1, 12, 0, 0)
    await _seed_log(db_session, "2025-03", "m3", base + timedelta(days=2))
    await _seed_log(db_session, "2025-05", "m5", base + timedelta(days=4))
    await db_session.commit()

    # Filtering to a month returns only that month's log, not the latest global one.
    r = await client.get(
        "/api/v1/admin/payroll/agent/risk-analysis-history?month=2025-03&limit=1"
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["month"] == "2025-03"

    # A month with no log returns an empty list (not the latest global log).
    r = await client.get(
        "/api/v1/admin/payroll/agent/risk-analysis-history?month=2025-04&limit=1"
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_history_month_filter_bad_format_400(client):
    r = await client.get(
        "/api/v1/admin/payroll/agent/risk-analysis-history?month=2025-13"
    )
    assert r.status_code == 400


# ── Group E — regression ───────────────────────────────────────────────────────


def test_monthly_report_schema_unchanged():
    """The manual payroll report response shape must be untouched by this feature."""
    fields = set(MonthlyReport.model_fields.keys())
    assert fields == {
        "month",
        "total_amount",
        "workers",
        "pending_count",
        "total_pending",
        "total_paid",
        "total_deducted",
        "total_waived",
    }


async def test_agent_never_mutates_fine_status(client, db_session):
    """UC_16 amendment: the agent must never change a fine's status."""
    worker = Worker(employee_id="EMP-REG", name="Reg Worker", department="Block A")
    cam = Camera(name="Cam", source_type="webcam", source_uri="0")
    db_session.add_all([worker, cam])
    await db_session.flush()
    violation = Violation(
        camera_id=cam.id, violation_type="NO-Hardhat", confidence=0.9, worker_id=worker.id
    )
    db_session.add(violation)
    await db_session.flush()
    fine = Fine(
        worker_id=worker.id,
        violation_id=violation.id,
        fine_amount=500.0,
        challan_number="CH-REG-1",
        status="pending",
        deduction_month="2025-06",
    )
    db_session.add(fine)
    await db_session.commit()
    fine_id = fine.id

    # Run analysis + save a log.
    await client.get(
        "/api/v1/admin/payroll/agent/risk-analysis?month=2025-06", headers=_KEY_HEADER
    )
    await client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json=_payload("exec-reg"),
        headers=_KEY_HEADER,
    )

    refreshed = await db_session.get(Fine, fine_id)
    await db_session.refresh(refreshed)
    assert refreshed.status == "pending"
