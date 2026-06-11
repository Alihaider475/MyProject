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
        # Idempotent migrations — add columns/indexes that weren't in the original schema.
        # The catalog is checked first because ALTER TABLE takes an ACCESS EXCLUSIVE lock
        # even when the column already exists; running it unconditionally on every boot
        # deadlocks against concurrent readers and gets killed by Supabase's
        # statement_timeout. In the steady state no DDL runs at all.
        _column_migrations = [
            ("violations", "is_false_positive",
             "ALTER TABLE violations ADD COLUMN IF NOT EXISTS is_false_positive BOOLEAN NOT NULL DEFAULT false"),
            ("cameras", "detection_confidence",
             "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS detection_confidence REAL NOT NULL DEFAULT 0.5"),
            ("cameras", "roi_polygon",
             "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS roi_polygon TEXT"),
            ("users", "supabase_id",
             "ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_id VARCHAR(255)"),
            ("violations", "worker_id",
             "ALTER TABLE violations ADD COLUMN IF NOT EXISTS worker_id INTEGER REFERENCES workers(id)"),
            ("violations", "fine_amount",
             "ALTER TABLE violations ADD COLUMN IF NOT EXISTS fine_amount DOUBLE PRECISION"),
            ("fines", "waive_reason",
             "ALTER TABLE fines ADD COLUMN IF NOT EXISTS waive_reason TEXT"),
            ("violations", "track_id",
             "ALTER TABLE violations ADD COLUMN IF NOT EXISTS track_id INTEGER"),
            ("violations", "person_bbox",
             "ALTER TABLE violations ADD COLUMN IF NOT EXISTS person_bbox TEXT"),
        ]
        _index_migrations = [
            ("ix_violations_ts_cam_type",
             "CREATE INDEX IF NOT EXISTS ix_violations_ts_cam_type ON violations (timestamp, camera_id, violation_type)"),
            ("ix_fines_deduction_month",
             "CREATE INDEX IF NOT EXISTS ix_fines_deduction_month ON fines (deduction_month)"),
            ("ix_fines_status",
             "CREATE INDEX IF NOT EXISTS ix_fines_status ON fines (status)"),
        ]

        existing_columns = {
            (row.table_name, row.column_name)
            for row in await conn.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = 'public'"
                )
            )
        }
        existing_indexes = {
            row.indexname
            for row in await conn.execute(
                text("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")
            )
        }

        pending = [
            ddl for table, column, ddl in _column_migrations
            if (table, column) not in existing_columns
        ]
        if ("users", "password_hash") in existing_columns:
            pending.append("ALTER TABLE users DROP COLUMN IF EXISTS password_hash")
        pending.extend(ddl for name, ddl in _index_migrations if name not in existing_indexes)

        if pending:
            # Fail fast with a clear error if another session holds a conflicting
            # lock, instead of hanging until statement_timeout kills us.
            await conn.execute(text("SET LOCAL lock_timeout = '5s'"))
            for stmt in pending:
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
