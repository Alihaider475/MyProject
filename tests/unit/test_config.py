from __future__ import annotations

import os

import pytest

from backend.core.config import Settings


def test_defaults():
    s = Settings()
    assert s.APP_ENV == "dev"
    assert s.DETECTION_CONFIDENCE == 0.5
    assert s.ALERT_COOLDOWN_SECONDS == 10
    assert s.MODEL_PATH == "models/ppe.pt"


def test_env_override(monkeypatch):
    monkeypatch.setenv("APP_ENV", "prod")
    monkeypatch.setenv("DETECTION_CONFIDENCE", "0.7")
    monkeypatch.setenv("ALERT_COOLDOWN_SECONDS", "30")
    s = Settings()
    assert s.APP_ENV == "prod"
    assert s.DETECTION_CONFIDENCE == pytest.approx(0.7)
    assert s.ALERT_COOLDOWN_SECONDS == 30


def test_database_url_default():
    s = Settings()
    assert "sqlite" in s.DATABASE_URL
