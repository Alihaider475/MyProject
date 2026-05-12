# Alert Handler Testing Guide

This guide covers how to test each alert handler individually and all together.

## Quick Start

```bash
# Test everything at once (skips unconfigured handlers)
python test_all_handlers.py

# Test individual handlers
python test_email.py
python test_mqtt.py
```

---

## Prerequisites by Handler

### Email (`test_email.py`)

1. **Gmail App Password** (required — regular passwords won't work):
   - Go to https://myaccount.google.com/apppasswords
   - Generate a new app password for "Mail"
   - Copy the 16-character password

2. **Set in `.env`:**
   ```
   SENDER_EMAIL=you@gmail.com
   RECEIVER_EMAIL=you@gmail.com
   EMAIL_PASSWORD=abcd efgh ijkl mnop
   ```

3. **Run:**
   ```bash
   python test_email.py
   ```

4. **Expected output:**
   ```
   ==================================================
     Email Connectivity Test
   ==================================================
   [INFO] SENDER_EMAIL   = 'you@gmail.com'
   [INFO] RECEIVER_EMAIL = 'you@gmail.com'
   [INFO] SMTP_HOST      = 'smtp.gmail.com'
   [INFO] SMTP_PORT      = 587
   [INFO] RETRY_COUNT    = 3
   [OK  ] Config loaded
   [INFO] Connecting to smtp.gmail.com:587 ...
   [OK  ] Authenticated as you@gmail.com
   [INFO] Sending test email to you@gmail.com ...
   [OK  ] Test email sent - check your inbox
   ==================================================
   [OK  ] All checks passed
   ```

---

### MQTT (`test_mqtt.py`)

1. **Install a local broker** (e.g., Mosquitto):
   - Windows: `winget install EclipseFoundation.Mosquitto`
   - macOS: `brew install mosquitto`
   - Linux: `sudo apt install mosquitto`

2. **Start the broker:**
   ```bash
   mosquitto -v
   ```

3. **(Optional) Subscribe in another terminal to see messages:**
   ```bash
   mosquitto_sub -t "ppe/alerts/#" -v
   ```

4. **Set in `.env`:**
   ```
   MQTT_BROKER=localhost
   MQTT_PORT=1883
   ```

5. **Run:**
   ```bash
   python test_mqtt.py
   ```

6. **Expected output:**
   ```
   ==================================================
     MQTT Connectivity Test
   ==================================================
   [INFO] MQTT_BROKER   = 'localhost'
   [INFO] MQTT_PORT     = 1883
   [INFO] MQTT_TOPIC    = 'ppe/alerts'
   [OK  ] Config loaded
   [INFO] Connecting to localhost:1883 ...
   [OK  ] Connected to localhost:1883
   [INFO] Publishing test message to topic 'ppe/alerts' ...
   [OK  ] Message published (mid=1)
   [INFO] Disconnected
   ==================================================
   [OK  ] All checks passed
   ```

---

### Webhook

No standalone script — tested via `test_all_handlers.py`.

1. **Create a test endpoint** using https://webhook.site or run a local listener:
   ```bash
   # Simple Python listener on port 9999
   python -m http.server 9999
   ```

2. **Set in `.env`:**
   ```
   WEBHOOK_URL=https://webhook.site/your-unique-id
   ```

3. **Run:**
   ```bash
   python test_all_handlers.py
   ```

---

### PLC (Modbus TCP)

No standalone script — tested via `test_all_handlers.py`.

1. **Install a Modbus simulator** (e.g., ModRSsim2, or `pymodbus` built-in simulator):
   ```bash
   # pymodbus simulator (quick)
   pip install pymodbus
   pymodbus.simulator --modbus-server tcp --modbus-port 502
   ```

2. **Set in `.env`:**
   ```
   PLC_HOST=localhost
   PLC_PORT=502
   ```

3. **Run:**
   ```bash
   python test_all_handlers.py
   ```

> **Warning:** The PLC handler writes coil HIGH for `PLC_COIL_DURATION` seconds (default 5s), then resets to LOW. Only test with simulators or authorized hardware.

---

### Database & Fines

These handlers require a running database and are tested through the main app rather than standalone scripts. They will show as `SKIP` in `test_all_handlers.py`.

To test manually:
```bash
uvicorn backend.main:app --reload
# Then trigger a violation via a camera feed or the /api/v1/detect endpoint
```

---

## Common Errors

| Error | Handler | Fix |
|-------|---------|-----|
| `SMTPAuthenticationError` | Email | Use a Gmail App Password, not your regular password |
| `Connection refused` on port 587 | Email | Check firewall / antivirus blocking outbound SMTP |
| `Connection refused` on port 1883 | MQTT | Start Mosquitto: `mosquitto -v` |
| `EMAIL_PASSWORD is placeholder` | Email | Replace `your_app_password` in `.env` with real App Password |
| `MQTT_BROKER is empty` | MQTT | Set `MQTT_BROKER=localhost` in `.env` |
| `Connection refused` on port 502 | PLC | Start a Modbus simulator or check PLC network |
| `httpx.ConnectError` | Webhook | Check WEBHOOK_URL is reachable |
| `ModuleNotFoundError` | Any | Run `pip install -r requirements/base.txt` |

---

## `test_all_handlers.py` Output Example

```
============================================================
  Alert Handler Test Runner
============================================================

  [SKIP] DatabaseHandler: Requires running database - test via the app
  [SKIP] FineHandler: Requires DB + worker record - test via the app
  [SKIP] EmailHandler: EMAIL_PASSWORD is placeholder - set a real App Password
  [SKIP] WebhookHandler: WEBHOOK_URL not set
  [OK  ] MQTTHandler: Published to localhost:1883
  [SKIP] PLCHandler: PLC_HOST not set

============================================================
  Handler              Status   Detail
------------------------------------------------------------
  DatabaseHandler      SKIP     Requires running database - test via the app
  FineHandler          SKIP     Requires DB + worker record - test via the app
  EmailHandler         SKIP     EMAIL_PASSWORD is placeholder - set a real App Password
  WebhookHandler       SKIP     WEBHOOK_URL not set
  MQTTHandler          PASS     Published to localhost:1883
  PLCHandler           SKIP     PLC_HOST not set
============================================================
  Totals: 1 passed, 0 failed, 5 skipped
```
