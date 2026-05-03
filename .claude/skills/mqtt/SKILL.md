---
name: mqtt
description: >
  Use this skill when working on anything related to MQTT alerts,
  MQTTHandler, broker connection, pub/sub messaging, violation payload
  publishing, paho-mqtt, QoS levels, topic structure, reconnection logic,
  or any code that publishes a message to an MQTT broker when a PPE
  violation occurs.
version: 1.0.0
project: Construction-PPE-Detection
module: app/alerts/mqtt_handler.py
triggers:
  - MQTTHandler
  - MQTT
  - mqtt alert
  - paho-mqtt
  - mqtt publish
  - broker
  - MQTT_BROKER
  - MQTT_PORT
  - MQTT_TOPIC
  - MQTT_USERNAME
  - MQTT_PASSWORD
  - QoS
  - pub/sub
  - violation payload
  - mqtt reconnect
  - mqtt client
---

# MQTT Alert Skill

This skill governs how Claude reads, writes, debugs, and extends the
MQTT alert handler of the PPE Detection System. The MQTT handler is
one of several **alert consumers** in the AlertDispatcher fan-out chain.
Its only job is to publish a structured JSON violation payload to an
MQTT broker topic when a ViolationEvent is dispatched — enabling
IoT dashboards, PLC controllers, and third-party systems to react
to PPE violations in real time.

---

## METADATA

| Field           | Value                                              |
|-----------------|----------------------------------------------------|
| Module path     | `app/alerts/mqtt_handler.py`                       |
| Base class      | `AlertHandler` in `app/alerts/base.py`             |
| Main class      | `MQTTHandler`                                      |
| Library         | `paho-mqtt` (run via `run_in_executor`)            |
| Activation      | Enabled only when `MQTT_BROKER` is set in `.env`   |
| Message format  | JSON payload published to `MQTT_TOPIC`             |
| Test location   | `tests/unit/test_mqtt_handler.py`                  |
| Registered in   | `AlertDispatcher` handler list                     |

### Key Config Variables

| Variable           | Purpose                                           |
|--------------------|---------------------------------------------------|
| `MQTT_BROKER`      | IP or hostname of the MQTT broker                 |
| `MQTT_PORT`        | Broker port (default: `1883`, TLS: `8883`)        |
| `MQTT_TOPIC`       | Topic to publish violations to                    |
| `MQTT_USERNAME`    | Broker username (optional)                        |
| `MQTT_PASSWORD`    | Broker password (optional)                        |
| `MQTT_QOS`         | Quality of Service level: `0`, `1`, or `2`        |
| `MQTT_KEEPALIVE`   | Seconds between keepalive pings (default: `60`)   |
| `MQTT_RETRY_COUNT` | Number of publish retry attempts on failure       |
| `MQTT_RETRY_DELAY` | Seconds between retry attempts                    |
| `MQTT_CLIENT_ID`   | Unique client ID string for broker identification |

### MQTT Topic Structure

| Topic Pattern                              | Purpose                        |
|--------------------------------------------|--------------------------------|
| `ppe/violations`                           | All violations (default)       |
| `ppe/violations/camera_{id}`              | Per-camera violations          |
| `ppe/violations/camera_{id}/{type}`       | Per-camera per-type violations |
| `ppe/status/camera_{id}`                  | Camera online/offline status   |

### Violation JSON Payload Schema

```json
{
  "camera_id": 1,
  "violation_type": "NO_HARDHAT",
  "confidence": 0.94,
  "timestamp": "2026-04-28T14:32:01Z",
  "frame_path": "camera_1/violation_2026-04-28_14-32-01_NO_HARDHAT.jpg",
  "severity": "HIGH"
}
```

### QoS Level Guide

| QoS | Guarantee              | Use Case                                |
|-----|------------------------|-----------------------------------------|
| 0   | Fire and forget        | High-frequency, loss-tolerant updates   |
| 1   | Delivered at least once| Safety alerts — use this for violations |
| 2   | Delivered exactly once | Critical commands to PLC                |

