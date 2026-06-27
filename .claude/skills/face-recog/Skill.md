---

name: face-recognition-worker-identification
description: Use this skill when implementing or modifying SafeSite AI face recognition, worker registration, face embedding storage, worker matching, and attaching worker_id to violation records.
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI — Face Recognition + Worker Identification Skill

## Purpose

Use this skill to implement or improve the SafeSite AI worker identification pipeline:

Worker registered with face photo → face embedding stored → during live detection, worker is matched → matched worker_id is attached to violation record.

## Required workflow

Before coding:

1. Inspect only relevant files first:

   * `backend/routes/workers.py`
   * `backend/routes/violations.py`
   * `backend/database/models.py`
   * `backend/schemas/worker.py`
   * `backend/schemas/violation.py`
   * `backend/detection/face_recognizer.py`
   * `backend/detection/auto_identifier.py`
   * `backend/detection/detector.py`
   * `backend/detection/violation_checker.py`
   * `backend/camera/manager.py`
   * `backend/core/config.py`
   * `frontend/src/pages/WorkerRegistrationPage.jsx`
   * `frontend/src/pages/WorkerDashboard.jsx`

2. Explain the current implementation.

3. Identify exactly what is already implemented and what is missing.

4. Create a file-by-file implementation plan.

5. Wait for user approval before editing files.

## Implementation rules

* Do not rewrite the whole project.
* Do not modify unrelated frontend, Docker, or requirements files unless absolutely required.
* Preserve the current refactored backend structure:

  * `backend/routes`
  * `backend/database`
  * `backend/detection`
  * `backend/schemas`
  * `backend/utils`
* Preserve backend JWT/auth protection.
* Preserve existing API route paths and response formats.
* Do not make face recognition mandatory for violation logging.
* If worker is not recognized, save violation with `worker_id = null`.
* Keep detection performance reasonable by running face recognition every N frames, not every frame.
* Use existing database models and schemas where possible.
* Do not commit secrets or real environment values.
* Do not run `git commit` unless the user explicitly approves.

## Expected implementation

The implementation should support:

1. Worker registration validates uploaded face photo.
2. Backend extracts face embedding using the existing face recognition utility.
3. Face embedding is stored safely in the database.
4. During live detection, the system crops face/person region and compares it with registered worker embeddings.
5. Matched `worker_id` is attached to the violation before saving.
6. A configurable face matching threshold is added or reused.
7. Logs are added for:

   * worker registered
   * face not detected
   * worker matched
   * worker unidentified
8. Violation logging continues even when face recognition fails.

## Verification commands

After coding, run:

```powershell
python -m py_compile backend/routes/workers.py
python -m py_compile backend/detection/face_recognizer.py
python -m py_compile backend/camera/manager.py
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

1. Register worker with clear face photo.
2. Start camera detection.
3. Trigger PPE violation.
4. Confirm violation row has `worker_id`.
5. Confirm unidentified person saves violation with `worker_id = null`.

## Final response required from Claude

After completing work, Claude must provide:

1. Changed files.
2. What changed in each file.
3. Verification commands run.
4. Verification results.
5. Manual test steps.
6. Any remaining limitations.
