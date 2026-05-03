# Construction PPE Detection System

A real-time Personal Protective Equipment (PPE) compliance monitoring system for construction sites. It uses **YOLOv8** for object detection, a **FastAPI** async backend, and a **React 18 + Vite + Tailwind CSS** dashboard.

---

## Features

### Detection
- Detects 10 classes: Hardhat, NO-Hardhat, Mask, NO-Mask, Safety Vest, NO-Safety Vest, Person, Safety Cone, Machinery, Vehicle
- Runs YOLO inference in a thread pool (non-blocking async)
- Per-camera confidence threshold override
- Region of Interest (ROI) polygon per camera — only detects inside defined area
- Live bounding box overlay with detection counts on the stream

### Camera Support
- Webcam (device index)
- RTSP network streams
- Local video files
- Unlimited concurrent camera feeds via async task manager

### Upload-Based Detection
- Single image upload with annotated preview and per-PPE compliance breakdown
- Video file upload (mp4, avi, mov, mkv, webm) with frame-sampled analysis and per-frame results

### Violation Management
- Violations saved to SQLite with frame snapshot
- Resolve / unresolve violations
- Flag / unflag false positives
- Filter by camera, type, date range, resolved status
- Paginated list with CSV export
- Stats API: by violation type, by camera, hourly trend, 30-day heatmap

### Alert System
| Handler | Trigger |
|---|---|
| Database | Always on — every violation is persisted |
| Email | SMTP via aiosmtplib (Gmail or any SMTP server) |
| Webhook | Generic HTTP POST + Slack Incoming Webhook |
| MQTT | Publishes violation payload to a broker topic |
| PLC | Modbus TCP coil control (siren / strobe trigger) |

### Dashboard (React)
- Live MJPEG stream per camera
- Real-time detection counts via WebSocket
- Violations table with filtering, resolve/unresolve, false-positive flagging
- Charts page: violations by type (bar), by camera (bar), hourly trend (line), 30-day heatmap
- Image detect page: upload an image, view annotated result and PPE breakdown
- Video detect page: upload a video, view per-frame analysis
- Light / dark mode toggle
- Toast notifications

---

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/Ansarimajid/Construction-PPE-Detection.git
cd Construction-PPE-Detection

# 2. Install backend dependencies
pip install -r requirements/base.txt

# 3. Configure environment
cp .env.example .env
# Edit .env and set MODEL_PATH and any alert credentials

# 4. Start the backend
uvicorn app.main:app --reload

# 5. In a new terminal, start the React dev server
cd frontend
npm install
npm run dev
```

- Backend API: `http://localhost:8000`
- React dev server: `http://localhost:5173`
- Swagger UI: `http://localhost:8000/docs`

To serve the React app from the FastAPI backend (production mode):

```bash
cd frontend
npm run build        # outputs to dist/
cd ..
uvicorn app.main:app # serves dist/ at http://localhost:8000
```

---

## Configuration

Copy `.env.example` to `.env` and fill in values:

```env
# Application
APP_ENV=dev
LOG_LEVEL=INFO

# Database (SQLite)
DATABASE_URL=sqlite+aiosqlite:///./ppe_detection.db

# Model
MODEL_PATH=models/ppe.pt
DETECTION_CONFIDENCE=0.5

# Violation timing (seconds)
VIOLATION_PERSIST_SECONDS=10
ALERT_COOLDOWN_SECONDS=10

# Stream output
STREAM_WIDTH=960
STREAM_HEIGHT=540
STREAM_JPEG_QUALITY=80
STREAM_TARGET_FPS=15.0

# Email alerts (optional)
SENDER_EMAIL=
RECEIVER_EMAIL=
EMAIL_PASSWORD=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587

# Webhook / Slack alerts (optional)
WEBHOOK_URL=
SLACK_WEBHOOK_URL=

# MQTT alerts (optional)
MQTT_BROKER=
MQTT_PORT=1883
MQTT_TOPIC=ppe/violations/camera_{camera_id}

# PLC / Modbus TCP alerts (optional)
PLC_HOST=
PLC_PORT=502
PLC_COIL_ADDRESS=0
PLC_COIL_DURATION=5.0
```

> Never commit `.env` — it is already in `.gitignore`.

---

## API Reference

Base path: `/api/v1`

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | System status and active camera count |

### Cameras
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cameras` | List all cameras |
| `POST` | `/cameras` | Add a camera |
| `GET` | `/cameras/{id}` | Get a camera |
| `PUT` | `/cameras/{id}` | Update name, URI, confidence, or ROI polygon |
| `DELETE` | `/cameras/{id}` | Delete a camera |
| `POST` | `/cameras/{id}/start` | Start processing a camera |
| `POST` | `/cameras/{id}/stop` | Stop processing a camera |

### Violations
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/violations` | List violations (filter by camera, type, date, resolved) |
| `GET` | `/violations/stats` | Aggregated stats for dashboard charts |
| `GET` | `/violations/export` | Download violations as CSV |
| `GET` | `/violations/{id}` | Get a single violation |
| `POST` | `/violations/{id}/resolve` | Mark violation as resolved |
| `POST` | `/violations/{id}/unresolve` | Unmark resolved |
| `POST` | `/violations/{id}/flag-false-positive` | Flag as false positive |
| `POST` | `/violations/{id}/unflag-false-positive` | Remove false positive flag |