**Default for violation alerts: QoS 1**

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the
MQTT handler.

### Step 1 — Check Activation Gate First
Before writing or editing any MQTT logic, confirm that `MQTTHandler`
is only activated when `MQTT_BROKER` is set in config. If `MQTT_BROKER`
is an empty string, the handler registers as inactive and
`AlertDispatcher` skips it silently. Never attempt a broker connection
when credentials are not configured.

### Step 2 — Confirm Handler Isolation in AlertDispatcher
Verify that `MQTTHandler.send()` is wrapped in its own `try/except`
inside `AlertDispatcher`. A failed MQTT publish (broker offline, network
drop, authentication error) must never prevent `DatabaseHandler` or
`EmailHandler` from executing. MQTT failure is isolated — it logs
an error and returns.

### Step 3 — Run paho-mqtt in run_in_executor
The `paho-mqtt` library is synchronous. Every broker connection and
publish call must run inside `loop.run_in_executor(None, ...)`.
Never call `client.connect()`, `client.publish()`, or `client.disconnect()`
directly inside `async def` — they block the FastAPI event loop.

### Step 4 — Build JSON Payload Before Connecting
Construct and validate the full JSON payload from the `ViolationEvent`
before opening a broker connection. Never open a connection and then
discover payload data is missing or malformed. Build and serialize
the payload first, connect second.

### Step 5 — Connect, Publish, Disconnect Per Alert
Use a **connect → publish → disconnect** pattern for each violation
alert. Do not maintain a persistent background MQTT connection.
A persistent connection requires a background thread and reconnection
watchdog — the per-alert pattern is simpler, more reliable, and
sufficient for violation-rate publishing (not high-frequency telemetry).

### Step 6 — Set Client ID and Credentials Before Connect
Before calling `client.connect()`, always call:
- `client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)` if credentials
  are configured
- Assign a unique `MQTT_CLIENT_ID` to avoid broker session conflicts
  when multiple instances run simultaneously

### Step 7 — Use QoS 1 for Violation Alerts
All violation publishes must use `QoS=1` (at least once delivery) by
default. `QoS=0` risks silent message loss on unreliable networks.
`QoS=2` is reserved for PLC command topics where exact-once matters.
Read the QoS level from `MQTT_QOS` config — never hardcode it.

### Step 8 — Apply Retry Logic With Async Delay
If the publish fails, retry up to `MQTT_RETRY_COUNT` times with
`await asyncio.sleep(MQTT_RETRY_DELAY)` between attempts. After all
retries are exhausted, log the final error and return — never raise
to the caller. AlertDispatcher must not receive an exception from
this handler.

### Step 9 — Log Every Outcome
Log the result of every publish attempt:
- Success → `INFO` — include camera ID, violation type, topic, QoS
- Retry attempt → `WARNING` — include attempt number and error message
- Final failure → `ERROR` — include broker address and all attempts exhausted
- Skipped (no broker) → `DEBUG` — handler inactive

### Step 10 — Update or Write Tests After Every Change
After any change to MQTT logic, update or add tests in
`tests/unit/test_mqtt_handler.py`. Tests must cover:
- Handler is skipped when `MQTT_BROKER` is empty
- Correct JSON payload is built from ViolationEvent fields
- `paho-mqtt` calls run via `run_in_executor` not directly
- Retry logic fires on publish failure up to `MQTT_RETRY_COUNT`
- Broker disconnect is called after every publish attempt
- Exception from broker does not propagate to AlertDispatcher
- QoS level matches `MQTT_QOS` config value

---

## RULES

### MUST DO

- **MUST** check `MQTT_BROKER` is set before activating the handler —
  skip silently if broker address is not configured
- **MUST** run all `paho-mqtt` calls via `run_in_executor` —
  paho-mqtt is synchronous and must never touch the event loop
