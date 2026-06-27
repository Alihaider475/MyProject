"""Group B — risk analysis logic for the n8n Payroll Risk Analysis Agent.

Pure scoring functions are tested directly (no DB). The endpoint is exercised over the
SQLite test DB to confirm structure, baseline maths, repeat detection, department
grouping and recommendation priority — and that the dialect-agnostic month filtering
works under SQLite (the dialect trap that breaks fines.py::monthly_report under pytest).
"""
from __future__ import annotations

import itertools
from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from backend.auth.supabase_auth import verify_supabase_token
from backend.core.config import settings
from backend.database.connection import get_db
from backend.database.models import Camera, Fine, Violation, Worker
from backend.routes.payroll_agent import (
    compute_risk_score,
    department_level_for,
    priority_for,
    repeat_penalty,
    risk_level_for,
    trend_penalty,
)

TEST_KEY = "test-n8n-key"
_seq = itertools.count(1)


# ── Pure-function tests (no DB) ────────────────────────────────────────────────


def test_repeat_penalty_single_occurrence_is_zero():
    assert repeat_penalty(1) == 0


def test_repeat_penalty_three_occurrences():
    assert repeat_penalty(3) == max(0, 3 - 1) * 15 == 30


def test_zero_baseline_guard_no_trend_penalty():
    # No history in previous 3 months → never treated as a spike.
    assert trend_penalty(monthly_violations=10, total_fine_amount=5000, baseline_violations=0, baseline_fine=0) == 0


def test_trend_spike_applies_penalty():
    # baseline > 0 and current > 130% of baseline for both violations and fines.
    assert trend_penalty(monthly_violations=5, total_fine_amount=2000, baseline_violations=2, baseline_fine=1000) == 25


def test_weighted_score_matches_formula():
    # 3 violations, 1500 fine, repeat=3, baseline 1 violation / 500 fine.
    # 3*10 + 1500/300 + (3-1)*15 + (15 + 10) = 30 + 5 + 30 + 25 = 90.0
    assert compute_risk_score(3, 1500.0, 3, 1.0, 500.0) == 90.0


def test_risk_level_thresholds():
    assert risk_level_for(50) == "high"
    assert risk_level_for(49.99) == "medium"
    assert risk_level_for(25) == "medium"
    assert risk_level_for(24.99) == "normal"


def test_department_level_thresholds():
    assert department_level_for(100) == "high"
    assert department_level_for(50) == "medium"
    assert department_level_for(49.99) == "normal"


def test_priority_rules():
    assert priority_for("high", "normal") == "P1"
    assert priority_for("normal", "high") == "P1"  # dept high lifts worker to P1
    assert priority_for("medium", "normal") == "P2"
    assert priority_for("normal", "medium") == "P2"
    assert priority_for("normal", "normal") == "P3"


# ── Endpoint integration tests ─────────────────────────────────────────────────


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


async def _camera(db):
    cam = Camera(name="Cam", source_type="webcam", source_uri="0")
    db.add(cam)
    await db.flush()
    return cam


async def _worker(db, name, dept=None):
    n = next(_seq)
    w = Worker(employee_id=f"EMP-{n}", name=name, department=dept)
    db.add(w)
    await db.flush()
    return w


async def _add_fine(db, cam, worker, vtype, amount, month):
    n = next(_seq)
    v = Violation(camera_id=cam.id, violation_type=vtype, confidence=0.9, worker_id=worker.id)
    db.add(v)
    await db.flush()
    f = Fine(
        worker_id=worker.id,
        violation_id=v.id,
        fine_amount=amount,
        challan_number=f"CH-{n}",
        status="pending",
        deduction_month=month,  # explicit → effective month is deterministic
        fine_date=datetime(2025, 1, 1),
    )
    db.add(f)
    await db.flush()


async def _get(client, month):
    return await client.get(
        f"/api/v1/admin/payroll/agent/risk-analysis?month={month}",
        headers={"X-N8N-API-KEY": TEST_KEY},
    )


async def test_empty_month_clean_response(client):
    r = await _get(client, "2025-06")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "empty"
    assert data["total_workers_with_fines"] == 0
    assert data["high_risk_workers"] == []
    assert data["month_to_month_comparison"] is None


