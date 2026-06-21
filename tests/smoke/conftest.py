"""Fixtures for the backend QA smoke suite.

Unlike tests/conftest.py (ASGITransport + in-memory SQLite + mocked auth),
these tests hit a REAL running backend over the network and exercise the
REAL configured database (Supabase PostgreSQL per backend/core/config.py),
so the suite can confirm the live deployment actually works end to end.

SAFESITE_JWT is loaded from the environment, or from tests/smoke/.env if
present (gitignored — never commit a real token). The token value itself
is never printed by this suite.
"""
from __future__ import annotations

import os
import pathlib

import httpx
import pytest
from dotenv import load_dotenv

_SMOKE_DIR = pathlib.Path(__file__).parent
load_dotenv(_SMOKE_DIR / ".env", override=False)

BASE_URL = os.environ.get("SAFESITE_BASE_URL", "http://localhost:8000").rstrip("/")
API_PREFIX = os.environ.get("SAFESITE_API_PREFIX", "/api/v1")
JWT = os.environ.get("SAFESITE_JWT", "")
TEST_IMAGE = os.environ.get("SAFESITE_TEST_IMAGE", "")
RUN_UPLOAD_TESTS = os.environ.get("SAFESITE_RUN_UPLOAD_TESTS", "false").lower() == "true"
RUN_WRITE_TESTS = os.environ.get("SAFESITE_RUN_WRITE_TESTS", "true").lower() == "true"

HAS_JWT = bool(JWT)

requires_jwt = pytest.mark.skipif(not HAS_JWT, reason="Token missing or role not allowed (SAFESITE_JWT not set)")
requires_write = pytest.mark.skipif(not RUN_WRITE_TESTS, reason="SAFESITE_RUN_WRITE_TESTS=false")


def report(method: str, path: str, resp: httpx.Response, summary: str = "") -> None:
    result = "PASS" if resp.status_code < 400 else "FAIL"
    print(
        f"\nEndpoint  : {method} {path}\n"
        f"Method    : {method}\n"
        f"Status    : {resp.status_code}\n"
        f"Result    : {result}\n"
        f"Summary   : {summary}\n"
    )


@pytest.fixture
async def client():
    headers = {"Authorization": f"Bearer {JWT}"} if JWT else {}
    async with httpx.AsyncClient(base_url=BASE_URL + API_PREFIX, headers=headers, timeout=30.0) as c:
        yield c
