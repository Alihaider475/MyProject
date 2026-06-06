"""
Standalone MQTT connectivity test.
Usage:
    python test_mqtt.py
Reads broker settings from .env (same as the main app).
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from backend.core.config import settings

# ── helpers ──────────────────────────────────────────────────────────────────

def _print(label: str, msg: str) -> None:
    print(f"[{label}] {msg}")

def ok(msg: str)   -> None: _print("OK  ", msg)
def fail(msg: str) -> None: _print("FAIL", msg)
def info(msg: str) -> None: _print("INFO", msg)


# ── checks ───────────────────────────────────────────────────────────────────

def check_config() -> bool:
    info(f"MQTT_BROKER   = {settings.MQTT_BROKER!r}")
    info(f"MQTT_PORT     = {settings.MQTT_PORT}")
    info(f"MQTT_TOPIC    = {settings.MQTT_TOPIC!r}")
    info(f"MQTT_USERNAME = {settings.MQTT_USERNAME!r}")
    info(f"MQTT_QOS      = {settings.MQTT_QOS}")
    if not settings.MQTT_BROKER:
        fail("MQTT_BROKER is empty — set it in your .env file")
        return False
    ok("Config loaded")
    return True


def check_connect() -> mqtt.Client | None:
    info(f"Connecting to {settings.MQTT_BROKER}:{settings.MQTT_PORT} ...")
    client = mqtt.Client(client_id=settings.MQTT_CLIENT_ID or "ppe-test")
    if settings.MQTT_USERNAME:
        client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD)
    try:
        client.connect(
            settings.MQTT_BROKER,
            port=settings.MQTT_PORT,
            keepalive=settings.MQTT_KEEPALIVE,
        )
        ok(f"Connected to {settings.MQTT_BROKER}:{settings.MQTT_PORT}")
        return client
    except Exception as exc:
        fail(f"Connection failed: {exc}")
        return None


def check_publish(client: mqtt.Client) -> bool:
    topic = settings.MQTT_TOPIC
    payload = json.dumps({
        "camera_id": 0,
        "violation_type": "TEST",
        "confidence": 1.0,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "frame_path": None,
        "severity": "TEST",
    })
    info(f"Publishing test message to topic {topic!r} ...")
    try:
        result = client.publish(topic, payload=payload, qos=settings.MQTT_QOS)
        client.loop(timeout=2.0)
        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            ok(f"Message published (mid={result.mid})")
            return True
        fail(f"Publish returned rc={result.rc}")
        return False
    except Exception as exc:
        fail(f"Publish failed: {exc}")
        return False


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 50)
    print("  MQTT Connectivity Test")
    print("=" * 50)

    if not check_config():
        sys.exit(1)

    client = check_connect()
    if client is None:
        sys.exit(1)

    try:
        published = check_publish(client)
    finally:
        client.disconnect()
        info("Disconnected")

    print("=" * 50)
    if published:
        ok("All checks passed")
    else:
        fail("Publish step failed — broker connected but message not sent")
        sys.exit(1)


if __name__ == "__main__":
    main()
