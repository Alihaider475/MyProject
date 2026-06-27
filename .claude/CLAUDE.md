# CLAUDE.md — SafeSite AI Project Context and Coding Rules

> **Read this file first before changing code.**
> This repository is a Final Year Project named **SafeSite AI**: an AI-powered PPE safety monitoring system for construction/industrial environments.

---

## 1. Why this file exists

This file gives Claude Code / coding agents the complete project context before they modify anything. The goal is to prevent random rewrites, broken API contracts, UI regressions, detection bugs, and branch confusion.

When working in this repository, Claude must:

- Understand the existing implementation first.
- Inspect relevant files before planning.
- Explain the current flow before changing code.
- Produce a small file-by-file plan.
- Wait for approval before implementation unless the user explicitly says to implement now.
- Preserve existing API response shapes unless the task explicitly requires changing them.
- Run relevant tests/build checks.
- Report changed files, commands run, and verification steps.

---

## 2. Project identity

- **Project name:** SafeSite AI
- **Project type:** AI-powered web-based PPE safety monitoring system
- **Project ID:** Fall25-48
- **Academic context:** Final Year Project, BSCS Spring 2022–2026
- **Main purpose:** Detect PPE violations in real time, identify workers, log violations, send alerts, calculate fines, and generate reports.

SafeSite AI monitors live camera feeds from USB webcams or RTSP IP cameras. A YOLO-based model detects PPE classes such as hard hats, safety vests, masks, and persons. When a violation is detected, the backend logs it, optionally identifies the worker using DeepFace/FaceNet embeddings, calculates fines based on configured rules, and sends alerts through email, MQTT, or webhook.

---

## 3. Main users and roles

### Safety Manager

Main operational user. Can usually:

- Log in / log out
- View dashboard
- Start/stop live camera monitoring
- View live annotated video feed
- View detection counts
- Review violation history
- Filter/search violations
- Export CSV reports
- View analytics/charts
- Upload images/videos for detection

### System Administrator / Admin

Administrative user. Can usually:

- Access admin panel
- Manage workers
- Register workers with face photos
- Edit/delete or deactivate worker records
- Configure fine types and fine amounts
- Generate payroll deduction reports
- Configure alert channels if the UI exposes this

### Automated System Process

Backend process responsible for:

- Loading YOLO model
- Processing frames
- Running violation checker
- Logging violations
- Matching workers through face recognition
- Calculating fines/challans
- Dispatching alerts
- Updating counts via WebSocket / stream state

---

## 4. High-level architecture

The application is a client-server system.

```text
React 18 + Vite Frontend
        |
        | REST API / WebSocket / MJPEG stream / WebRTC where implemented
        v
FastAPI Backend
        |
        | SQLAlchemy ORM
        v
SQLite for development / PostgreSQL for production
```

External / supporting services:

- Supabase Auth for user authentication and JWT validation
- Ultralytics YOLO for PPE detection
- OpenCV for webcam, RTSP, image, and video processing
- DeepFace / FaceNet for face recognition
- SMTP email for alerts
- MQTT broker for alerts
- HTTP webhook endpoint for alerts
- Redis cache where configured, with fallback behavior if missing

> **Important design rule:** AI inference runs on the backend server, not in the browser.

---

## 5. Technology stack

### Frontend

- React 18
- JavaScript
- Vite
- Tailwind CSS
- React Router
- Recharts
- React Query where integrated
- Redux Toolkit where integrated
- Supabase JS SDK for frontend auth/session handling

### Backend

- Python
- FastAPI
- REST APIs
- WebSocket
- MJPEG streaming
- WebRTC where implemented
- Uvicorn / FastAPI application server
- SQLAlchemy ORM
- Pydantic schemas
- OpenCV
- Ultralytics YOLO
- DeepFace / FaceNet
- Pillow
- NumPy / Pandas where needed

### Database

- SQLite for development
- PostgreSQL for production
- SQLAlchemy ORM
- Alembic may not be fully configured; verify before using migrations

### Auth

- Supabase Auth
- JWT token validation
- Google OAuth optional via environment flag
- Role-based access: admin vs safety manager

### Alerts

- SMTP Email
- MQTT Broker
- Webhook Endpoint
- Alert logs should record dispatch success/failure

