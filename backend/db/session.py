from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.core.config import settings
import backend.auth.models as _auth_models  # noqa: F401 — registers User with Base.metadata

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "dev",
    future=True,
    connect_args={"statement_cache_size": 0},
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    pool_recycle=1800,
    pool_pre_ping=True,
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
    from backend.db.models import Base
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent migrations — add columns that weren't in the original schema.
        # Uses IF NOT EXISTS to avoid aborting the PostgreSQL transaction.
        _migrations = [
            "ALTER TABLE violations ADD COLUMN IF NOT EXISTS is_false_positive BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS detection_confidence REAL NOT NULL DEFAULT 0.5",
            "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS roi_polygon TEXT",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_id VARCHAR(255)",
            "ALTER TABLE users DROP COLUMN IF EXISTS password_hash",
            "ALTER TABLE violations ADD COLUMN IF NOT EXISTS worker_id INTEGER REFERENCES workers(id)",
            "ALTER TABLE violations ADD COLUMN IF NOT EXISTS fine_amount DOUBLE PRECISION",
            "ALTER TABLE fines ADD COLUMN IF NOT EXISTS waive_reason TEXT",
        ]
        for stmt in _migrations:
            await conn.execute(text(stmt))

        # Seed default fine configs (idempotent — ON CONFLICT DO NOTHING)
        _fine_seeds = [
            {"vtype": "NO-Hardhat",     "amount": settings.DEFAULT_HARDHAT_FINE, "curr": settings.FINES_CURRENCY},
            {"vtype": "NO-Mask",        "amount": settings.DEFAULT_MASK_FINE,    "curr": settings.FINES_CURRENCY},
            {"vtype": "NO-Safety Vest", "amount": settings.DEFAULT_VEST_FINE,    "curr": settings.FINES_CURRENCY},
        ]
        for seed in _fine_seeds:
            await conn.execute(
                text(
                    "INSERT INTO fine_configs (violation_type, fine_amount, currency, is_active) "
                    "VALUES (:vtype, :amount, :curr, true) "
                    "ON CONFLICT (violation_type) DO NOTHING"
                ),
                seed,
            )
