# SafeSite AI — PPE Safety Monitoring System

> **Final Year Project — BSCS Spring 2022–2026 | Project ID: Fall25-48**

An AI-powered workplace safety platform that monitors live camera feeds, detects PPE violations in real time, identifies workers through face recognition, logs violations, dispatches alerts, calculates fines, and generates compliance/payroll reports.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Environment Configuration](#environment-configuration)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [n8n Agent Integration](#n8n-agent-integration)
- [Running Tests](#running-tests)
- [Docker](#docker)
- [Requirements](#requirements)
- [Acknowledgments](#acknowledgments)

---

## Features

### Real-Time PPE Detection
- YOLOv8/YOLO11 detects 10 classes: `Person`, `Hardhat`, `NO-Hardhat`, `Mask`, `NO-Mask`, `Safety Vest`, `NO-Safety Vest`, `Safety Cone`, `Machinery`, `Vehicle`
- Hybrid violation derivation: model `NO-X` boxes + person-anchored inference for scenes the model missed
- Per-camera confidence threshold override
- Region of Interest (ROI) polygon per camera — ignores detections outside the defined zone
- OpenVINO / ONNX export auto-resolution at startup for faster CPU inference (falls back to `.pt`)
- CPU preprocessing shortcut: frames downscaled before YOLO, boxes rescaled back — no coordinate drift

### Camera Support
- USB webcam (device index)
- RTSP IP cameras (EZVIZ, Hikvision, Dahua, etc.)
- Local video files
- Unlimited concurrent camera feeds via async task manager
- Per-camera siren state: red border + alarm when unresolved violations exist

### Worker Management & Face Recognition
- Register workers with name, department, role, and face photo
- DeepFace / FaceNet face embeddings — matched on every detected person crop
- Worker identity attached to violation records automatically
- Worker self-service login, dashboard, and invite/onboarding tracker

### Violation Management
- Violations saved to database with frame snapshot
- Resolve / unresolve per record; false-positive flagging
- Filter by camera, PPE type, date range, status, worker
- Paginated table with CSV export
- 30-day heatmap, violations by type/camera/hour charts

### Fine & Payroll System
- Configurable fine amounts per violation type (hardhat, vest, mask)
- Challan (fine record) auto-generated per violation when a worker is identified
- Monthly payroll deduction report with pending / deducted / waived statuses
- PDF challan export with QR code

### Alert Dispatch

| Channel | Trigger |
|---------|---------|
| Database | Always on — every violation persisted |
| Email | SMTP via `aiosmtplib` (Gmail or any SMTP server) |
| Webhook | Generic HTTP POST or Slack Incoming Webhook |
| MQTT | Publishes violation payload to a configured broker topic |
| PLC | Modbus TCP coil write — triggers physical siren/strobe |

Each channel result is logged individually; a channel failure never rolls back the violation record.

### n8n AI Agent Integration
- **Payroll Risk Analysis Agent**: admin triggers n8n to analyse monthly violation data, score worker risk, and post results back via API
- **Safety Corrective Action Agent**: auto-creates deduplicated tasks for high-risk workers; admin marks tasks complete in the dashboard
- **Safety Action Effectiveness Agent**: n8n measures before/after violation rates once the review window closes
- 4-step workflow status diagram in the UI (risk detected → tasks created → admin acted → effectiveness measured)

### Dashboard (React)
- Live MJPEG stream per camera with letterboxed 16:9 feed and "Connecting…" spinner
- Real-time detection counts via WebSocket
- Per-camera siren badge and tile highlight on active violations
- Violations table with inline resolve/unresolve actions
- Analytics charts: violation type bar, camera bar, hourly trend line, 30-day heatmap
- Image upload detection with annotated preview and per-PPE breakdown
- Video upload detection with per-frame analysis
- Staged model-loading banner — shows which startup stage (DB ready → YOLO loaded → faces loaded → ready)
- Role-based navigation: Safety Manager dashboard vs. Admin panel (strict separation)
- Light / dark mode, toast notifications

### Security
- Supabase Auth (email/password + optional Google OAuth)
- JWT validation on every protected endpoint
- Sensitive data filter on all log handlers — masks DATABASE_URL credentials, Bearer tokens, RTSP passwords before they reach logs
- 422 validation errors strip RTSP/HTTP credentials from echoed input

---

## Tech Stack

### Frontend
| | |
|--|--|
| Framework | React 18 + Vite |
| Language | JavaScript |
| Styling | Tailwind CSS |
| Routing | React Router v6 |
| Server state | React Query (TanStack Query) |
| Client state | Redux Toolkit |
| Charts | Recharts |
| Auth | Supabase JS SDK |

### Backend
| | |
|--|--|
| Framework | FastAPI (async) |
| Language | Python 3.11+ |
| Server | Uvicorn |
| ORM | SQLAlchemy 2 (async) |
| Schema validation | Pydantic v2 |
| AI detection | Ultralytics YOLO + OpenCV |
| Face recognition | DeepFace / FaceNet (yunet detector) |
| PDF generation | ReportLab + qrcode |
| Video | aiortc / av (WebRTC / video processing) |
| Cache | Redis (optional, in-memory fallback) |

### Database
| Environment | Engine |
|-------------|--------|
| Development | SQLite via `aiosqlite` |
| Production | PostgreSQL via `asyncpg` (Supabase-hosted or self-hosted) |

### Alerts
- `aiosmtplib` — async SMTP email
- `paho-mqtt` — MQTT broker publish
- `httpx` — webhook HTTP POST
- `pymodbus` — PLC Modbus TCP coil control

---

## Project Structure

```
Construction-PPE-Detection/
├── backend/
│   ├── main.py                    # FastAPI app factory + lifespan (staged startup)
│   ├── core/
│   │   ├── config.py              # All settings via Pydantic BaseSettings
│   │   └── logging.py             # Sensitive-data log filter
│   ├── camera/
│   │   ├── manager.py             # CameraManager — async task per camera, siren state
│   │   ├── rtsp_source.py         # RTSP backend with reconnect logic
│   │   └── webcam_source.py       # USB webcam backend
│   ├── detection/
│   │   ├── detector.py            # PPEDetector — YOLO inference, OpenVINO/ONNX auto-select
│   │   ├── association.py         # Person ↔ PPE matching, violation derivation
│   │   ├── violation_checker.py   # Persistence + cooldown gate → ViolationEvent
│   │   ├── face_recognizer.py     # DeepFace embedding match
│   │   └── frame_annotator.py     # Bounding box drawing
│   ├── alerts/
│   │   ├── dispatcher.py          # Fan-out to all enabled handlers
│   │   ├── db_handler.py          # INSERT violation + fine record
│   │   ├── email_handler.py       # SMTP async email
│   │   ├── webhook_handler.py     # HTTP POST / Slack
│   │   ├── mqtt_handler.py        # MQTT publish
│   │   └── plc_handler.py         # Modbus TCP coil write
│   ├── routes/
│   │   ├── cameras.py             # Camera CRUD + start/stop
│   │   ├── violations.py          # Violation list, stats, resolve, export
│   │   ├── detect.py              # Image + video upload detection
│   │   ├── stream.py              # MJPEG stream + WebSocket counts
│   │   ├── workers.py             # Worker CRUD + face photo upload
│   │   ├── worker_self.py         # Worker self-service portal
│   │   ├── fines.py               # Fine configuration + challan records
│   │   ├── payroll_agent.py       # Payroll risk analysis + workflow-status
│   │   ├── safety_actions.py      # Corrective action tasks
│   │   ├── n8n_trigger.py         # n8n webhook trigger endpoints
│   │   ├── invite_tracker.py      # Worker invite / onboarding tracker
│   │   ├── alert_config.py        # Alert channel config
│   │   ├── alert_logs.py          # Alert dispatch logs
│   │   ├── dashboard.py           # Dashboard summary aggregate
│   │   ├── settings.py            # System settings (runtime overrides)
│   │   └── health.py              # /health + /ready (staged readiness)
│   ├── database/
│   │   ├── models.py              # SQLAlchemy models
│   │   └── connection.py          # Async engine + session factory
│   └── schemas/                   # Pydantic request/response schemas
├── frontend/
│   └── src/
│       ├── features/              # cameras/, dashboard/, violations/, workers/,
│       │                          #   fines/, safety/, charts/, detection/, auth/
│       ├── services/api/          # Axios API client
│       ├── store/                 # Redux Toolkit slices
│       └── App.jsx                # Router, layouts, global WS invalidation
├── data/
│   └── models/
│       └── ppe.pt                 # YOLO weights (not committed)
├── scripts/
│   └── export_onnx.py             # Export ppe.pt → ppe.onnx for faster CPU inference
├── docs/
│   └── n8n/                       # n8n workflow JSON exports
├── tests/
│   ├── unit/                      # Mocked YOLO, in-memory SQLite
│   └── integration/               # Live FastAPI + database tests
├── requirements/
│   ├── base.txt                   # Runtime dependencies
│   └── dev.txt                    # Test + lint dependencies
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example                   # Config template (copy to .env)
```

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- A Supabase project (free tier is sufficient) — needed for authentication
- YOLO weights at `data/models/ppe.pt` (see [Acknowledgments](#acknowledgments))

### 1 — Clone and configure

```bash
git clone https://github.com/Alihaider475/MyProject.git
cd Construction-PPE-Detection

cp .env.example .env
# Edit .env — minimum required: DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
# SUPABASE_JWT_SECRET, and MODEL_PATH
```

### 2 — Backend setup (Windows PowerShell)

```powershell
# Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate

# Install PyTorch CPU-only first (required — avoids pip pulling CUDA wheels)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies
pip install -r requirements/base.txt

# Start the backend
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 3 — Frontend setup

```powershell
cd frontend
npm install
npm run dev
```

| Service | URL |
|---------|-----|
| Backend API | http://localhost:8000 |
| React dev server | http://localhost:5173 |
| Swagger UI | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |
| Readiness probe | http://localhost:8000/api/v1/ready |

### 4 — Optional: faster CPU inference with ONNX

```powershell
# Export once — creates data/models/ppe.onnx
python scripts/export_onnx.py

# The backend auto-detects ppe.onnx at startup and uses onnxruntime instead of PyTorch
```

### Production build (React served by FastAPI)

```powershell
cd frontend
npm run build        # outputs to frontend/dist/
cd ..
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# React app is served at http://localhost:8000
```

---

## Environment Configuration

Copy `.env.example` to `.env`. Variables marked **required** must be set before starting.

```env
# ── Application ────────────────────────────────────────────────────
APP_ENV=prod              # dev | prod
LOG_LEVEL=INFO

# ── Database ── REQUIRED ───────────────────────────────────────────
# Dev: sqlite+aiosqlite:///./ppe_detection.db
# Prod: postgresql+asyncpg://user:password@host:5432/safesite
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/safesite

# ── Redis (optional — in-memory fallback if unset) ─────────────────
REDIS_URL=redis://localhost:6379/0

# ── Supabase Auth ── REQUIRED ──────────────────────────────────────
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# ── YOLO Model ─────────────────────────────────────────────────────
MODEL_PATH=data/models/ppe.pt    # or data/models/ppe.onnx
DETECTION_CONFIDENCE=0.25
VIOLATION_CONFIDENCE=0.25
ENABLE_HARDHAT_COLOR_VETO=false

# ── Streaming ──────────────────────────────────────────────────────
STREAM_WIDTH=640
STREAM_HEIGHT=480
STREAM_TARGET_FPS=15

# ── Email Alerts ───────────────────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=alerts@yourcompany.com
SMTP_PASSWORD=your-gmail-app-password   # use App Password, not account password
SENDER_EMAIL=alerts@yourcompany.com
RECEIVER_EMAIL=manager@yourcompany.com

# ── MQTT Alerts (optional) ─────────────────────────────────────────
MQTT_BROKER=localhost
MQTT_PORT=1883
MQTT_TOPIC=safesite/violations

# ── Webhook / Slack Alerts (optional) ─────────────────────────────
WEBHOOK_URL=
SLACK_WEBHOOK_URL=

# ── Fines ──────────────────────────────────────────────────────────
FINES_ENABLED=true
DEFAULT_HARDHAT_FINE=500.0
DEFAULT_VEST_FINE=300.0
DEFAULT_MASK_FINE=200.0

# ── n8n Agent Integration ──────────────────────────────────────────
# Generate: python -c "import secrets; print(secrets.token_urlsafe(48))"
N8N_PAYROLL_AGENT_API_KEY=replace-with-long-random-string
N8N_SAFETY_ACTION_AGENT_API_KEY=replace-with-different-long-random-string
N8N_PAYROLL_WORKFLOW_WEBHOOK_URL=https://your-n8n.app.n8n.cloud/webhook/payroll-risk
N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL=https://your-n8n.app.n8n.cloud/webhook/safety-effectiveness
EFFECTIVENESS_REVIEW_WINDOW_DAYS=7   # 0 = immediate (demo mode)
```

> **Never commit `.env`** — it is already listed in `.gitignore`.

---

## Architecture

### Detection pipeline

```
POST /api/v1/cameras/{id}/start
        │
        ▼
  CameraManager ──► Camera source (webcam / RTSP / file)
        │                 │ raw frames at STREAM_TARGET_FPS
        │           ◄─────┘
        │ every DETECTION_FRAME_STRIDE-th frame
        ▼
  PPEDetector (YOLO — runs in thread pool, non-blocking)
  • auto-selects OpenVINO → ONNX → .pt
  • CPU preprocessing downscale (YOLO_PREPROCESS_MAX_WIDTH)
        │
        ▼
  association.py
  • Person ↔ PPE IoU matching
  • Hybrid violation derivation (model NO-X + inferred)
        │
        ▼
  ViolationChecker
  • persist after VIOLATION_PERSIST_SECONDS
  • per-(track, type) cooldown
  • siren_active flag per camera
        │
        ▼
  AlertDispatcher ──► DB (always)
                  ──► Email / Webhook / MQTT / PLC (if configured)
                  ──► WebSocket broadcast to React dashboard
```

### Startup stages (tracked at `/api/v1/ready`)

```
backend_started → database_ready → yolo_loaded → yolo_warmed
    → face_model_ready → known_faces_loaded → ready
```

Each stage includes a timing in milliseconds. The frontend model-loading banner polls this endpoint and advances through stages visually.

### WebSocket payload (per frame)

```json
{
  "person": 2,
  "hardhat": 1,
  "no_hardhat": 1,
  "vest": 2,
  "no_vest": 0,
  "mask": 0,
  "no_mask": 0,
  "detections": [...],
  "siren_active": true
}
```

---

## API Reference

Base path: `/api/v1` — full interactive docs at `/docs`.

### Health & Readiness
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | — | System status, active camera count, DB connectivity |
| `GET` | `/ready` | — | Staged model-loading status with per-stage timings |

### Cameras
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/cameras` | JWT | List all cameras |
| `POST` | `/cameras` | JWT | Add a camera (webcam / RTSP / file) |
| `GET` | `/cameras/{id}` | JWT | Get a camera |
| `PUT` | `/cameras/{id}` | JWT | Update name, URI, confidence, ROI polygon |
| `DELETE` | `/cameras/{id}` | JWT | Delete a camera |
| `POST` | `/cameras/{id}/start` | JWT | Start inference on a camera |
| `POST` | `/cameras/{id}/stop` | JWT | Stop inference |
| `GET` | `/stream/{id}` | — | MJPEG live video stream |
| `WS` | `/ws/{id}` | — | WebSocket — real-time detection counts + siren state |

### Violations
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/violations` | JWT | List violations (paginated, filterable) |
| `GET` | `/violations/stats` | JWT | Aggregated stats for charts |
| `GET` | `/violations/export` | JWT | Download CSV |
| `POST` | `/violations/{id}/resolve` | JWT | Mark as resolved |
| `POST` | `/violations/{id}/unresolve` | JWT | Unmark resolved |
| `POST` | `/violations/{id}/flag-false-positive` | JWT | Flag false positive |
| `POST` | `/violations/{id}/unflag-false-positive` | JWT | Remove flag |

### Upload Detection
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/detect/classes` | JWT | List detectable classes |
| `POST` | `/detect/image` | JWT | Detect PPE in an uploaded image (max 10 MB) |
| `POST` | `/detect/video` | JWT | Detect PPE in an uploaded video (max 200 MB) |

### Workers & Face Recognition
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/workers` | JWT (admin) | List all workers |
| `POST` | `/workers` | JWT (admin) | Register a worker |
| `PUT` | `/workers/{id}` | JWT (admin) | Update worker details |
| `DELETE` | `/workers/{id}` | JWT (admin) | Hard-delete a worker |
| `POST` | `/workers/{id}/photo` | JWT (admin) | Upload face photo + generate embedding |

### Fines & Payroll
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/fines/config` | JWT (admin) | Get fine amounts per violation type |
| `PUT` | `/fines/config` | JWT (admin) | Update fine amounts |
| `GET` | `/fines/challans` | JWT (admin) | List all challans (filterable by month/worker) |
| `GET` | `/payroll-agent/monthly-summary` | JWT (admin) | Monthly per-worker fine summary |
| `GET` | `/payroll-agent/workflow-status` | JWT | 4-step n8n automation progress for a month |
| `POST` | `/payroll-agent/run` | JWT (admin) | Trigger n8n payroll risk analysis |

### Safety Actions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/admin/safety-actions` | JWT (admin) | List corrective action tasks |
| `POST` | `/admin/safety-actions/{id}/complete` | JWT (admin) | Mark task as completed |
| `GET` | `/admin/safety-actions/effectiveness/{id}` | JWT (admin) | View effectiveness log |

### Alert Configuration
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/alert-config` | JWT (admin) | Get alert channel settings |
| `PUT` | `/alert-config` | JWT (admin) | Update alert channel settings |
| `GET` | `/alert-logs` | JWT | Paginated alert dispatch history |

---

## n8n Agent Integration

SafeSite AI integrates with three n8n cloud workflows that are triggered from the Admin panel.

### Workflow 1 — Payroll Risk Analysis

1. Admin clicks **Run Analysis** on the Payroll Report page for a selected month.
2. Backend posts `{ month: "YYYY-MM" }` to `N8N_PAYROLL_WORKFLOW_WEBHOOK_URL`.
3. n8n fetches violation + fine data from `/payroll-agent/monthly-summary`, scores each worker's risk level, and posts the result back to `/admin/payroll-agent/risk-analysis`.
4. High-risk workers are surfaced in the UI with risk scores and trend indicators.

### Workflow 2 — Safety Corrective Actions

1. Payroll Risk Analysis completion triggers n8n to create tasks via `/admin/safety-actions/agent/tasks`.
2. Deduplication prevents multiple tasks per worker per month.
3. Admin reviews tasks in the Safety Actions page and marks them complete.

### Workflow 3 — Safety Action Effectiveness

1. After `EFFECTIVENESS_REVIEW_WINDOW_DAYS` days, n8n posts `{ task_id, month }` to `N8N_SAFETY_EFFECTIVENESS_WEBHOOK_URL`.
2. n8n calls `/admin/safety-actions/agent/effectiveness/{task_id}` to read before/after violation counts.
3. Effectiveness results are shown per task alongside percentage change.

### n8n API keys

Generate secure random keys and set them in `.env`:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

The n8n workflows must send `Authorization: Bearer <key>` on every callback request. Keys are validated in FastAPI middleware — never returned to the frontend.

---

## Running Tests

```powershell
# Activate virtual environment first
.venv\Scripts\activate

# All unit tests
.venv\Scripts\python.exe -m pytest tests/unit -q

# Specific modules
.venv\Scripts\python.exe -m pytest tests/unit/test_violation_checker.py tests/unit/test_association.py -v

# Integration tests (requires a running database — see tests/integration/README)
.venv\Scripts\python.exe -m pytest tests/integration -v

# All tests
.venv\Scripts\python.exe -m pytest tests/ -v
```

Unit tests use an in-memory SQLite database and mock the YOLO model — no webcam or GPU required.

---

## Docker

```bash
# Development (hot-reload, SQLite, no Redis required)
docker compose -f docker-compose.dev.yml up --build

# Production (PostgreSQL + Redis + Uvicorn)
docker compose up --build
```

Services:
| Service | Port |
|---------|------|
| FastAPI backend | 8000 |
| React frontend (Vite dev) | 5173 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## Requirements

- Python 3.11+
- Node.js 18+
- A Supabase project (free tier) for authentication
- YOLO weights (`data/models/ppe.pt`) — see Acknowledgments below
- PyTorch CPU wheels installed separately before `requirements/base.txt` (see Quick Start)

Optional for faster inference:
- `onnxruntime` — already in `requirements/base.txt`; export once with `scripts/export_onnx.py`
- `openvino` — `pip install openvino`; export once and place in `data/models/ppe_openvino_model/`

---

## Acknowledgments

- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) — detection backbone
- [Roboflow Construction Site Safety Dataset](https://universe.roboflow.com/roboflow-universe-projects/construction-site-safety) — model training data
- [DeepFace](https://github.com/serengil/deepface) — face recognition and embedding extraction
- [FastAPI](https://fastapi.tiangolo.com/) — async web framework
- [Supabase](https://supabase.com/) — authentication and hosted PostgreSQL
- [Recharts](https://recharts.org/) — dashboard charts
- [n8n](https://n8n.io/) — workflow automation for the AI agent pipelines

---

*SafeSite AI — React + FastAPI + YOLO + DeepFace workplace safety platform.*
*BSCS Final Year Project, Spring 2022–2026.*