### Deployment / infrastructure

- Local Windows development with PowerShell is common
- Python virtual environment: `.venv`
- Docker may be used for containerized setup
- Redis may be configured locally or via Docker
- PostgreSQL may be local, Dockerized, or Supabase-hosted

---

## 6. Expected repository shape

The exact tree can change, so inspect the repo first. The current project has generally followed this structure:

```text
backend/
  main.py or app entrypoint
  routes/ or api/
  core/
  database/
  detection/
  alerts/
  schemas/
  models/
  utils/
  services/

frontend/
  src/
    pages/
    components/
    routes/
    services/ or api/
    store/
    hooks/
    assets/

data/
  models/
    ppe.pt
  uploads/
  violation_frames/

requirements/
  base.txt
  dev.txt
  prod.txt

tests/
  unit/
  integration/ if available
```

Before editing, Claude must run or inspect:

```bash
git status
git branch --show-current
```

Then inspect files related to the task. Do not guess paths.

---

## 7. Core functional requirements

The project scope includes these major features:

1. **User Registration** — Email/password registration through Supabase Auth with confirmation email.
2. **User Login** — Email/password and optional Google OAuth login with role-based redirect.
3. **User Logout** — Supabase sign-out and local session cleanup.
4. **Camera Source Configuration** — Add webcam or RTSP camera with name, source URI/device index, and detection confidence.
5. **Real-Time AI Detection** — Start backend camera stream, run YOLO inference, show annotated feed, update counts.
6. **Violation Logging** — Automatically log persistent PPE violations with cooldown handling.
7. **Violation History** — Filterable violation table with camera/type/status/date filters and CSV export.
8. **Violation Analytics and Charts** — Charts grouped by type, camera, and time period.
9. **AI Model Initialization** — Load YOLO `.pt` model once during backend startup.
10. **Image and Video File Detection** — Upload file, run detection, return annotated result/summary.
11. **Real-Time Alert Dispatch** — Send email/MQTT/webhook when violation is logged.
12. **Password Recovery** — Supabase password reset flow.
13. **Worker Management** — Register/manage workers with face photo and face embedding.
14. **Face Recognition and Worker Identification** — Match workers from frames and attach worker ID to violations.
15. **Fine Configuration and Calculation** — Configure violation fine amounts and generate challan/fine records.
16. **Payroll Deduction Report** — Monthly fine summary per worker with pending/deducted/waived statuses.

---

## 8. Important domain concepts

### PPE classes

The production/demo focus is usually:

- Person
- Hard Hat / Helmet
- Safety Vest
- Mask
- Missing hard hat violation
- Missing safety vest violation
- Missing mask violation

Naming can vary between model labels and UI labels. Before modifying violation logic, inspect the model class mapping and any normalization layer.

### Violation persistence

A violation should not be logged from a single noisy frame unless the current implementation intentionally allows it. The expected behavior is:

```text
YOLO detection -> person/PPE association -> violation candidate -> persistence check -> cooldown check -> DB log -> fine calculation -> alert dispatch
```

### Cooldown

Cooldown prevents duplicate records for the same repeated violation. Do not remove cooldown logic while fixing alerts or logging.

### Fine / challan

A challan is the financial penalty record generated when a worker violation is recorded and fine configuration exists.

### ROI polygon

A Region of Interest polygon defines the valid detection area in the camera frame. Detections outside the ROI should be ignored if ROI is enabled/implemented.

---

## 9. Backend rules

### API stability

Do not break existing frontend expectations. Before changing an endpoint:

- Find the frontend caller.
- Record the current request/response shape.
- Preserve field names unless the task explicitly asks for an API change.
- If adding fields, make them backward-compatible.

### FastAPI conventions

Prefer:

- Router-based APIs under `/api/v1/...`
- Dependency injection for DB/session/auth
- Pydantic schemas for request/response validation
- Explicit error responses with useful messages
- Consistent status codes

Avoid:

- Returning raw SQLAlchemy objects unless already used safely
- Blocking the event loop with long CPU work in async routes
- Swallowing exceptions without logging
- Large refactors across unrelated modules

### Database rules

Before editing models:

