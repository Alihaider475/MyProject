from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.core.config import settings
from backend.core.logging import get_logger
import backend.auth.models as _auth_models  # noqa: F401 — registers User with Base.metadata

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Determine dialect from the configured DATABASE_URL
# ---------------------------------------------------------------------------
_IS_SQLITE = settings.DATABASE_URL.startswith("sqlite")
_IS_POSTGRES = settings.DATABASE_URL.startswith("postgresql") or settings.DATABASE_URL.startswith("postgres")

# Log the database type at startup (never log credentials)
if _IS_POSTGRES:
    # Extract host portion only for the log message
    _safe_url = settings.DATABASE_URL.split("@")[-1] if "@" in settings.DATABASE_URL else "<configured>"
    logger.info("Using database: postgresql (host=%s)", _safe_url)
elif _IS_SQLITE:
    logger.info("Using database: sqlite (%s)", settings.DATABASE_URL.split("///")[-1])
else:
    logger.warning("Using database: unknown dialect — DATABASE_URL=%s", settings.DATABASE_URL[:20])

# ---------------------------------------------------------------------------
# Engine — dialect-specific configuration
# ---------------------------------------------------------------------------
if _IS_SQLITE:
    # SQLite / aiosqlite:
    #  • Does NOT support connection-pool arguments (pool_size, max_overflow, …)
    #    — aiosqlite uses a single-connection StaticPool by default.
    #  • check_same_thread=False is required for async usage.
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.APP_ENV == "dev",
        future=True,
        connect_args={"check_same_thread": False},
    )
else:
    # PostgreSQL / asyncpg — full production pool configuration.
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.APP_ENV == "dev",
        future=True,
        # asyncpg uses its own prepared-statement cache; statement_cache_size=0
        # disables it, which is required when using PgBouncer in transaction mode.
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
    from backend.database.models import Base
    from sqlalchemy import text

    async with engine.begin() as conn:
        # Create all tables that do not yet exist (idempotent).
        await conn.run_sync(Base.metadata.create_all)

        if _IS_POSTGRES:
            # ------------------------------------------------------------------
            # PostgreSQL-only idempotent schema migrations.
            # These use syntax (IF NOT EXISTS / IF EXISTS on ALTER/DROP) that is
            # supported by PostgreSQL but NOT by SQLite.  SQLite relies purely on
            # create_all above for schema management.
            # ------------------------------------------------------------------
            _pg_migrations = [
                "ALTER TABLE violations ADD COLUMN IF NOT EXISTS is_false_positive BOOLEAN NOT NULL DEFAULT false",
                "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS detection_confidence REAL NOT NULL DEFAULT 0.5",
                "ALTER TABLE cameras ADD COLUMN IF NOT EXISTS roi_polygon TEXT",
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_id VARCHAR(255)",
                "ALTER TABLE users DROP COLUMN IF EXISTS password_hash",
                "ALTER TABLE violations ADD COLUMN IF NOT EXISTS worker_id INTEGER REFERENCES workers(id)",
                "ALTER TABLE violations ADD COLUMN IF NOT EXISTS fine_amount DOUBLE PRECISION",
                "ALTER TABLE fines ADD COLUMN IF NOT EXISTS waive_reason TEXT",
                "ALTER TABLE violations ADD COLUMN IF NOT EXISTS track_id INTEGER",
                "ALTER TABLE violations ADD COLUMN IF NOT EXISTS person_bbox TEXT",
                "ALTER TABLE fine_configs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now()",
                # Performance indexes
                "CREATE INDEX IF NOT EXISTS ix_violations_ts_cam_type ON violations (timestamp, camera_id, violation_type)",
                "CREATE INDEX IF NOT EXISTS ix_violations_resolved_at ON violations (resolved_at)",
                "CREATE INDEX IF NOT EXISTS ix_violations_track_id ON violations (track_id)",
                "CREATE INDEX IF NOT EXISTS ix_fines_deduction_month ON fines (deduction_month)",
                "CREATE INDEX IF NOT EXISTS ix_fines_status ON fines (status)",
            ]
            for stmt in _pg_migrations:
                await conn.execute(text(stmt))
        else:
            # SQLite — create the same performance indexes that PostgreSQL
            # gets from the migration block above.
            _sqlite_indexes = [
                "CREATE INDEX IF NOT EXISTS ix_violations_ts_cam_type ON violations (timestamp, camera_id, violation_type)",
                "CREATE INDEX IF NOT EXISTS ix_violations_status ON violations (resolved_at)",
                "CREATE INDEX IF NOT EXISTS ix_violations_track_id ON violations (track_id)",
                "CREATE INDEX IF NOT EXISTS ix_fines_deduction_month ON fines (deduction_month)",
                "CREATE INDEX IF NOT EXISTS ix_fines_status ON fines (status)",
            ]
            for stmt in _sqlite_indexes:
                await conn.execute(text(stmt))

            # SQLite cannot add a column with a non-constant default and has no
            # "IF NOT EXISTS" for columns — inspect the table first.
            cols = (await conn.execute(text("PRAGMA table_info(fine_configs)"))).fetchall()
            if "created_at" not in {c[1] for c in cols}:
                await conn.execute(text("ALTER TABLE fine_configs ADD COLUMN created_at TIMESTAMP"))

        # Seed default fine configs — uses standard SQL ON CONFLICT that works
        # on both SQLite (≥3.24) and PostgreSQL.
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
