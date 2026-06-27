---

name: alert-logs-page
description: Use this skill when verifying, implementing, or fixing SafeSite AI alert audit logs, AlertLog backend routes, and the frontend Alert Logs page for email, MQTT, and webhook dispatch history.
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Alert Logs Page Skill

## Purpose

Use this skill to implement or improve the Alert Logs feature in SafeSite AI.

The alert dispatch system already writes audit records into the `AlertLog` table for Email, MQTT, and Webhook attempts. The goal of this feature is to make those logs visible to the user through a backend API and a frontend Alert Logs page.

Expected audit trail:

Violation detected → alert dispatch attempted → Email/MQTT/Webhook result saved in AlertLog → user can view alert history in the dashboard.

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `backend/database/models.py`
   * `backend/routes`
   * `backend/schemas`
   * `backend/alerts/dispatcher.py`
   * `backend/alerts/base.py`
   * `backend/alerts/email_handler.py`
   * `backend/alerts/mqtt_handler.py`
   * `backend/alerts/webhook_handler.py`
   * `frontend/src/pages`
   * `frontend/src/components`
   * `frontend/src/api`
   * `frontend/src/api/client.js`
   * `frontend/src/App.jsx`
   * frontend sidebar/navigation files

2. If file names are different, search the repository for:

   * `AlertLog`
   * `alert_log`
   * `alert logs`
   * `alerts`
   * `handler_type`
   * `success`
   * `error_msg`
   * `Sidebar`
   * `Routes`
   * `SettingsPage`
   * `Violation`

3. Explain the current implementation.

4. Identify:

   * whether `AlertLog` model already exists
   * whether backend routes for alert logs already exist
   * whether schemas for alert logs already exist
   * whether frontend Alert Logs page already exists
   * where sidebar/navigation routes are registered

5. Create a file-by-file implementation plan.

6. Wait for user approval before editing.

## Implementation rules

* Do not rewrite the whole project.
* Do not modify unrelated camera, AI detection, fine/challan, payroll, worker-management, auth, Docker, or requirements files unless absolutely required.
* Preserve existing backend structure:

  * `backend/routes`
  * `backend/database`
  * `backend/schemas`
  * `backend/alerts`
  * `backend/core`
* Preserve existing frontend structure and styling.
* Preserve JWT/auth protection.
* Do not expose secrets, SMTP passwords, webhook URLs, MQTT credentials, Supabase keys, or database URLs.
* Do not change existing API response formats unless absolutely necessary.
* Add only safe read-only alert-log functionality unless user explicitly approves more.
* Do not run `git commit` unless the user explicitly approves.

## Expected backend behavior

If missing, add a protected backend endpoint to list alert logs.

Suggested endpoint:

`GET /api/v1/alert-logs`

Expected query parameters:

* `limit`
* `offset` or `page`
* `handler_type`
* `success`
* `violation_id`
* `date_from`
* `date_to`

Use only the filters that fit the existing project style.

Expected response fields:

* `id`
* `violation_id`
* `handler_type`
* `success`
* `error_msg`
* `created_at`

Optional joined/context fields if easy and safe:

* `violation_type`
* `camera_id`
* `worker_id`
* `challan_number`

Backend requirements:

1. Route must be protected with the existing auth dependency.
2. Route must use pagination or a safe default limit.
3. Route must return newest logs first.
4. Route must not expose secrets.
5. Route must handle empty logs cleanly.
6. Route must not break if related violation rows are missing.
7. OpenAPI must generate successfully.

## Expected frontend behavior

Add an Alert Logs page that shows alert dispatch history.

The page should show:

1. Alert log table.
2. Handler type: Email, MQTT, Webhook.
3. Status:

   * Sent / Success
   * Skipped
   * Failed
4. Violation ID.
5. Error message or skipped reason.
6. Timestamp.
7. Loading state.
8. Empty state.
9. Error state.
10. Refresh button.

Useful filters if safe and simple:

* handler type
* success/failed/skipped status
* violation ID
* date range

Frontend requirements:

1. Use the existing API client pattern.
2. Use the existing page/card/table styling.
3. Add route in the existing router.
4. Add sidebar/navigation item if the project has sidebar navigation.
5. Do not expose secrets.
6. Do not break existing pages.
7. Frontend build must pass.

## Status display guidance

Map log records clearly:

* `success = true` and `error_msg = null` → Sent
* `success = true` and `error_msg` starts with `skipped:` → Skipped
* `success = false` → Failed

Use existing badge styles where possible.

Suggested labels:

* Email
* MQTT
* Webhook
* Sent
* Skipped
* Failed

## Verification commands

After coding, run backend compile checks for changed backend files, for example:

```powershell
python -m py_compile backend/routes/alert_logs.py
python -m py_compile backend/schemas/alert_log.py
python -m py_compile backend/database/models.py
```

Run relevant backend tests if added:

```powershell
python -m pytest tests/unit/test_alert_logs*.py -v
```

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

Run frontend build:

```powershell
cd frontend
npm run build
cd ..
```

## Manual verification

After implementation, manually test:

1. Start backend.
2. Start frontend.
3. Trigger a violation with all alert channels disabled or unconfigured.
4. Confirm AlertLog records are created as skipped.
5. Open Alert Logs page.
6. Confirm skipped records appear.
7. Enable webhook and trigger a violation.
8. Confirm webhook sent or failed record appears.
9. Test filters if implemented.
10. Refresh page and confirm records remain.
11. Confirm no secrets, passwords, broker URLs, or webhook URLs are shown.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Backend verification results.
4. Frontend build result.
5. Manual test checklist.
6. Remaining limitations.
7. Confirmation that no secrets were added or exposed.