- Inspect SQLAlchemy model definitions.
- Inspect any existing `create_all` or migration strategy.
- Check SQLite/PostgreSQL compatibility.
- Be careful with `date_trunc`, JSON, Boolean, Enum, and datetime behavior across SQLite/Postgres.
- Never drop tables or reset user data unless the user explicitly asks.

### Detection pipeline rules

Before editing detection code, inspect:

- Detector/model loader
- Camera manager
- Violation checker
- Person/PPE association logic
- Tracking logic if DeepSORT/track IDs are used
- Alert dispatcher call site
- Snapshot/frame saving logic

Do not change model thresholds globally without explaining demo impact.

---

## 10. Frontend rules

### UI consistency

The interface should feel like a modern safety operations dashboard. Preserve:

- Responsive layout
- Dark/light theme behavior if implemented
- Consistent card spacing
- Consistent violation colors across Dashboard, Violations, Charts, and Video pages
- Visible action buttons in tables
- Clear loading/error/empty states

### React conventions

Prefer:

- Small components
- Shared API client functions
- React Query for server data where already adopted
- Redux Toolkit only for app state that is shared across multiple pages
- Stable query keys
- Avoiding unnecessary polling

Avoid:

- Duplicating API logic inside pages
- Hardcoding backend URLs outside the API client/env config
- Breaking route guards
- Changing layout globally when task is page-specific

### Auth and route guards

Preserve role-based navigation:

- Admin should access admin routes.
- Safety Manager should access dashboard/monitoring routes.
- Unauthenticated users should go to login.

If implementing strict admin-only behavior, verify:

- Login redirect
- Manual URL navigation
- Browser refresh
- Protected route wrapper
- Sidebar/nav visibility
- Backend authorization if route is sensitive

---

## 11. Current important defaults and known behavior

These values have been important during demo/debugging. Verify against `.env` and settings files before relying on them:

```env
DETECTION_CONFIDENCE=0.25
VIOLATION_CONFIDENCE=0.25
ENABLE_HARDHAT_COLOR_VETO=false
STREAM_WIDTH=640
STREAM_HEIGHT=480
STREAM_TARGET_FPS=30
WEBCAM_DEBUG=true or false depending on debugging
MODEL_PATH=data/models/ppe.pt
```

Known past issues that must not be reintroduced:

- Live webcam detections staying at zero because camera confidence was higher than upload confidence.
- Bounding boxes shifted down/right due to letterboxing/padding coordinate mismatch.
- Upload detection triggering results but not alert dispatch.
- Dashboard counts mismatching because multiple endpoints used inconsistent aggregation logic.
- Admin user being able to access normal dashboard when strict admin-only access is required.
- Google OAuth button showing when OAuth is disabled.
- OpenAPI `/openapi.json` breaking due to incompatible response annotations.
- DeepFace requiring `tf-keras` with newer TensorFlow versions.

---

## 12. Alert system rules

Alerts should be triggered only after a valid violation is logged or after a file upload summary is intentionally designed to send one alert.

Expected channels:

- Email via SMTP
- MQTT publish
- HTTP webhook POST

Rules:

- If one channel fails, the violation record must remain saved.
- Each channel result should be logged in alert logs.
- Test-alert functionality should not create fake safety violations unless explicitly designed.
- Do not print secrets or SMTP passwords in logs.

---

## 13. Face recognition rules

Worker identity is sensitive. Handle carefully.

Expected behavior:

```text
Worker registration -> upload clear frontal face photo -> DeepFace/FaceNet embedding extracted -> embedding stored -> live frame face crop -> embedding compared -> matched worker attached to violation
```

Rules:

- Do not store raw secrets or unnecessary biometric data.
- Do not break existing worker records.
- Keep unclear/unmatched faces as unidentified rather than crashing.
- Make face recognition optional/fault-tolerant where possible so PPE detection still works.

---

## 14. File upload detection rules

Image/video detection must:

- Validate file type.
- Save uploaded file safely.
- Run YOLO inference.
- Return annotated output or summary expected by the frontend.
- Avoid blocking other server operations as much as practical.
- Send alerts only according to current accepted behavior.

Do not change upload response format until the frontend caller is updated and tested.

---

## 15. Git and branch workflow

Common branch strategy:

