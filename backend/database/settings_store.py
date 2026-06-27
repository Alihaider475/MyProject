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

# Alert channel connection config: DB key -> (Settings attr, value type)
ALERT_CONFIG_FIELDS: dict[str, tuple[str, str]] = {
    "smtp_host":           ("SMTP_HOST",      "str"),
    "smtp_port":           ("SMTP_PORT",       "int"),
    "smtp_sender_email":   ("SENDER_EMAIL",    "str"),
    "smtp_receiver_email": ("RECEIVER_EMAIL",  "str"),
    "smtp_password":       ("EMAIL_PASSWORD",  "str"),
    "smtp_use_tls":        ("SMTP_USE_TLS",    "bool"),
    "mqtt_broker":         ("MQTT_BROKER",     "str"),
    "mqtt_port":           ("MQTT_PORT",       "int"),
    "mqtt_topic":          ("MQTT_TOPIC",      "str"),
    "mqtt_username":       ("MQTT_USERNAME",   "str"),
    "mqtt_password":       ("MQTT_PASSWORD",   "str"),
    "webhook_url":         ("WEBHOOK_URL",     "str"),
}

SECRET_ALERT_KEYS: frozenset[str] = frozenset({"smtp_password", "mqtt_password"})

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


async def load_alert_config(session: AsyncSession | None = None) -> None:
    """Load alert channel connection config from DB and apply to settings singleton.

    Called once at startup after load_runtime_settings(). Failures are logged
    and swallowed so the backend always starts with .env defaults.
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
            entry = ALERT_CONFIG_FIELDS.get(key)
            if entry is None:
                continue
            attr, vtype = entry
            if vtype == "bool":
                setattr(settings, attr, _parse_bool(value))
            elif vtype == "int":
                try:
                    setattr(settings, attr, int(value))
                except ValueError:
                    logger.warning("Invalid int for alert config key %r: %r", key, value)
            else:
                setattr(settings, attr, value)
            logger.info(
                "Alert config applied: %s",
                attr if key not in SECRET_ALERT_KEYS else f"{attr}=***",
            )
    except Exception as exc:
        logger.error("Failed to load alert config — using .env defaults: %s", exc)


async def save_alert_config_fields(fields: dict[str, str], session: AsyncSession) -> None:
    """Upsert alert config key-value pairs into system_settings.

    Accepts keys from both ALERT_CONFIG_FIELDS and PERSISTABLE_SETTINGS.
    Raises ValueError for any unknown key. Callers must update the in-memory
    settings singleton themselves before calling this so that a DB failure
    never blocks alert dispatch.
    """
    allowed = set(ALERT_CONFIG_FIELDS) | set(PERSISTABLE_SETTINGS)
    for key in fields:
        if key not in allowed:
            raise ValueError(f"Unknown config key: {key!r}")
    for key, value in fields.items():
        await session.execute(
            text(
                "INSERT INTO system_settings (key, value, value_type) "
                "VALUES (:key, :value, 'str') "
                "ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = CURRENT_TIMESTAMP"
            ),
            {"key": key, "value": value},
        )
    await session.commit()


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
