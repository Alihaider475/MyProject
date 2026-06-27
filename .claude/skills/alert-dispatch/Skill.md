---

name: alert-dispatch-system
description: Use this skill when verifying, implementing, or fixing SafeSite AI alert dispatch through SMTP Email, MQTT, and Webhook after PPE violations or fine/challan generation.
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Alert Dispatch System Skill

## Purpose

Use this skill to verify and complete the SafeSite AI alert dispatch pipeline:

PPE violation detected → violation saved → worker identified if possible → fine/challan generated if applicable → alert dispatched through enabled channels.

Supported alert channels:

* SMTP Email
* MQTT Broker
* Webhook Endpoint

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `backend/alerts`
   * `backend/alerts/dispatcher.py`
   * `backend/alerts/email.py`
   * `backend/alerts/mqtt.py`
   * `backend/alerts/webhook.py`
   * `backend/alerts/fine_handler.py`
   * `backend/core/config.py`
   * `backend/camera/manager.py`
   * `backend/detection/fine_calculator.py`
   * `backend/database/models.py`
   * `backend/routes/settings.py`

2. If file names are different, search the repository for:

   * alert
   * dispatcher
   * email
   * smtp
   * mqtt
   * webhook
   * notification
   * AlertDispatcher

3. Explain the current alert implementation.

4. Identify what already works and what is missing.

5. Check whether alerts are dispatched after:

   * violation creation
   * fine/challan creation

6. Check whether missing SMTP/MQTT/Webhook configuration is handled safely.

7. Check whether alert failures can break violation logging or fine generation.

8. Create a file-by-file implementation plan.

9. Wait for user approval before editing.

## Implementation rules

* Do not rewrite the whole project.
* Do not modify unrelated frontend, Docker, auth, requirements, or database files unless absolutely required.
* Preserve the current backend structure:

  * `backend/alerts`
  * `backend/routes`
  * `backend/database`
  * `backend/detection`
  * `backend/core`
  * `backend/schemas`
* Preserve existing API route paths and response formats.
* Preserve JWT/auth protection.
* Use `.env` / `settings` values only.
* Do not hardcode email credentials, broker URLs, webhook URLs, tokens, or secrets.
* Alert failure must not stop:

  * violation logging
  * worker assignment
  * fine/challan generation
  * payroll report generation
* If an alert channel is disabled or config is missing, skip safely and log the reason.
* Do not run `git commit` unless the user explicitly approves.

## Expected behavior

When a violation or fine/challan is created, the system should dispatch alerts through enabled channels.

Alert payload should include as many of these fields as available:

* `violation_id`
* `violation_type`
* `camera_id`
* `worker_id`
* `worker_name`
* `employee_id`
* `confidence`
* `timestamp`
* `fine_id`
* `fine_amount`
* `currency`
* `challan_number`
* `status`

## Email alert requirements

Email alerts should:

1. Use SMTP settings from `backend/core/config.py`.
2. Skip safely if SMTP is disabled or required values are missing.
3. Include violation/fine details in a readable message.
4. Log:

   * email sent
   * email skipped
   * email failed
5. Never expose SMTP password in logs.

## MQTT alert requirements

MQTT alerts should:

1. Use MQTT settings from `backend/core/config.py`.
2. Skip safely if MQTT is disabled or broker URL/topic is missing.
3. Publish JSON payload to configured topic.
4. Log:

   * MQTT published
   * MQTT skipped
   * MQTT failed
5. Avoid reused or unsafe client IDs if applicable.

## Webhook alert requirements

Webhook alerts should:

1. Use webhook URL from settings.
2. Skip safely if webhook URL is missing.
3. Send JSON payload with violation/fine details.
4. Use reasonable timeout.
5. Log:

   * webhook sent
   * webhook skipped
   * webhook failed
6. Webhook failure must not break the main detection pipeline.

## Logging requirements

Add clear logs for:

* alert dispatch started
* email sent/skipped/failed
* MQTT sent/skipped/failed
* webhook sent/skipped/failed
* alert dispatch completed
* alert dispatch partially failed

Use appropriate log levels:

* `info` for successful sent/skipped summary
* `warning` for failed channel
* `debug` for noisy repeated skipped cases

## Verification commands

After coding, run compile checks on changed alert-related files, for example:

```powershell
python -m py_compile backend/alerts/dispatcher.py
python -m py_compile backend/alerts/email.py
python -m py_compile backend/alerts/mqtt.py
python -m py_compile backend/alerts/webhook.py
python -m py_compile backend/alerts/fine_handler.py
python -m py_compile backend/core/config.py
python -m py_compile backend/camera/manager.py
```

If some files do not exist, compile the actual files that were changed.

Run OpenAPI check:

```powershell
python check_openapi.py
```

If `check_openapi.py` does not exist, create it temporarily:

```python
from backend.main import app
import traceback

print("Generating OpenAPI...")

try:
    app.openapi()
    print("OpenAPI OK")
except Exception:
    traceback.print_exc()
```

Then run backend:

```powershell
python -m uvicorn backend.main:app --reload
```

Verify:

* `http://127.0.0.1:8000/openapi.json` returns JSON
* `http://127.0.0.1:8000/docs` loads successfully

## Manual verification

After implementation, manually test:

1. Disable all alert configs.
2. Trigger a violation.
3. Confirm violation is saved and alerts are skipped safely.
4. Enable webhook with a test endpoint.
5. Trigger a violation and confirm webhook receives JSON payload.
6. Enable SMTP with valid test credentials.
7. Trigger a violation and confirm email is sent.
8. Enable MQTT with test broker/topic.
9. Trigger a violation and confirm MQTT message is published.
10. Break one channel intentionally, such as invalid webhook URL.
11. Confirm other enabled channels still run and violation/fine creation does not fail.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Verification commands run.
4. Verification results.
5. Manual test steps.
6. Any remaining limitations.
7. Confirmation that no secrets were added or committed.