async def test_invalid_month_400(client):
    r = await _get(client, "2025-13")
    assert r.status_code == 400
    r = await _get(client, "June")
    assert r.status_code == 400


async def test_worker_fields_present_and_repeat_offender(client, db_session):
    cam = await _camera(db_session)
    w = await _worker(db_session, "Ali Haider", dept="Block A")
    # 3 NO-Hardhat violations in the selected month → repeat offender.
    for _ in range(3):
        await _add_fine(db_session, cam, w, "NO-Hardhat", 500.0, "2025-06")
    await db_session.commit()

    r = await _get(client, "2025-06")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "success"
    assert data["total_workers_with_fines"] == 1

    everyone = data["high_risk_workers"] + data["medium_risk_workers"]
    assert len(everyone) == 1
    wr = everyone[0]
    for field in (
        "worker_id", "worker_name", "employee_id", "department",
        "total_violations", "total_fine_amount", "most_common_violation_type",
        "max_same_violation_repeat_count", "previous_3_month_avg_violations",
        "previous_3_month_avg_fine_amount", "risk_score", "risk_level",
        "risk_reasons", "recommendations",
    ):
        assert field in wr
    assert wr["total_violations"] == 3
    assert wr["max_same_violation_repeat_count"] == 3
    assert wr["most_common_violation_type"] == "NO-Hardhat"
    assert any("Repeat offender" in reason for reason in wr["risk_reasons"])
    # 3*10 + 1500/300 + (3-1)*15 + 0 (no baseline) = 30 + 5 + 30 = 65.0 → high
    assert wr["risk_score"] == 65.0
    assert wr["risk_level"] == "high"


async def test_rolling_baseline_average(client, db_session):
    cam = await _camera(db_session)
    w = await _worker(db_session, "Sara", dept="Block B")
    # Prior 3 months: 3 violations in May, 0 in April, 0 in March → baseline avg = 1.0.
    for _ in range(3):
        await _add_fine(db_session, cam, w, "NO-Mask", 200.0, "2025-05")
    # Selected month June: 1 violation.
    await _add_fine(db_session, cam, w, "NO-Mask", 200.0, "2025-06")
    await db_session.commit()

    r = await _get(client, "2025-06")
    data = r.json()
    everyone = data["high_risk_workers"] + data["medium_risk_workers"]
    # Worker may be normal (not returned in lists) — fetch from comparison instead.
    assert data["month_to_month_comparison"]["baseline_avg_violations"] == 1.0


async def test_medium_classification_and_priority(client, db_session):
    cam = await _camera(db_session)
    w = await _worker(db_session, "Bilal", dept="Block C")
    # 3 distinct types, no baseline: 3*10 + 600/300 + 0 + 0 = 32 → medium.
    for vt in ("NO-Hardhat", "NO-Mask", "NO-Safety Vest"):
        await _add_fine(db_session, cam, w, vt, 200.0, "2025-06")
    await db_session.commit()

    r = await _get(client, "2025-06")
    data = r.json()
    assert len(data["medium_risk_workers"]) == 1
    wr = data["medium_risk_workers"][0]
    assert wr["risk_level"] == "medium"
    assert wr["max_same_violation_repeat_count"] == 1
    assert wr["recommendations"][0]["priority"] == "P2"


async def test_department_grouping(client, db_session):
    cam = await _camera(db_session)
    w1 = await _worker(db_session, "Worker1", dept="Block A")
    w2 = await _worker(db_session, "Worker2", dept="Block A")
    for _ in range(3):
        await _add_fine(db_session, cam, w1, "NO-Hardhat", 500.0, "2025-06")
    for _ in range(3):
        await _add_fine(db_session, cam, w2, "NO-Hardhat", 500.0, "2025-06")
    await db_session.commit()

    r = await _get(client, "2025-06")
    data = r.json()
    depts = {d["department"]: d for d in data["department_summary"]}
    assert "Block A" in depts
    assert depts["Block A"]["total_workers_involved"] == 2
    # Two high-risk workers (65 each) → dept score 130 → dept high.
    assert depts["Block A"]["risk_level"] == "high"
    assert depts["Block A"]["recommendation"]["priority"] == "P1"
