# CLAUDE.md

This file guides Claude Code when working in this repository.


# Project Overview

This is a **Real-Time PPE Detection System** built with:

* FastAPI (backend)
* YOLO (object detection)
* Async camera processing
* Alert system (email, webhook, MQTT, PLC)

The system detects safety violations (e.g., no hardhat) from live camera feeds and triggers alerts.

# Setup Commands

## Install

```bash
pip install -r requirements/base.txt
pip install -r requirements/dev.txt
```

## Run (Development)

```bash
cp .env.example .env
uvicorn app.main:app --reload
```

## Quick Demo (No API / DB)

```bash
python quickstart_demo.py
```

## Tests

```bash
pytest
pytest tests/unit/ -v
pytest tests/integration/ -v
```

## Lint

```bash
ruff check .
ruff check . --fix
```

---

# Project Structure

```
app/
 ├── api/              # FastAPI routes
 ├── alerts/           # Alert handlers
 ├── core/             # Config & settings
 ├── db/               # Database models
 ├── detection/        # YOLO logic
 ├── camera/           # Camera management
 └── main.py           # Entry point
```

---

# 🚀 Architecture Overview

## Entry Point

* `app/main.py`
* Loads:

  * `PPEDetector`
  * Database
  * `CameraManager`

⚠️ Cameras are NOT auto-started.

---

## Detection Pipeline

1. API call:

   ```
   POST /api/v1/cameras/{id}/start
   ```
2. Camera stream starts
3. Frames read asynchronously
4. YOLO runs in thread pool (non-blocking)
5. `ViolationChecker` detects violations
6. `AlertDispatcher` sends alerts

---

## Alert System

Handlers:

* Database (always ON)
* Email
* Webhook
* MQTT
* PLC

### Adding New Handler

1. Subclass `AlertHandler`
2. Register in `CameraManager`

---

#  API Endpoints

Base: `/api/v1`

* Cameras → CRUD + start/stop
* Stream → MJPEG + WebSocket
* Violations → list + resolve
* Detect → image upload
* Health → status check

---

# Testing Strategy

* Uses `pytest-asyncio`
* YOLO and camera are mocked
* No GPU required

---

# Development Guidelines

## Code Style

* Python 3.11+
* Use type hints
* Use `from __future__ import annotations`

## Async Rules

* Never block event loop
* Use:

```python
loop.run_in_executor()
```

## File Handling

* Use relative paths
* Use forward slashes

---

#  Key Concepts

## Violation Logic

* Trigger after:

  * `VIOLATION_PERSIST_SECONDS`
* Cooldown:

  * `ALERT_COOLDOWN_SECONDS`

---

# Configuration

Managed via `.env`

Important variables:

* `MODEL_PATH`
* `DETECTION_CONFIDENCE`
* `DATABASE_URL`
* `STREAM_TARGET_FPS`

Optional:

* Email → `SENDER_EMAIL`
* Webhook → `WEBHOOK_URL`
* MQTT → `MQTT_BROKER`
* PLC → `PLC_HOST`

---

# Common Tasks

## Add Feature

1. Add logic
2. Update API
3. Add tests
4. Run lint

## Debug Camera

* Check source
* Check FPS
* Check thread blocking

## Debug Alerts

* Check `.env`
* Check logs

---

# What NOT To Do

* Do NOT block async loop
* Do NOT access camera outside manager
* Do NOT hardcode config

---

# Claude Instructions

* Prefer async-safe solutions
* Keep code modular
* Do not break detection pipeline
* Update tests if needed
* Explain changes clearly

---

# Notes

Model path:

```
Model/ppe.pt
```

Classes:

* Hardhat / NO-Hardhat
* Mask / NO-Mask
* Safety Vest / NO-Safety Vest
* Person, Vehicle, Machinery, Cone
