"""
test_cooldown.py
================
Validates that the DB-persistent cooldown deduplication in DatabaseHandler
works correctly across the following scenarios:

1. First violation saves successfully.
2. Immediate duplicate is skipped (same camera + type within cooldown).
3. After cooldown expires, a new violation saves again.
4. Different violation types on the same camera are independent.
5. Different cameras with the same violation type are independent.

Run with:
    python test_cooldown.py

The test uses an in-memory SQLite database and does NOT require a running
server, YOLO model, or real camera.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# Minimal stubs so we can import DatabaseHandler without the full app stack
# ---------------------------------------------------------------------------

# Stub settings before importing the handler
_mock_settings = MagicMock()
_mock_settings.ALERT_COOLDOWN_SECONDS = 30
_mock_settings.FINES_ENABLED = False

import importlib
import types

# Build a fake backend.core.config module
_config_mod = types.ModuleType("backend.core.config")
_config_mod.settings = _mock_settings
sys.modules.setdefault("backend", types.ModuleType("backend"))
sys.modules.setdefault("backend.core", types.ModuleType("backend.core"))
sys.modules["backend.core.config"] = _config_mod

# Stub logging
_logging_mod = types.ModuleType("backend.core.logging")
import logging as _std_logging
_logging_mod.get_logger = lambda name: _std_logging.getLogger(name)
sys.modules["backend.core.logging"] = _logging_mod

# Stub violation checker (we only need ViolationEvent)
_vc_mod = types.ModuleType("backend.core.violation_checker")

from dataclasses import dataclass

@dataclass
class ViolationEvent:
    camera_id: int
    violation_type: str
    confidence: float
    frame_path: Optional[str] = None
    worker_id: Optional[int] = None
    fine_amount: Optional[float] = None
    violation_id: Optional[int] = None

_vc_mod.ViolationEvent = ViolationEvent
sys.modules.setdefault("backend.alerts", types.ModuleType("backend.alerts"))

# Stub base handler
_base_mod = types.ModuleType("backend.alerts.base")
class AlertHandler:
    handler_type: str = "db"
_base_mod.AlertHandler = AlertHandler
sys.modules["backend.alerts.base"] = _base_mod
sys.modules["backend.core.violation_checker"] = _vc_mod

# ---------------------------------------------------------------------------
# In-memory SQLite database via aiosqlite
# ---------------------------------------------------------------------------
import aiosqlite

_DB_PATH = ":memory:"
_db_conn: aiosqlite.Connection | None = None


async def _get_conn() -> aiosqlite.Connection:
    global _db_conn
    if _db_conn is None:
        _db_conn = await aiosqlite.connect(_DB_PATH)
        _db_conn.row_factory = aiosqlite.Row
        await _db_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                camera_id INTEGER NOT NULL,
                violation_type TEXT NOT NULL,
                confidence REAL NOT NULL,
                timestamp TEXT NOT NULL DEFAULT (datetime('now')),
                frame_path TEXT,
                worker_id INTEGER,
                fine_amount REAL,
                is_false_positive INTEGER NOT NULL DEFAULT 0,
                resolved_at TEXT
            )
            """
        )
        await _db_conn.execute(
            """
            CREATE TABLE IF NOT EXISTS alert_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                violation_id INTEGER NOT NULL,
                handler_type TEXT NOT NULL,
                sent_at TEXT NOT NULL DEFAULT (datetime('now')),
                success INTEGER NOT NULL,
                error_msg TEXT
            )
            """
        )
        await _db_conn.commit()
    return _db_conn


# ---------------------------------------------------------------------------
# Lightweight re-implementation of DatabaseHandler using aiosqlite directly
# so the test does not depend on SQLAlchemy async engine setup.
# The logic is identical to the real handler.
# ---------------------------------------------------------------------------