- **MUST** wrap the entire publish operation in `try/except` so
  exceptions never propagate to `AlertDispatcher`
- **MUST** build and serialize the JSON payload before opening
  broker connection
- **MUST** use `QoS=1` for violation alert publishes by default —
  read from `MQTT_QOS` config
- **MUST** set `client_id` from `MQTT_CLIENT_ID` config before connect —
  prevents broker session conflicts
- **MUST** call `client.username_pw_set()` before connect when
  `MQTT_USERNAME` is configured
- **MUST** disconnect from broker after every publish in a
  `finally` block — connect → publish → disconnect per alert
- **MUST** retry up to `MQTT_RETRY_COUNT` times using
  `await asyncio.sleep(MQTT_RETRY_DELAY)` between attempts
- **MUST** log every outcome — success, retry, failure, and skip
- **MUST** read all broker settings from config — never hardcode
  broker address, port, topic, or credentials

### MUST NOT

- **MUST NOT** call `client.connect()` or `client.publish()` directly
  inside `async def` without `run_in_executor` — blocks event loop
- **MUST NOT** maintain a persistent background MQTT connection —
  use connect → publish → disconnect per alert
- **MUST NOT** raise exceptions from `send()` to the caller —
  catch all, log, and return
- **MUST NOT** build the JSON payload after opening broker connection
- **MUST NOT** hardcode broker IP, port, topic, QoS, or credentials
  anywhere in the handler source file
- **MUST NOT** publish when `MQTT_BROKER` is empty or unset
- **MUST NOT** leave broker connections open after publish completes —
  always call `client.disconnect()` in a `finally` block
- **MUST NOT** use `time.sleep()` for retry delays —
  always use `await asyncio.sleep()` to keep the event loop free
- **MUST NOT** use `QoS=0` for violation alerts on unreliable networks —
  silent message loss defeats the purpose of safety alerting
- **MUST NOT** use the same `client_id` across multiple simultaneous
  instances — broker will disconnect the earlier session

### DECISION RULES

- **Per-alert connect over persistent connection**: Persistent MQTT
  connections require reconnection watchdogs and background threads —
  the per-alert pattern is simpler and sufficient for violation rates
- **QoS 1 over QoS 0 for safety**: In a safety system a missed alert
  is worse than a duplicate — always prefer at-least-once delivery
- **Isolation over propagation**: MQTT failures are contained inside
  the handler — they never cancel or delay email or database handlers
- **Async always**: Any replacement for paho-mqtt must support async
  natively or be wrapped in executor — synchronous MQTT is never acceptable
- **Config over code**: If a broker address, topic, or QoS level appears
  anywhere other than `.env` and `config.py` it must be moved there

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Calling `client.connect()` in `async def` without executor | Blocks entire FastAPI event loop during TCP handshake to broker |
| Persistent background MQTT connection without watchdog | Silent disconnections go undetected — violations are published into the void |
| Raising broker exception to AlertDispatcher | One MQTT failure cancels email and PLC alerts for the same violation |
| Building JSON payload after opening broker connection | Holds TCP connection open during data processing — wastes broker connection slots |
| Hardcoding `1883` port in source | Breaks on TLS brokers (port 8883) and custom broker configs |
| Using `time.sleep()` for retry delay | Blocks event loop for full retry duration — no API requests served during wait |
| Using QoS 0 for violation alerts | Message silently lost on network hiccup — safety alert never reaches IoT dashboard |
| Not setting client_id before connect | Two app instances share a session — broker boots the first when second connects |
| Not calling `client.disconnect()` in finally | TCP socket leaks — broker rejects new connections after max client limit reached |
| Publishing empty or partial JSON payload | IoT dashboard or PLC receives malformed message — downstream system errors |

---

*Place this file at `.claude/skills/mqtt/SKILL.md`
Claude reads it before touching any MQTT alert logic in the project.*
