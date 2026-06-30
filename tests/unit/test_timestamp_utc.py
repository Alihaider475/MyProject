"""Regression guard for the timestamp timezone fix.

Root cause (fixed): naive DateTime columns used ``server_default=func.now()``.
On Postgres with a non-UTC session timezone that stored LOCAL wall-clock time,
while the whole app assumes naive timestamps are UTC (the frontend appends 'Z'
before parsing). The fix replaced every naive default with the Python-side
``_utcnow`` helper so values are always UTC regardless of host/DB timezone.

These tests fail if someone reverts a column back to ``server_default=func.now()``
(which leaves ``Column.default is None``) or breaks ``_utcnow``. NOTE: the test DB
is SQLite, whose ``func.now()`` returns UTC — so observing inserted values cannot
catch the regression. We assert on the model definition instead.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from backend.database.models import (
    AlertLog,
    Camera,
    Fine,
    Violation,
    Worker,
    _utcnow,
)

# Critical naive-DateTime columns that must use the Python UTC default.
# (table_class, column_name)
UTC_DEFAULT_COLUMNS = [
    (Violation, "timestamp"),
    (AlertLog, "sent_at"),
    (Fine, "created_at"),
    (Worker, "created_at"),
    (Camera, "created_at"),
]


def test_utcnow_returns_naive_utc():
    """_utcnow() must be timezone-naive and equal to current UTC (not local)."""
    value = _utcnow()
    assert value.tzinfo is None, "stored timestamps must be naive (no offset)"
    delta = abs((value - datetime.now(timezone.utc).replace(tzinfo=None)).total_seconds())
    assert delta < 5, f"_utcnow drifted from real UTC by {delta:.1f}s"


@pytest.mark.parametrize("model, column", UTC_DEFAULT_COLUMNS)
def test_column_uses_python_utc_default(model, column):
    """Each critical column must carry a Python-side default of _utcnow.

    Guards against a revert to server_default=func.now(), which would leave
    Column.default is None and reintroduce the host-timezone bug.
    """
    col = model.__table__.c[column]
    assert col.default is not None, (
        f"{model.__name__}.{column} has no Python default — likely reverted to "
        f"server_default=func.now(), which stores host-local time on Postgres"
    )
    assert col.default.is_callable, f"{model.__name__}.{column} default must be callable"
    # Identity (`is _utcnow`) is avoided: the module can resolve to a second
    # instance under pytest, giving a distinct function object. Assert by name +
    # behaviour, which still catches a revert (default None) or a non-UTC callable.
    assert col.default.arg.__name__ == "_utcnow", (
        f"{model.__name__}.{column} must default to _utcnow (got {col.default.arg!r})"
    )
    produced = col.default.arg.__wrapped__() if hasattr(col.default.arg, "__wrapped__") else col.default.arg()
    assert produced.tzinfo is None
    delta = abs((produced - datetime.now(timezone.utc).replace(tzinfo=None)).total_seconds())
    assert delta < 5, f"{model.__name__}.{column} default is not UTC (off by {delta:.1f}s)"


async def test_orm_insert_stores_utc(db_session):
    """End-to-end: inserting via the ORM populates a naive UTC timestamp."""
    camera = Camera(name="tz-test", source_type="webcam", source_uri="0")
    db_session.add(camera)
    await db_session.flush()

    violation = Violation(camera_id=camera.id, violation_type="NO-Hardhat", confidence=0.9)
    db_session.add(violation)
    await db_session.commit()
    await db_session.refresh(violation)

    assert violation.timestamp.tzinfo is None
    delta = abs(
        (violation.timestamp - datetime.now(timezone.utc).replace(tzinfo=None)).total_seconds()
    )
    assert delta < 60, f"inserted timestamp off from UTC by {delta:.1f}s"
