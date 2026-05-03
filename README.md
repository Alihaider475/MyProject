
## Why This Project?

Construction sites are among the most hazardous work environments. Manual supervision of PPE compliance is unreliable and resource-intensive. This project automates safety monitoring using **YOLOv8** and exposes a production-ready **FastAPI** backend — supporting multiple camera feeds, a persistent violation log, a live web dashboard, and pluggable alert channels.

---

## Features

### Detection
| Feature | Description |
|---|---|
| 🪖 **Helmet Detection** | Identifies whether workers are wearing hard hats |
| 🦺 **Vest Detection** | Detects high-visibility safety vests |
| 😷 **Mask Detection** | Monitors mask compliance on site |
| 🧍 **Person Detection** | Tracks worker presence in the frame |
| 📊 **Live Counts Overlay** | Real-time detection counts on the video feed |

### Infrastructure
| Feature | Description |
|---|---|
| 🌐 **REST API** | FastAPI backend with full CRUD, streaming, and export endpoints |
| 📷 **Multi-Camera** | Webcam, RTSP streams, and video files — unlimited concurrent feeds |
| 🗄️ **Violation Log** | Every violation saved locally to SQLite with frame snapshot |
| 📡 **Live Dashboard** | React 18 + Vite + Tailwind CSS web UI with light/dark mode, live MJPEG stream, and real-time WebSocket counts |
| 🎬 **Video Detection**| Dedicated module for uploading and analyzing pre-recorded video files |

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

# 4. Start the backend server
uvicorn app.main:app --reload

# 5. In a new terminal, start the React frontend
cd frontend
npm install
npm run dev:8000
```

Open **http://localhost:8000** for the web dashboard, or **http://localhost:8000/docs** for the interactive API.

---

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```env
# Application
APP_ENV=dev
LOG_LEVEL=INFO

# Database (SQLite)
DATABASE_URL=sqlite+aiosqlite:///./ppe_detection.db

# Model
MODEL_PATH=models/ppe.pt
DETECTION_CONFIDENCE=0.5

# Alert timing (seconds)
ALERT_COOLDOWN_SECONDS=10
```

> **Never commit `.env`** — it's already in `.gitignore`.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/health` | System health + active camera count |
| `GET` | `/api/v1/metrics` | Per-camera detection counts |
| `GET` | `/api/v1/cameras` | List all cameras |
| `POST` | `/api/v1/cameras` | Add a camera |
| `POST` | `/api/v1/cameras/{id}/start` | Start processing a camera |
| `POST` | `/api/v1/cameras/{id}/stop` | Stop processing a camera |
| `GET` | `/api/v1/violations` | Query violations (filter by camera, date, type) |
| `GET` | `/api/v1/violations/export` | Download violations as CSV |
| `GET` | `/api/v1/stream/{camera_id}` | MJPEG live video stream |
| `WS` | `/api/v1/ws/{camera_id}` | WebSocket: live detection counts (JSON) |

Full interactive docs available at `/docs` (Swagger UI) and `/redoc`.

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
┌─────────────────────────────────────────────────────────────┐
│                  FastAPI Application                        │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ CameraManager│   │  PPEDetector │   │ViolationChecker│  │
│  │ (async tasks)│──▶│  (YOLOv8)    │──▶│ (per-camera    │  │
│  │ per camera   │   │  inference   │   │  state + rules)│  │
│  └──────────────┘   └──────────────┘   └───────┬────────┘  │
│                                                 │           │
│                                        ┌────────▼────────┐  │
│                                        │   DB Handler    │  │
│                                        └─────────────────┘  │
│                                                             │
│  REST API (/api/v1/*)   MJPEG stream   WebSocket counts     │
│  SQLite Local DB        violation_frames/ (filesystem)      │
└─────────────────────────────────────────────────────────────┘
```

### Camera sources
- **Webcam** — `source_type: "webcam"`, `source_uri: "0"` (device index)
- **RTSP** — `source_type: "rtsp"`, `source_uri: "rtsp://..."`
- **Video file** — `source_type: "file"`, `source_uri: "/path/to/video.mp4"`

---

## Project Structure

```
Construction-PPE-Detection/
├── app/
│   ├── main.py                  # FastAPI app factory + lifespan
│   ├── core/
│   │   ├── config.py            # Pydantic settings (all env vars)
│   │   ├── detector.py          # YOLOv8 wrapper
│   │   ├── violation_checker.py # Business rules, per-camera state
│   │   └── frame_annotator.py   # Bounding box / overlay drawing
│   ├── camera/                  # Webcam, RTSP, file sources + manager
│   ├── api/routes/              # REST endpoints
│   ├── db/                      # SQLAlchemy models + session
│   ├── schemas/                 # Pydantic request/response models
├── frontend/                    # React/Vite/Tailwind dashboard
│   ├── src/
│   └── vite.config.js
├── models/
│   └── ppe.pt                   # YOLOv8 weights
├── requirements/
│   ├── base.txt                 # Runtime dependencies
├── .env.example                 # Config template (commit this, not .env)
└── LICENSE
```

---

## Running Tests

```bash
pip install -r requirements/dev.txt
pytest tests/ -v
```

Tests use an in-memory SQLite database and mock the YOLO model — no webcam or GPU required.

---

## Detection Classes

The model detects 10 classes:

| Class | Color |
|-------|-------|
| Hardhat | Blue |
| Mask | Green |
| NO-Hardhat | Red |
| NO-Mask | Cyan |
| NO-Safety Vest | Magenta |
| Person | Yellow |
| Safety Cone | Purple |
| Safety Vest | Olive |
| Machinery | Teal |
| Vehicle | Gray |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/your-feature`
3. **Install dev deps**: `pip install -r requirements/dev.txt`
4. **Run tests** before pushing: `pytest tests/ -v`
5. **Commit** your changes: `git commit -m 'Add some feature'`
6. **Open** a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## Requirements

- Python 3.9+
- Node.js (for the React frontend)
- See `requirements/base.txt` for the full Python dependency list

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics) for the detection backbone
- [FastAPI](https://fastapi.tiangolo.com/) for the async web framework
- The open-source computer vision community for datasets and insights

---

<div align="center">

**If this project helped you, consider giving it a star — it helps others find it!**

</div>
