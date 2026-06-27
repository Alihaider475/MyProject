---
name: backend-qa-precheck
description: "Use this skill before Dockerizing the SafeSite AI project to verify backend APIs are working and data is persisting to Supabase PostgreSQL (not SQLite). Triggers: any task involving API smoke testing, database connection verification, pre-Docker QA, Supabase data confirmation, or endpoint audit. Stack: FastAPI + SQLAlchemy + Supabase Auth JWT + PostgreSQL. Do NOT modify production code, models, routes, or auth logic."
---

# SafeSite AI — Backend QA Pre-Docker Skill

## Role

Act as an expert FastAPI Backend QA Engineer and DevOps Engineer.

---

## Project Context

| Layer        | Technology                                      |
|--------------|-------------------------------------------------|
| Frontend     | React + Vite                                    |
| Backend      | Python FastAPI                                  |
| Auth         | Supabase JWT                                    |
| ORM          | SQLAlchemy                                      |
| DB (prod)    | Supabase PostgreSQL                             |
| DB (dev)     | SQLite (may exist)                              |
| Detection    | YOLO, OpenCV, DeepFace                          |

---

## Goal

Confirm backend APIs work correctly and data writes reach Supabase PostgreSQL — not SQLite — before Dockerization.

---

## Hard Rules (never violate)

- Do NOT modify production code
- Do NOT change database models
- Do NOT change route behavior
- Do NOT change authentication logic
- Do NOT hardcode or print secrets
- Mask all sensitive values: `DATABASE_URL`, JWT token, Supabase keys, SMTP password, DB password

---

## Strict Workflow

1. Explore the repository first
2. Explain current API structure and database configuration
3. Create a file-by-file test plan
4. **Wait for approval** before creating or editing any test/script files
5. After approval: implement, run tests, report results

---

## Phase 1 — Repository Inspection

### Inspect these areas

- Backend entry point (`backend/main.py` or `app/main.py`)
- Backend route files
- Database/session/config files
- SQLAlchemy models
- Auth/JWT dependencies
- Existing tests folder
- `.env.example` or config files (do NOT reveal secrets from `.env`)

### Report

- Exact FastAPI app import path
- Exact API prefix (e.g. `/api/v1`)
- All endpoints grouped by module:

| Module            | Endpoints |
|-------------------|-----------|
| health            |           |
| auth/session      |           |
| cameras           |           |
| workers           |           |
| violations        |           |
| fine config       |           |
| fines/challan     |           |
| alerts/alert config |         |
| payroll reports   |           |
| image detection   |           |
| video detection   |           |

- Which endpoints require Bearer JWT
- Which endpoints write to database
- Which endpoints are safe for smoke testing

---

## Phase 2 — Database Verification

Check how the project selects the database. Report:

- Whether `DATABASE_URL` is configured
- Whether config points to PostgreSQL or SQLite
- Whether backend uses SQLAlchemy `create_engine`/`sessionmaker`
- Whether Supabase PostgreSQL is used for application tables
- Whether Supabase Auth is separate from application DB tables

### Masking rule

Never print the full `DATABASE_URL`. Only show:
```
postgresql://USER:****@HOST:PORT/DB
```
or
```
sqlite:///****.db
```

---

## Phase 3 — API Smoke Test Plan

Run against: `http://localhost:8000`

### Environment variables

| Variable                  | Default                   |
|---------------------------|---------------------------|
| `SAFESITE_BASE_URL`       | `http://localhost:8000`   |
| `SAFESITE_API_PREFIX`     | `/api/v1`                 |
| `SAFESITE_JWT`            | optional Bearer token     |
| `SAFESITE_TEST_IMAGE`     | optional path to image    |
| `SAFESITE_RUN_UPLOAD_TESTS` | `false`               |
| `SAFESITE_RUN_WRITE_TESTS`  | `true`                |

### Test order

1. Health endpoint
2. Read cameras
3. Create test camera
4. Read cameras again — verify created camera appears
5. Read workers
6. Create worker — only if test image exists AND upload tests enabled
7. Read violations
8. Read fine configuration
9. Create/update test fine config — only if endpoint exists
10. Read alert config or alert logs — only if endpoint exists
11. Read payroll/report endpoint — only if endpoint exists
12. Image detection upload — only if `SAFESITE_RUN_UPLOAD_TESTS=true` AND test image exists

### Testing requirements

- Use `pytest` + `requests` or `pytest` + `httpx`
- Run against the real local backend
- Do NOT start webcam detection by default
- Do NOT require real RTSP cameras
- Do NOT trigger expensive video processing by default
- Generate unique test data names with timestamp:
  `Claude Test Camera 2026-{timestamp}`

### Output format per test

```
Endpoint  : POST /api/v1/cameras
Method    : POST
Status    : 201
Result    : PASS
Summary   : Camera "Claude Test Camera 2026-..." created successfully
```

### Error handling

| Status  | Action                                                  |
|---------|---------------------------------------------------------|
| 401/403 | Print "Token missing or role not allowed"               |
| 422     | Print validation error + expected schema                |
| 500     | Print backend error summary, no secrets exposed         |

---

## Phase 4 — Supabase/PostgreSQL Confirmation

### Preferred verification approach

After `POST /cameras` creates a test camera, call `GET /cameras` and verify the same record appears.

### Optional SQL verification script

File: `scripts/check_supabase_data.py`

Create **only after approval**. It must:

- Load `DATABASE_URL` from environment
- **Refuse to run** if `DATABASE_URL` is SQLite
- Connect to PostgreSQL
- Count rows from these tables (if they exist):
  - `cameras`
  - `workers`
  - `violations`
  - `fines`
  - `fine_config`
  - `alert_logs`
- Show latest 5 camera names and `created_at` values
- Mask all connection details
- Never print any secrets

---

## Phase 5 — Postman Support

Generate a Postman testing guide covering:

- How to set `base_url`
- How to set `access_token`
- How to test `GET /health`
- How to test `POST /cameras`
- How to test `GET /cameras`
- How to test worker upload with `form-data`
- How to confirm data in Supabase Table Editor

---

## Approval Gate

Before creating or editing any files, show:

1. Discovered endpoints list
2. Database configuration summary
3. Proposed files to create
4. Exact test strategy
5. Commands that will be run

**Wait for explicit approval before proceeding.**

---

## After Approval — Deliverables

Implement only approved files. Then report:

- Commands executed
- Passed/failed results per endpoint
- Any failing endpoint and reason
- Whether backend is connected to PostgreSQL or SQLite
- How to verify same data in Supabase Dashboard
- List of changed files
- Next recommended step before Dockerization