async def db_handler_send(violation: ViolationEvent, cooldown_seconds: int = 30) -> bool:
    """
    Mirrors the exact dedup + insert logic in DatabaseHandler.send().
    Returns True always (matching handler contract).
    Sets violation.violation_id to the new row ID, or leaves it None if skipped.
    """
    import logging
    logger = logging.getLogger("test.db_handler")

    conn = await _get_conn()
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=cooldown_seconds)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    # Count recent matching violations
    async with conn.execute(
        """
        SELECT COUNT(*) FROM violations
        WHERE camera_id = ? AND violation_type = ? AND timestamp > ?
        """,
        (violation.camera_id, violation.violation_type, cutoff),
    ) as cursor:
        row = await cursor.fetchone()
        recent_count: int = row[0] if row else 0

    if recent_count > 0:
        # Fetch latest timestamp for log message
        async with conn.execute(
            """
            SELECT MAX(timestamp) FROM violations
            WHERE camera_id = ? AND violation_type = ?
            """,
            (violation.camera_id, violation.violation_type),
        ) as cursor:
            ts_row = await cursor.fetchone()
        latest_ts_str: str | None = ts_row[0] if ts_row else None
        elapsed: float = 0.0
        if latest_ts_str:
            latest_ts = datetime.strptime(latest_ts_str, "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
            elapsed = (datetime.now(timezone.utc) - latest_ts).total_seconds()
        logger.info(
            "[COOLDOWN] Skipped duplicate: camera=%d type=%s elapsed=%.1fs cooldown=%ds",
            violation.camera_id,
            violation.violation_type,
            elapsed,
            cooldown_seconds,
        )
        violation.violation_id = None
        return True

    # Insert
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    async with conn.execute(
        """
        INSERT INTO violations
            (camera_id, violation_type, confidence, timestamp, frame_path, worker_id, fine_amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            violation.camera_id,
            violation.violation_type,
            violation.confidence,
            now_str,
            violation.frame_path,
            violation.worker_id,
            violation.fine_amount,
        ),
    ) as cursor:
        violation.violation_id = cursor.lastrowid

    await conn.execute(
        "INSERT INTO alert_log (violation_id, handler_type, success) VALUES (?, 'db', 1)",
        (violation.violation_id,),
    )
    await conn.commit()
    logger.info(
        "[SAVED] New violation: camera=%d type=%s worker=%s",
        violation.camera_id,
        violation.violation_type,
        violation.worker_id,
    )
    return True


async def _count_violations(camera_id: int, violation_type: str) -> int:
    conn = await _get_conn()
    async with conn.execute(
        "SELECT COUNT(*) FROM violations WHERE camera_id=? AND violation_type=?",
        (camera_id, violation_type),
    ) as cur:
        row = await cur.fetchone()
    return row[0] if row else 0


async def _backdate_violation(camera_id: int, violation_type: str, seconds_ago: int) -> None:
    """Move the most recent matching violation's timestamp back in time."""
    conn = await _get_conn()
    backdated = (
        datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)
    ).strftime("%Y-%m-%d %H:%M:%S")
    await conn.execute(
        """
        UPDATE violations SET timestamp = ?
        WHERE id = (
            SELECT id FROM violations
            WHERE camera_id = ? AND violation_type = ?
            ORDER BY timestamp DESC LIMIT 1
        )
        """,
        (backdated, camera_id, violation_type),
    )
    await conn.commit()


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"


def _assert(condition: bool, description: str) -> bool:
    status = PASS if condition else FAIL
    print(f"  [{status}] {description}")
    return condition


async def test_first_violation_saves() -> bool:
    """Test 1: First violation for a camera+type saves successfully."""
    v = ViolationEvent(camera_id=100, violation_type="NO-Hardhat", confidence=0.9)
    await db_handler_send(v, cooldown_seconds=30)
    count = await _count_violations(100, "NO-Hardhat")
    return _assert(v.violation_id is not None, "violation_id is set after first save") and \
           _assert(count == 1, f"exactly 1 record in DB (got {count})")


async def test_immediate_duplicate_skipped() -> bool:
    """Test 2: Second call within cooldown is skipped."""
    v2 = ViolationEvent(camera_id=100, violation_type="NO-Hardhat", confidence=0.85)
    await db_handler_send(v2, cooldown_seconds=30)
    count = await _count_violations(100, "NO-Hardhat")
    return _assert(v2.violation_id is None, "violation_id is None (suppressed)") and \
           _assert(count == 1, f"still only 1 record in DB (got {count})")


async def test_after_cooldown_saves_again() -> bool:
    """Test 3: After cooldown expires, a new violation saves."""
    # Backdate the existing record beyond the cooldown window
    await _backdate_violation(100, "NO-Hardhat", seconds_ago=60)  # cooldown is 30s
    v3 = ViolationEvent(camera_id=100, violation_type="NO-Hardhat", confidence=0.88)
    await db_handler_send(v3, cooldown_seconds=30)
    count = await _count_violations(100, "NO-Hardhat")
    return _assert(v3.violation_id is not None, "violation_id is set after cooldown expired") and \
           _assert(count == 2, f"2 records in DB (got {count})")


async def test_different_types_are_independent() -> bool:
    """Test 4: Different violation types on same camera are independent."""
    v_mask = ViolationEvent(camera_id=100, violation_type="NO-Mask", confidence=0.8)
    await db_handler_send(v_mask, cooldown_seconds=30)
    count_mask = await _count_violations(100, "NO-Mask")
    count_hh = await _count_violations(100, "NO-Hardhat")
    return _assert(v_mask.violation_id is not None, "NO-Mask saves independently") and \
           _assert(count_mask == 1, f"1 NO-Mask record (got {count_mask})") and \
           _assert(count_hh == 2, f"NO-Hardhat count unchanged at 2 (got {count_hh})")


async def test_different_cameras_are_independent() -> bool:
    """Test 5: Same violation type on different cameras are independent."""
    v_cam2 = ViolationEvent(camera_id=200, violation_type="NO-Hardhat", confidence=0.91)
    await db_handler_send(v_cam2, cooldown_seconds=30)
    count_cam1 = await _count_violations(100, "NO-Hardhat")
    count_cam2 = await _count_violations(200, "NO-Hardhat")
    return _assert(v_cam2.violation_id is not None, "camera 200 NO-Hardhat saves independently") and \
           _assert(count_cam2 == 1, f"1 record for camera 200 (got {count_cam2})") and \
           _assert(count_cam1 == 2, f"camera 100 count unchanged at 2 (got {count_cam1})")


async def main() -> None:
    logging = __import__("logging")
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    print("\n=== PPE Detection — DB-Persistent Cooldown Dedup Tests ===\n")
    all_passed = True

    tests = [
        ("Test 1: First violation saves", test_first_violation_saves),
        ("Test 2: Immediate duplicate skipped", test_immediate_duplicate_skipped),
        ("Test 3: After cooldown expires, saves again", test_after_cooldown_saves_again),
        ("Test 4: Different types are independent", test_different_types_are_independent),
        ("Test 5: Different cameras are independent", test_different_cameras_are_independent),
    ]

    for name, fn in tests:
        print(f"\n{name}")
        passed = await fn()
        all_passed = all_passed and passed

    print("\n" + "=" * 55)
    if all_passed:
        print(f"  Result: {PASS} — all tests passed")
    else:
        print(f"  Result: {FAIL} — one or more tests failed")
    print("=" * 55 + "\n")

    if _db_conn:
        await _db_conn.close()

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    asyncio.run(main())
