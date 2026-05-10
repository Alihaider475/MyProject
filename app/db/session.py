from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
import app.auth.models as _auth_models  # noqa: F401 — registers User with Base.metadata

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "dev",
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    from app.db.models import Base
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migrations — add columns that weren't in the original schema.
        # Each statement is tried independently; errors (column exists) are suppressed.
        _migrations = [
            "ALTER TABLE violations ADD COLUMN is_false_positive BOOLEAN NOT NULL DEFAULT 0",
            "ALTER TABLE cameras ADD COLUMN detection_confidence REAL NOT NULL DEFAULT 0.5",
            "ALTER TABLE cameras ADD COLUMN roi_polygon TEXT",
        ]
        for stmt in _migrations:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # column already exists — safe to ignore
