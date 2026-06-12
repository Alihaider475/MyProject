from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.logging import get_logger

logger = get_logger(__name__)

# Whitelist of runtime-persistable settings: DB key -> Settings attribute.
# Only safe boolean toggles belong here — never SMTP passwords, tokens,
# webhook secrets, or connection strings.
PERSISTABLE_SETTINGS: dict[str, str] = {
    "email_alerts_enabled": "EMAIL_ALERTS_ENABLED",
    "mqtt_enabled": "MQTT_ENABLED",
    "webhook_enabled": "WEBHOOK_ENABLED",
}

_TRUE_VALUES = {"true", "1", "yes", "on"}


def _parse_bool(raw: str) -> bool:
    return raw.strip().lower() in _TRUE_VALUES


async def load_runtime_settings(session: AsyncSession | None = None) -> None:
    """Apply persisted overrides from system_settings onto the settings singleton.

    Called once at startup after init_db(). Any failure is logged and swallowed
    so the backend always starts with .env defaults intact.
    """
    try:
        if session is None:
            from backend.database.connection import AsyncSessionLocal

            async with AsyncSessionLocal() as own_session:
                rows = (
                    await own_session.execute(text("SELECT key, value FROM system_settings"))
                ).fetchall()
        else:
            rows = (
                await session.execute(text("SELECT key, value FROM system_settings"))
            ).fetchall()

        for key, value in rows:
            attr = PERSISTABLE_SETTINGS.get(key)
            if attr is None:
                logger.warning("Ignoring unknown persisted setting %r", key)
                continue
            parsed = _parse_bool(value)
            setattr(settings, attr, parsed)
            logger.info("Runtime setting override applied: %s=%s", attr, parsed)
    except Exception as exc:
        logger.error("Failed to load runtime settings — using .env defaults: %s", exc)


async def save_runtime_setting(key: str, value: bool, session: AsyncSession) -> None:
    """Upsert a runtime toggle into system_settings.

    Raises ValueError for keys outside the whitelist. The caller is responsible
    for also mutating the in-memory settings singleton so a persistence failure
    never blocks alert dispatch.
    """
    if key not in PERSISTABLE_SETTINGS:
        raise ValueError(f"Setting {key!r} is not a persistable runtime setting")

    # ON CONFLICT works on both SQLite (>=3.24) and PostgreSQL — same pattern
    # as the fine-config seeds in backend/database/connection.py.
    await session.execute(
        text(
            "INSERT INTO system_settings (key, value, value_type) "
            "VALUES (:key, :value, 'bool') "
            "ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = CURRENT_TIMESTAMP"
        ),
        {"key": key, "value": "true" if value else "false"},
    )
    await session.commit()