### Detection (Upload)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/detect/classes` | List all classes the model can detect |
| `POST` | `/detect/image` | Run detection on an uploaded image (max 10 MB) |
| `POST` | `/detect/video` | Run detection on an uploaded video (max 200 MB) |

### Stream
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/stream/{camera_id}` | MJPEG live video stream |
| `WS` | `/ws/{camera_id}` | WebSocket: real-time detection counts (JSON) |

Full interactive docs: `/docs` (Swagger UI) and `/redoc`.

### Example: Add and start a webcam

```bash
# Add camera
curl -X POST http://localhost:8000/api/v1/cameras \
  -H "Content-Type: application/json" \
  -d '{"name": "Site Entrance", "source_type": "webcam", "source_uri": "0"}'

# Start it (use the id returned above)
curl -X POST http://localhost:8000/api/v1/cameras/1/start

# Stream in browser
open http://localhost:8000/api/v1/stream/1
```

### Example: Add an RTSP camera

```bash
curl -X POST http://localhost:8000/api/v1/cameras \
  -H "Content-Type: application/json" \
  -d '{"name": "Gate Camera", "source_type": "rtsp", "source_uri": "rtsp://192.168.1.100/stream"}'
```

---

## Architecture

```
Construction-PPE-Detection/
├── app/
│   ├── main.py                   # FastAPI app factory + lifespan
│   ├── core/
│   │   ├── config.py             # Pydantic settings (all env vars)
│   │   ├── detector.py           # YOLOv8 wrapper (PPEDetector)
│   │   ├── violation_checker.py  # Business rules, persist + cooldown logic
│   │   └── frame_annotator.py    # Bounding box / overlay drawing
│   ├── camera/
│   │   ├── manager.py            # CameraManager (async task per camera)
│   │   ├── webcam_source.py      # Webcam backend
│   │   ├── rtsp_source.py        # RTSP backend
│   │   └── file_source.py        # Video file backend
│   ├── alerts/
│   │   ├── base.py               # AlertHandler base class
│   │   ├── dispatcher.py         # AlertDispatcher (fan-out to all handlers)
│   │   ├── db_handler.py         # Persist to SQLite
│   │   ├── email_handler.py      # SMTP email
│   │   ├── webhook_handler.py    # HTTP POST / Slack
│   │   ├── mqtt_handler.py       # MQTT broker publish
│   │   └── plc_handler.py        # Modbus TCP coil control
│   ├── api/routes/
│   │   ├── cameras.py            # Camera CRUD + start/stop
│   │   ├── violations.py         # Violation list, stats, resolve, export
│   │   ├── detect.py             # Image + video upload detection
│   │   ├── stream.py             # MJPEG + WebSocket
│   │   └── health.py             # Health check
│   ├── db/
│   │   ├── models.py             # SQLAlchemy models (Camera, Violation, AlertLog)
│   │   └── session.py            # Async session factory + init_db
│   └── schemas/                  # Pydantic request/response models
├── frontend/
│   ├── src/
│   │   ├── pages/                # Dashboard, ViolationsPage, ChartsPage, DetectPage, VideoDetectPage
│   │   ├── components/           # CameraGrid, LiveFeed, ViolationsTable, ViolationChart, etc.
│   │   ├── context/              # ThemeContext, ToastContext
│   │   └── api/client.js         # Axios API client
│   └── vite.config.js
├── models/
│   └── ppe.pt                    # YOLOv8 weights
├── requirements/
│   ├── base.txt                  # Runtime dependencies
│   └── dev.txt                   # Test + lint dependencies
├── tests/
│   ├── unit/                     # Unit tests (mocked YOLO, in-memory DB)
│   └── integration/              # Integration tests
└── .env.example                  # Config template
```

### Detection pipeline

```
POST /api/v1/cameras/{id}/start
        |
        v
  CameraManager  -->  Camera source (webcam / RTSP / file)
        |
        v
  PPEDetector (YOLOv8, runs in thread pool)
        |
        v
  ViolationChecker  -->  persist after VIOLATION_PERSIST_SECONDS
        |                cooldown enforced per camera
        v
  AlertDispatcher  -->  DB + Email + Webhook + MQTT + PLC
```

---

## Detection Classes

The model detects 10 classes:

| Class | Color |
|-------|-------|
| Hardhat | Blue |
| NO-Hardhat | Red |
| Mask | Green |
| NO-Mask | Cyan |
| Safety Vest | Olive |
| NO-Safety Vest | Magenta |
| Person | Yellow |
| Safety Cone | Purple |
| Machinery | Teal |
| Vehicle | Gray |

---

## Running Tests

```bash
pip install -r requirements/dev.txt
pytest tests/ -v
pytest tests/unit/ -v
pytest tests/integration/ -v
```

Tests use an in-memory SQLite database and mock the YOLO model — no webcam or GPU required.

---

## Linting

```bash
ruff check .
ruff check . --fix
```

---

## Requirements

- Python 3.11+
- Node.js 18+ (for the React frontend)
- See `requirements/base.txt` for the full Python dependency list

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics) for the detection backbone
- [FastAPI](https://fastapi.tiangolo.com/) for the async web framework
- [Recharts](https://recharts.org/) for the dashboard charts