- `main` = stable/final version
- `dev` = integration branch
- `feature/*` = feature work
- Other branches may exist for specific work, such as `worker`, `role-access`, etc.

Before any code work:

```bash
git status
git branch --show-current
git log --oneline -5
```

Rules:

- Do not commit directly to `main` unless user explicitly asks.
- Prefer feature branch from `dev` for new work.
- Do not delete files unless the task requires it.
- Do not commit generated files, snapshots, `.env`, model weights, or accidental root `requirements.txt` unless intended.
- Keep secrets out of git.

---

## 16. Commands for local development

Claude must inspect actual scripts before running commands. These are common commands only.

### Backend setup / run on Windows PowerShell

```powershell
.venv\Scripts\activate
python -m pip install -r requirements/base.txt
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

If the entrypoint differs, inspect the backend folder first.

### Backend tests

```powershell
.venv\Scripts\python.exe -m pytest tests/unit -q
.venv\Scripts\python.exe -m pytest tests/unit/test_association.py tests/unit/test_violation_checker.py -v
```

### Frontend setup / run

```powershell
cd frontend
npm install
npm run dev
```

### Frontend build/check

```powershell
cd frontend
npm run build
npm run lint
```

If `lint` is not configured, report that instead of inventing success.

---

## 17. Required Claude workflow for every coding task

When the user asks Claude to change code, Claude should respond in this sequence.

### Step 1 — Explore

Inspect relevant files first. Use commands like:

```bash
git status
find . -maxdepth 3 -type f | sort
```

On Windows PowerShell use alternatives if needed:

```powershell
git status
Get-ChildItem -Recurse -File | Select-Object -ExpandProperty FullName
```

Then open the actual files related to the requested feature/bug.

### Step 2 — Explain current implementation

Before planning changes, explain:

- Which files control the feature
- Current data flow
- Current bug/risk
- Existing API request/response shape if relevant

### Step 3 — Make a file-by-file plan

The plan must say:

- File path
- What will change
- Why it is required
- Whether API response shape changes
- Tests/build commands to run

### Step 4 — Wait for approval

Do not implement until the user approves the plan, unless the user explicitly says "implement now."

### Step 5 — Implement only approved files

Keep changes scoped.

### Step 6 — Verify

Run targeted tests first, then broader checks when practical.

### Step 7 — Final report

End with:

- Changed files
- Summary of changes
- Tests/build commands run with result
- Manual verification steps
- Any known limitations or follow-up

---

## 18. What Claude must not do

Do not:

- Rewrite the whole app for a small bug.
- Change API response formats silently.
- Remove existing features while fixing another feature.
- Hardcode secrets, tokens, SMTP passwords, Supabase keys, or database URLs.
- Commit `.env`, local database files, model weights, uploads, cache files, or debug snapshots unless explicitly intended.
- Delete tests because they fail.
- Disable authentication to make testing easier.
- Remove cooldown/persistence logic from violation logging.
- Break SQLite/PostgreSQL compatibility without explanation.
- Add large dependencies without justification.
- Claim tests passed without running them.
- Assume file paths; inspect first.

---

## 19. Acceptance checklist before finishing any task

Claude should confirm:

- [ ] Relevant files were inspected.
- [ ] Existing behavior was understood.
- [ ] Changes were scoped to the approved task.
- [ ] API contracts were preserved or clearly documented.
- [ ] UI was checked for loading/error/empty states where relevant.
- [ ] Auth/role behavior was not weakened.
- [ ] Detection thresholds and model paths were not changed accidentally.
- [ ] Database compatibility was considered.
- [ ] Tests/build were run or clearly not available.
- [ ] Changed files were listed.
- [ ] Manual verification steps were provided.

---

## 20. Common feature-specific guidance

### Fixing live detection count problems

Check:

- Camera start endpoint
- Camera manager state
- YOLO detector confidence
- Class mapping
- Frame processing loop
- WebSocket count publisher
- Frontend WebSocket listener
- React state/store update

Do not only change frontend counters if backend detections are zero.

### Fixing bounding box alignment

Check:

- Original frame size
- Model input size
- Letterboxing/padding
- Coordinate scaling back to displayed image
- CSS `object-fit` behavior
- Canvas overlay dimensions
- Device pixel ratio if canvas is used

Bounding boxes must be mapped from model coordinates to actual displayed video coordinates.

### Fixing violation logging

Check:

- Association of PPE to person
- Violation checker persistence
- Cooldown keys
- DB transaction
- Snapshot saving
- Fine calculation
- Alert dispatcher call
- Cache invalidation after new violation

### Fixing alerts

Check:

- Alert config source: env vs database system settings
- SMTP TLS/SSL flags
- Receiver email
- Dispatcher call site
- Alert log insert
- Error logging

Do not let alert failure roll back the violation record.

### Fixing role access

Check:

- Supabase role source / JWT claims / profile table
- Frontend `ProtectedRoute`/`AdminRoute`
- Login redirect logic
- Sidebar/nav route visibility
- Backend dependencies for sensitive admin routes
- Refresh/manual URL behavior

### Fixing dashboard count mismatch

Check:

- Dashboard summary endpoint
- Violations endpoint total count
- Charts endpoint aggregations
- Cache keys and invalidation
- Timezone/date filters
- SQLite/Postgres aggregation differences

Use one source of truth where possible.

### UI polish tasks

Before editing global layout:

- Inspect app layout wrapper
- Inspect page container max-width
- Inspect sidebar/navbar fixed/sticky behavior
- Inspect overflow-x/overflow-y classes
- Inspect root/body dimensions

Avoid page-specific hacks that break other pages.

---

## 21. Environment and secrets policy

`.env` values are required for local use, but must never be committed or printed fully.

Safe to mention variable names:

```env
APP_ENV=
HOST=
PORT=
DATABASE_URL=
REDIS_URL=
MODEL_PATH=
DETECTION_CONFIDENCE=
VIOLATION_CONFIDENCE=
ENABLE_HARDHAT_COLOR_VETO=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
SMTP_HOST=
SMTP_PORT=
SMTP_USERNAME=
SMTP_PASSWORD=
MQTT_HOST=
WEBHOOK_URL=
VITE_API_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ENABLE_GOOGLE_OAUTH=
```

Never expose actual values for secrets.

---

## 22. Testing strategy

Use targeted tests for the changed area.

Examples:

- Association logic: `tests/unit/test_association.py`
- Violation cooldown/persistence: `tests/unit/test_violation_checker.py`
- Config: `tests/unit/test_config.py`
- Email/alerts: alert/email handler tests if present
- Frontend: build/lint and manual page checks

For detection logic, add tests around pure functions when possible instead of relying only on webcam/manual demo.

---

## 23. Documentation consistency

Project documentation describes the system as:

- React frontend
- FastAPI backend
- Supabase authentication
- SQLite/PostgreSQL database
- YOLO PPE detection
- DeepFace worker identification
- Email/MQTT/webhook alerts
- Worker management
- Fine configuration
- Payroll deduction report

When code changes alter project behavior, update relevant documentation/readme/comments only if the user asks or the change would otherwise confuse future maintainers.

---

## 24. Preferred final response format from Claude after implementation

Use this format:

```md
## Summary
- ...

## Changed files
- `path/file.ext` — what changed

## Verification
- `command` — passed/failed
- Manual check: ...

## Notes / limitations
- ...
```

Do not over-explain unrelated details.

---

## 25. Current project priorities and backlog reminders

Completed or mostly implemented features include:

- Login/register/logout
- Dashboard/live detection
- Violation history
- Charts
- Image/video detection
- Worker registration and face recognition
- Fine configuration
- Payroll reporting
- Alert config and alert logs
- Role-based access improvements
- Performance improvements with caching/React Query/Redux in some areas

Known or potential pending work:

- ROI polygon drawing UI and backend validation, if not fully implemented
- Video progress bar for upload detection
- Full Docker production hardening
- Final UI polish: right-side gutter, sticky navbar, consistent colors, persistent action buttons
- Strict admin-only routing if not fully enforced
- Better model retraining and accuracy evaluation

Always verify actual current status from code before assuming a feature is incomplete.

---

## 26. One-sentence project summary

SafeSite AI is a React + FastAPI + YOLO + DeepFace workplace safety platform that monitors live camera feeds, detects PPE violations, identifies workers, logs violations, sends alerts, calculates fines, and generates compliance/payroll reports.