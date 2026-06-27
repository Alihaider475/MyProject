"""Group A — auth for the n8n Payroll Risk Analysis Agent.

n8n execution endpoints require X-N8N-API-KEY. The frontend history endpoint reuses
the existing Supabase admin JWT dependency and must NOT accept the n8n key in its place.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db

TEST_KEY = "test-n8n-key"


def _build_app(db_session, *, bypass_jwt: bool):
    """Mount only the payroll_agent router (importing backend.main rewraps
    sys.stdout/stderr, which breaks pytest capture on Windows)."""
    from fastapi import FastAPI

    from backend.routes.payroll_agent import router as payroll_agent_router

    app = FastAPI()
    app.include_router(payroll_agent_router, prefix="/api/v1")

    async def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    if bypass_jwt:
        app.dependency_overrides[verify_supabase_token] = lambda: {"sub": "admin-user"}
    return app


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setattr(settings, "N8N_PAYROLL_AGENT_API_KEY", TEST_KEY)


@pytest.fixture
async def jwt_client(db_session):
    """History endpoint behaves as if a valid admin JWT is present."""
    app = _build_app(db_session, bypass_jwt=True)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def real_auth_client(db_session):
    """No JWT override — exercises the real Supabase dependency (401 without a token)."""
    app = _build_app(db_session, bypass_jwt=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── n8n execution endpoints require X-N8N-API-KEY ──────────────────────────────


async def test_risk_analysis_missing_key_401(jwt_client):
    r = await jwt_client.get("/api/v1/admin/payroll/agent/risk-analysis?month=2025-06")
    assert r.status_code == 401


async def test_risk_analysis_invalid_key_401(jwt_client):
    r = await jwt_client.get(
        "/api/v1/admin/payroll/agent/risk-analysis?month=2025-06",
        headers={"X-N8N-API-KEY": "wrong"},
    )
    assert r.status_code == 401


async def test_risk_analysis_log_missing_key_401(jwt_client):
    r = await jwt_client.post(
        "/api/v1/admin/payroll/agent/risk-analysis-log",
        json={"n8n_execution_id": "e1", "month": "2025-06", "status": "empty"},
    )
    assert r.status_code == 401


async def test_valid_key_passes_auth(jwt_client):
    """A valid key gets past auth (empty month → 200 with status 'empty')."""
    r = await jwt_client.get(
        "/api/v1/admin/payroll/agent/risk-analysis?month=2025-06",
        headers={"X-N8N-API-KEY": TEST_KEY},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "empty"


# ── History endpoint: admin JWT, NOT the n8n key ───────────────────────────────


async def test_history_valid_jwt_no_key_200(jwt_client):
    r = await jwt_client.get("/api/v1/admin/payroll/agent/risk-analysis-history?limit=1")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


async def test_history_no_auth_blocked(real_auth_client):
    r = await real_auth_client.get("/api/v1/admin/payroll/agent/risk-analysis-history")
    assert r.status_code in (401, 403)


async def test_history_key_without_jwt_blocked(real_auth_client):
    """The n8n key alone must not authenticate the frontend history endpoint."""
    r = await real_auth_client.get(
        "/api/v1/admin/payroll/agent/risk-analysis-history",
        headers={"X-N8N-API-KEY": TEST_KEY},
    )
    assert r.status_code in (401, 403)
