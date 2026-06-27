---

name: fine-challan-generation
description: Use this skill when verifying, implementing, or fixing SafeSite AI automatic fine calculation, challan generation, fine configuration, and payroll-ready fine records.
-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Fine / Challan Generation Skill

## Purpose

Use this skill to verify and complete the SafeSite AI fine pipeline:

PPE violation detected → violation saved with worker_id → active fine rule found → fine/challan record created with pending status → payroll report can use that fine.

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `backend/routes/fines.py`
   * `backend/routes/violations.py`
   * `backend/database/models.py`
   * `backend/schemas/fine.py`
   * `backend/schemas/violation.py`
   * `backend/detection/fine_calculator.py`
   * `backend/detection/violation_checker.py`
   * `backend/camera/manager.py`
   * `backend/alerts/fine_handler.py`
   * `backend/core/config.py`
   * `frontend/src/pages/FineConfigPage.jsx`
   * `frontend/src/pages/PayrollReport.jsx`

2. Explain the current implementation.

3. Identify what is already implemented and what is missing.

4. Check whether fines are created automatically when `violation.worker_id` is not null.

5. Check whether fines are skipped safely when `worker_id` is null.

6. Check whether duplicate fines can be created for the same violation.

7. Create a file-by-file implementation plan.

8. Wait for user approval before editing.

## Implementation rules

* Do not rewrite the whole project.
* Do not modify unrelated frontend, Docker, auth, or requirements files unless absolutely required.
* Preserve the current refactored backend structure:

  * `backend/routes`
  * `backend/database`
  * `backend/detection`
  * `backend/schemas`
  * `backend/utils`
* Preserve backend JWT/auth protection.
* Preserve existing API route paths and response formats.
* Do not create duplicate fines for the same violation.
* If `worker_id` is null, save violation normally but do not create a fine.
* If no active fine configuration exists for the violation type, save violation normally but do not create a fine.
* Fine/challan status should default to `pending`.
* Do not commit secrets or real environment values.
* Do not run `git commit` unless the user explicitly approves.

## Expected behavior

The implementation should support:

1. Fine configuration with:

   * `violation_type`
   * `amount`
   * `active` status
   * `created_at`
   * `updated_at`

2. When a violation is logged with `worker_id`, the system checks active fine configuration.

3. If active config exists, create one fine/challan record linked to:

   * `violation_id`
   * `worker_id`
   * `violation_type`
   * `amount`
   * `challan_number`
   * `status = pending`

4. If a fine already exists for that `violation_id`, do not create another one.

5. Add clear logs:

   * fine created
   * fine skipped because worker unidentified
   * fine skipped because no active fine config
   * fine skipped because already exists

6. Confirm `FineConfigPage` still works.

7. Confirm `PayrollReport` can read the generated fine records.

## Verification commands

After coding, run:

```powershell
python -m py_compile backend/routes/fines.py
python -m py_compile backend/detection/fine_calculator.py
python -m py_compile backend/camera/manager.py
python -m py_compile backend/alerts/fine_handler.py
```

Then verify OpenAPI:

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

1. Configure fine for `NO-Hardhat`.
2. Register and enroll worker.
3. Trigger PPE violation.
4. Confirm violation row has `worker_id`.
5. Confirm fine/challan record is created once.
6. Trigger same violation again within cooldown and confirm duplicate fine is not created.
7. Trigger unidentified violation.
8. Confirm violation is saved but no fine is created.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Verification commands run.
4. Verification results.
5. Manual test steps.
6. Any remaining limitations.
