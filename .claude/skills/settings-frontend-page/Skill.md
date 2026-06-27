---

name: frontend-settings-page
description: Use this skill when updating the SafeSite AI frontend Settings page to control persisted runtime alert settings such as Email, MQTT, and Webhook alerts.
---------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Frontend Settings Page Skill

## Purpose

Use this skill to update the SafeSite AI frontend Settings page after backend settings persistence has been implemented.

The backend now supports persistent runtime alert settings for:

* Email Alerts
* MQTT Alerts
* Webhook Alerts

The frontend Settings page should allow the user to view and update these alert toggles through the backend settings API.

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `frontend/src/pages`
   * `frontend/src/components`
   * `frontend/src/api`
   * `frontend/src/services`
   * `frontend/src/lib`
   * `frontend/src/client.js`
   * `frontend/src/api.js`
   * `backend/routes/settings.py`

2. If file names are different, search the repository for:

   * `Settings`
   * `SettingsPage`
   * `email-alerts`
   * `mqtt-alerts`
   * `webhook-alerts`
   * `EMAIL_ALERTS_ENABLED`
   * `settings`
   * `api`
   * `client`

3. Explain the current frontend Settings implementation.

4. Explain the backend settings API request and response shapes.

5. Identify what already works and what is missing.

6. Create a file-by-file implementation plan.

7. Wait for user approval before editing.

## Implementation rules

* Do not modify backend logic.
* Do not change backend API response formats.
* Do not modify unrelated frontend pages.
* Preserve existing routing and authentication behavior.
* Preserve the current UI style and layout system.
* Do not hardcode secrets, SMTP passwords, webhook URLs, MQTT credentials, Supabase keys, or database URLs.
* Do not expose secret values in the UI.
* Only show safe configured status, such as:

  * SMTP configured / not configured
  * MQTT configured / not configured
  * Webhook configured / not configured
* Do not run `git commit` unless the user explicitly approves.

## Expected UI behavior

The Settings page should show:

1. Email Alerts toggle
2. MQTT Alerts toggle
3. Webhook Alerts toggle
4. SMTP configured status badge
5. MQTT configured status badge
6. Webhook configured status badge
7. Loading state while settings are being fetched
8. Saving state while a toggle is being updated
9. Success message after update
10. Error message if update fails
11. Clear text that settings are saved and persist after backend restart

Remove outdated text such as:

* settings do not persist after restart
* email toggle is runtime only
* changes reset after server restart

## Expected API behavior

The frontend should call the backend settings API.

Expected backend endpoints may include:

* `GET /api/v1/settings`
* `PUT /api/v1/settings/email-alerts`
* `PUT /api/v1/settings/mqtt-alerts`
* `PUT /api/v1/settings/webhook-alerts`

Expected update body:

```json
{
  "enabled": true
}
```

The frontend should verify the real shapes from `backend/routes/settings.py` before editing.

## Safe response handling

The frontend should support safe response fields such as:

* `email_alerts_enabled`
* `mqtt_enabled`
* `webhook_enabled`
* `smtp_configured`
* `mqtt_configured`
* `webhook_configured`

Do not assume exact names until `backend/routes/settings.py` is inspected.

## UI requirements

Each alert channel should be displayed as a separate card or row.

Each card should include:

* Channel name
* Short description
* Toggle switch
* Configured/not configured badge
* Small helper text

Suggested helper text:

Email Alerts:
Sends violation and challan alerts to the configured receiver email.

MQTT Alerts:
Publishes violation and fine events to the configured MQTT topic.

Webhook Alerts:
Posts violation and fine payloads to the configured webhook endpoint.

Persistence note:
Changes are saved and remain active after backend restart.

## Error handling

Implement clear error handling:

* If settings fail to load, show a readable error and retry option if the existing UI style supports it.
* If one toggle update fails, do not break the whole page.
* Revert or refetch the failed setting after error.
* Do not show technical stack traces to the user.
* Log detailed frontend errors only to console if the project already uses console logging.

## Verification commands

After coding, run frontend checks according to the project setup.

Common commands:

```powershell
cd frontend
npm install
npm run build
```

If the project has lint or tests, run them only if already configured:

```powershell
npm run lint
npm test
```

Return to project root:

```powershell
cd ..
```

Also verify backend OpenAPI if backend route shape was referenced:

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

## Manual verification

After implementation, manually test:

1. Start backend.
2. Start frontend.
3. Open Settings page.
4. Confirm Email, MQTT, and Webhook alert toggles are visible.
5. Confirm configured status badges are visible.
6. Disable Email Alerts.
7. Refresh page and confirm Email Alerts remains disabled.
8. Restart backend and frontend.
9. Confirm Email Alerts remains disabled.
10. Enable Email Alerts again.
11. Repeat for MQTT and Webhook toggles.
12. Confirm no secrets are displayed in the UI.
13. Trigger a violation and confirm disabled channels are skipped safely.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Frontend build result.
4. Any tests/lint run.
5. Manual test checklist.
6. Remaining limitations.
7. Confirmation that no secrets were added or exposed.
