from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from app.alerts.base import AlertHandler
from app.core.config import settings
from app.core.logging import get_logger
from app.core.violation_checker import ViolationEvent

logger = get_logger(__name__)


class MQTTHandler(AlertHandler):
    handler_type = "mqtt"

    async def send(self, violation: ViolationEvent) -> bool:
        if not settings.MQTT_BROKER:
            logger.debug("MQTT handler inactive — MQTT_BROKER not configured")
            return False

        base_topic = settings.MQTT_TOPIC
        cam_topic = f"{base_topic}/camera_{violation.camera_id}"
        normalized_type = violation.violation_type.replace("-", "_").replace(" ", "_")
        type_topic = f"{base_topic}/{normalized_type}"
        topics = [base_topic, cam_topic, type_topic]

        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload = json.dumps({
            "camera_id": violation.camera_id,
            "violation_type": violation.violation_type,
            "confidence": round(violation.confidence, 4),
            "timestamp": ts,
            "frame_path": violation.frame_path,
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
                return True
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
        return False
