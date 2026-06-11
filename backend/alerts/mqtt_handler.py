from __future__ import annotations

import asyncio
import json

import paho.mqtt.client as mqtt

from backend.alerts.base import AlertHandler, AlertResult, build_alert_payload
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationEvent

logger = get_logger(__name__)


class MQTTHandler(AlertHandler):
    handler_type = "mqtt"

    async def send(self, violation: ViolationEvent) -> AlertResult:
        if not settings.MQTT_BROKER:
            logger.debug("MQTT alert skipped — MQTT_BROKER not configured")
            return AlertResult.skipped("MQTT_BROKER not configured")

        base_topic = settings.MQTT_TOPIC
        cam_topic = f"{base_topic}/camera_{violation.camera_id}"
        _TYPE_TOPIC_SLUG: dict[str, str] = {
            "NO-Safety Vest": "NO_VEST",
        }
        normalized_type = _TYPE_TOPIC_SLUG.get(
            violation.violation_type,
            violation.violation_type.replace("-", "_").replace(" ", "_").upper(),
        )
        type_topic = f"{base_topic}/{normalized_type}"
        topics = [base_topic, cam_topic, type_topic]

        payload = json.dumps({
            **build_alert_payload(violation),
            "severity": "HIGH",
        })

        def _publish() -> None:
            client = mqtt.Client(client_id=settings.MQTT_CLIENT_ID)
            if settings.MQTT_USERNAME:
                client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)
            try:
                client.connect(
                    settings.MQTT_BROKER,
                    port=settings.MQTT_PORT,
                    keepalive=settings.MQTT_KEEPALIVE,
                )
                for t in topics:
                    client.publish(t, payload=payload, qos=settings.MQTT_QOS, retain=False)
                client.loop(timeout=2.0)
            finally:
                client.disconnect()

        loop = asyncio.get_running_loop()
        last_exc: Exception | None = None
        for attempt in range(1, settings.MQTT_RETRY_COUNT + 1):
            try:
                await loop.run_in_executor(None, _publish)
                logger.info(
                    "MQTT alert published: camera=%d type=%s topics=%s qos=%d",
                    violation.camera_id,
                    violation.violation_type,
                    topics,
                    settings.MQTT_QOS,
                )
                return AlertResult.sent()
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "MQTT publish failed (attempt %d/%d): %s",
                    attempt,
                    settings.MQTT_RETRY_COUNT,
                    exc,
                )
                if attempt < settings.MQTT_RETRY_COUNT:
                    await asyncio.sleep(settings.MQTT_RETRY_DELAY)

        logger.error(
            "MQTT alert failed after %d attempts for camera %d (broker=%s): %s",
            settings.MQTT_RETRY_COUNT,
            violation.camera_id,
            settings.MQTT_BROKER,
            last_exc,
        )
        return AlertResult.failed(
            f"failed after {settings.MQTT_RETRY_COUNT} attempts: {last_exc}"
        )
