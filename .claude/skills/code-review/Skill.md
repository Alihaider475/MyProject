---

name: demo-readiness-qa
description: Use this skill when performing SafeSite AI full demo readiness QA, regression review, build verification, OpenAPI checks, frontend route checks, and small demo-blocking bug fixes.
------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Demo Readiness QA Skill

## Purpose

Use this skill to perform full SafeSite AI demo readiness QA and regression review after major features have been merged.

Main project flow to verify:

Detection → Violation Logging → Face Recognition → Worker Identification → Fine/Challan Generation → Payroll Report → Email/MQTT/Webhook Alerts → Alert Logs → Settings Persistence.

## Required workflow

Before coding:

1. Inspect the current project structure.

2. Inspect backend routes and frontend routes/pages.

3. Review these areas:

   * Login / logout
   * Dashboard
   * Camera start/stop
   * Real-time detection stream
   * Violation logging
   * Worker management
   * Face enrollment / face recognition
   * Fine/challan generation
   * Payroll report
   * Alert settings page
   * Email/MQTT/Webhook alert dispatch
   * Alert Logs page
   * Frontend navigation/sidebar

4. Identify:

   * broken routes
   * broken imports
   * API/frontend mismatches
   * missing loading states
   * missing error states
   * build errors
   * OpenAPI errors
   * demo-blocking bugs
   * obvious UI text issues
   * old/outdated messages

5. Group issues by severity:

   * Critical: blocks demo
   * High: breaks important feature
   * Medium: visible UI/API issue
   * Low: polish/documentation text

6. Create a file-by-file fix plan.

7. Wait for user approval before editing.

## Implementation rules

* Do not add new major features.
* Only fix demo-blocking bugs, broken UI, API mismatches, build errors, test failures, or obvious polish issues.
* Do not rewrite unrelated modules.
* Do not modify database schema unless absolutely required.
* Do not modify auth logic unless a real bug is found.
* Do not modify AI model/detection logic unless a real demo-blocking bug is found.
* Preserve existing API response formats.
* Preserve JWT/auth protection.
* Do not expose secrets.
* Do not commit anything unless the user explicitly approves.

## Expected QA output before coding

Claude must provide:

1. Current project status.
2. Issues found, grouped by severity:

   * Critical
   * High
   * Medium
   * Low
3. File-by-file fix plan.
4. Verification plan.
5. Ask for approval before editing.

## Verification commands

After coding, run backend checks:

```powershell
python -m py_compile backend/main.py
```

Also run `python -m py_compile` on any changed backend files.

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

Run backend tests:

```powershell
python -m pytest tests/unit/test_fine_calculator.py tests/unit/test_violation_checker.py -v
python -m pytest tests/unit/test_alert_dispatcher.py tests/unit/test_email_handler.py tests/unit/test_mqtt_handler.py tests/unit/test_webhook_handler.py -v
python -m pytest tests/unit/test_settings_persistence.py -v
python -m pytest tests/integration/test_api_alert_logs.py -v
```

Run frontend build:

```powershell
cd frontend
npm run build
cd ..
```

## Manual demo checklist

After implementation, manually verify:

1. Login works.
2. Logout works.
3. Dashboard loads.
4. Camera page opens.
5. Camera start/stop does not crash.
6. Real-time stream page loads.
7. Violation page loads.
8. Worker page loads.
9. Worker enrollment form works.
10. Fine configuration page loads.
11. Payroll report page loads.
12. Settings page shows Email, MQTT, and Webhook toggles.
13. Alert Logs page loads.
14. Navigation links work.
15. No secrets are displayed in the UI.
16. Backend `/docs` loads.
17. Backend `/openapi.json` returns 200.
18. Frontend build passes.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Verification commands run.
4. Verification results.
5. Manual demo checklist.
6. Remaining limitations.
7. Confirmation that no secrets were added or exposed.
8. Confirmation that no git commit was run.
