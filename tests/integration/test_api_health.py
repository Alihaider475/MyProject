from __future__ import annotations

import pytest


async def test_health_ok(test_client):
    r = await test_client.get("/api/v1/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "model_loaded" in data
    assert "cameras_active" in data


async def test_metrics_ok(test_client):
    r = await test_client.get("/api/v1/metrics")
    assert r.status_code == 200
    assert "cameras" in r.json()
