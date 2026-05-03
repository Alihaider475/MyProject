from __future__ import annotations

import asyncio

from pymodbus.client import ModbusTcpClient

from app.alerts.base import AlertHandler
from app.core.config import settings
from app.core.logging import get_logger
from app.core.violation_checker import ViolationEvent

logger = get_logger(__name__)


class PLCHandler(AlertHandler):
    handler_type = "plc"

    async def send(self, violation: ViolationEvent) -> bool:
        if not settings.PLC_HOST:
            logger.debug("PLC handler inactive — PLC_HOST not configured")
            return False

        coil_addr = settings.PLC_COIL_ADDRESS
        loop = asyncio.get_running_loop()

        client = ModbusTcpClient(
            host=settings.PLC_HOST,
            port=settings.PLC_PORT,
            timeout=settings.PLC_TIMEOUT,
        )

        # --- Phase 1: Connect (with retry) ---
        connected = False
        last_exc: Exception | None = None
        for attempt in range(1, settings.PLC_RETRY_COUNT + 1):
            try:
                def _connect() -> None:
                    if not client.connect():
                        raise ConnectionError(
                            f"Cannot connect to PLC at {settings.PLC_HOST}:{settings.PLC_PORT}"
                        )
                await loop.run_in_executor(None, _connect)
                connected = True
                break
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "PLC connect failed (attempt %d/%d): %s",
                    attempt, settings.PLC_RETRY_COUNT, exc,
                )
                if attempt < settings.PLC_RETRY_COUNT:
                    await asyncio.sleep(settings.PLC_RETRY_DELAY)

        if not connected:
            logger.error(
                "PLC alert failed after %d attempts for camera %d (host=%s): %s",
                settings.PLC_RETRY_COUNT, violation.camera_id, settings.PLC_HOST, last_exc,
            )
            return False

        # --- Phase 2: Write HIGH, wait, write LOW (LOW is mandatory via finally) ---
        high_ok = False
        try:
            def _write_high() -> None:
                result = client.write_coil(coil_addr, True, slave=settings.PLC_UNIT_ID)
                if result.isError():
                    raise RuntimeError(f"write_coil HIGH error: {result}")

            await loop.run_in_executor(None, _write_high)
            high_ok = True
            logger.info(
                "PLC coil HIGH — coil=%d host=%s camera=%d type=%s duration=%.1fs",
                coil_addr, settings.PLC_HOST, violation.camera_id,
                violation.violation_type, settings.PLC_COIL_DURATION,
            )
            await asyncio.sleep(settings.PLC_COIL_DURATION)

        except Exception as exc:
            logger.error("PLC coil HIGH failed: %s", exc)

        finally:
            # LOW write is mandatory — a stuck coil is a physical safety hazard
            def _write_low_and_close() -> None:
                try:
                    result = client.write_coil(coil_addr, False, slave=settings.PLC_UNIT_ID)
                    if result.isError():
                        logger.critical(
                            "PLC coil %d LOW FAILED — siren may be stuck ON. "
                            "Manual reset required. Error: %s",
                            coil_addr, result,
                        )
                    else:
                        logger.info(
                            "PLC coil LOW — coil=%d reset after %.1fs",
                            coil_addr, settings.PLC_COIL_DURATION,
                        )
                finally:
                    client.close()

            await loop.run_in_executor(None, _write_low_and_close)

        return high_ok
