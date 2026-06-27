---

name: settings-persistence
description: Use this skill when verifying, implementing, or fixing SafeSite AI runtime settings persistence, especially alert settings toggles, system configuration, and settings stored through the backend settings routes.
-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Settings Persistence Skill

## Purpose

Use this skill to verify and complete persistent runtime settings in SafeSite AI.

Current known issue:

The runtime `/settings/email-alerts` toggle does not persist across backend restarts. The user can enable or disable alert settings, but after restarting the backend, the setting may return to the default value from `.env` or in-memory state.

The goal is:

Settings changed from the UI or API should be saved persistently and restored after backend restart.

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `backend/routes/settings.py`
   * `backend/core/config.py`
   * `backend/database/models.py`
   * `backend/database/connection.py`
   * `backend/schemas`
   * `backend/alerts/dispatcher.py`
   * `backend/alerts/email_handler.py`
   * `backend/alerts/mqtt_handler.py`
   * `backend/alerts/webhook_handler.py`
   * `frontend/src/pages`
   * frontend settings-related components if they exist

2. If file names are different, search the repository for:

   * `settings`
   * `email-alerts`
   * `EMAIL_ALERTS_ENABLED`
   * `MQTT`
   * `WEBHOOK`
   * `SENDER_EMAIL`
   * `alerts`
   * `SystemSetting`
   * `AppSetting`
   * `Setting`

3. Explain the current settings implementation.

4. Identify:

   * which settings come from `.env`
   * which settings are runtime toggles
   * which settings are currently in-memory only
   * which settings already persist in the database, if any

5. Check the `/settings/email-alerts` route.

6. Check whether alert handlers read runtime settings or only static `.env` settings.

7. Create a file-by-file implementation plan.

8. Wait for user approval before editing.

## Implementation rules

* Do not rewrite the whole project.
* Do not modify unrelated frontend, Docker, auth, AI detection, camera, fine/challan, payroll, or worker-management code unless absolutely required.
* Preserve existing API route paths and response formats where possible.
* Preserve JWT/auth protection.
* Do not commit secrets or real `.env` values.
* Do not store SMTP passwords, tokens, webhook secrets, Supabase keys, or database URLs in plain text unless the project already explicitly supports secure storage.
* Runtime boolean toggles are safe to persist.
* Alert dispatch must continue to work even if settings persistence fails.
* Missing persisted settings should fall back safely to `.env` defaults.
* Do not run `git commit` unless the user explicitly approves.

## Expected behavior

The settings system should support persistent runtime toggles such as:

* `EMAIL_ALERTS_ENABLED`
* `MQTT_ENABLED`
* `WEBHOOK_ENABLED`
* possibly other safe boolean/system toggles already present in the project

Expected flow:

1. Backend starts.
2. It loads default values from `.env` through `settings`.
3. It loads persisted runtime overrides from the database.
4. API routes return the effective current settings.
5. When the user changes a setting from the UI/API, the value is saved to the database.
6. Backend restart should keep the changed value.
7. If no database value exists, `.env` default is used.

## Recommended database design

If no settings table already exists, add a simple persistent settings table.

Suggested model:

* `id`
* `key`
* `value`
* `value_type`
* `created_at`
* `updated_at`

Example keys:

* `email_alerts_enabled`
* `mqtt_enabled`
* `webhook_enabled`

Keep values simple and safe.

Do not store secrets here unless the project already has a secure encrypted mechanism.

## API behavior

Verify or implement settings endpoints so they can:

1. Read current effective settings.
2. Update safe runtime toggles.
3. Persist updates in database.
4. Return consistent response shapes.
5. Validate allowed keys.
6. Reject unknown or unsafe setting keys.

Do not expose secret values in API responses.

For secret-like fields, return only whether they are configured, for example:

* `smtp_configured: true`
* `webhook_configured: true`
* `mqtt_configured: true`

## Alert integration

Alert handlers or dispatcher should use the effective runtime settings.

Expected behavior:

* If email alerts are disabled through API/UI, email alert handler should skip.
* If email alerts are enabled again, email alert handler should send if SMTP config exists.
* If MQTT is disabled, MQTT handler should skip.
* If webhook is disabled, webhook handler should skip.
* Skip should be logged clearly.
* AlertLog should show skipped attempts if the alert system already supports AlertLog records.

## Migration rules

If a new settings table or columns are needed:

1. Add PostgreSQL-safe migration logic.
2. Add SQLite-safe migration logic.
3. Make migration idempotent.
4. Do not delete existing data.
5. Do not require manual database reset.

## Verification commands

After coding, run compile checks on changed files, for example:

```powershell
python -m py_compile backend/routes/settings.py
python -m py_compile backend/core/config.py
python -m py_compile backend/database/models.py
python -m py_compile backend/database/connection.py
python -m py_compile backend/alerts/dispatcher.py
python -m py_compile backend/alerts/email_handler.py
python -m py_compile backend/alerts/mqtt_handler.py
python -m py_compile backend/alerts/webhook_handler.py
```

Run related tests if they exist:

```powershell
python -m pytest tests/unit/test_settings*.py -v
python -m pytest tests/unit/test_alert_dispatcher.py tests/unit/test_email_handler.py tests/unit/test_mqtt_handler.py tests/unit/test_webhook_handler.py -v
```

If no settings tests exist, add focused tests for:

1. default fallback from `.env`
2. saving a setting
3. reading persisted setting
4. restart simulation by reloading from database
5. rejecting unknown unsafe keys

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

1. Start backend.
2. Check current email alert setting from UI/API.
3. Disable email alerts from UI/API.
4. Restart backend.
5. Confirm email alerts remain disabled.
6. Enable email alerts from UI/API.
7. Restart backend.
8. Confirm email alerts remain enabled.
9. Repeat for MQTT/Webhook toggles if implemented.
10. Trigger violation and confirm disabled channels skip safely.
11. Confirm enabled channels use existing `.env` credentials/config and do not expose secrets.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Verification commands run.
4. Verification results.
5. Manual test checklist.
6. Any remaining limitations.
7. Confirmation that no secrets were added or committed.
