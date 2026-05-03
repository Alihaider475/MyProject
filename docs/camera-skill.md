---
name: webcam-live-feed
description: >
  Use this skill whenever the user asks to build, fix, extend, or debug
  anything related to camera capture, live video feed, RTSP streams,
  MJPEG streaming, or frame acquisition in this PPE Detection System.
  Triggers include: webcam, camera source, live feed, frame capture,
  RTSP stream, CameraSource, CameraManager, VideoCapture, stream freeze,
  reconnection logic, frame lag, and multi-camera setup.
version: 1.0.0
project: Construction-PPE-Detection
module: app/camera/
license: Internal use only
---

# Webcam & Live Feed Skill

This skill governs how Claude reads, writes, debugs, and extends the
webcam and live feed module of the PPE Detection System. The camera
module is the **first stage** of the entire detection pipeline — if it
stalls, everything downstream (YOLO, alerts, dashboard) stalls with it.

---

## METADATA

| Field        | Value                                              |
|--------------|----------------------------------------------------|
| Module path  | `app/camera/`                                      |
| Entry class  | `CameraSource`                                     |
| Manager      | `CameraManager` in `app/camera/manager.py`         |
| Config file  | `app/core/config.py` (Pydantic BaseSettings)       |
| Config env   | `.env` file at project root                        |
| Dependencies | `opencv-python-headless`, `numpy`, `asyncio`       |
| Test location| `tests/unit/test_camera.py`                        |
| Consumers    | `PPEDetector`, MJPEG stream route, WebSocket route |

### Supported Source Types

| Source        | Input Format                              | OS Backend              |
|---------------|-------------------------------------------|-------------------------|
| USB Webcam    | Integer index (`0`, `1`, `2`)             | DirectShow (Win) / V4L2 (Linux) |
| RTSP Camera   | `rtsp://user:pass@ip:port/stream`         | FFMPEG                  |
| MJPEG HTTP    | `http://ip:port/video`                    | FFMPEG                  |
| Video File    | File path string (`data/test.mp4`)        | Default                 |

### Key Config Variables

| Variable                | Purpose                                      |
|-------------------------|----------------------------------------------|
| `CAMERA_SOURCE`         | Device index or stream URL                   |
| `STREAM_WIDTH`          | Capture width in pixels                      |
| `STREAM_HEIGHT`         | Capture height in pixels                     |
| `STREAM_TARGET_FPS`     | Target frame rate for the reader thread      |
| `CAMERA_RECONNECT_DELAY`| Base seconds for exponential backoff         |

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the camera module.

### Step 1 — Understand the Source Type First
Before writing or editing any camera logic, identify what source type
is being used (webcam index, RTSP URL, video file). The source type
determines which OpenCV backend to use, what failure modes to expect,
and what reconnection strategy applies. Read `CAMERA_SOURCE` from `.env`
or the config — never assume it is `0`.

### Step 2 — Check the Reader Thread Design
Confirm that frame acquisition runs in a **dedicated background thread**,
completely separate from all consumers. The thread must:
- Loop continuously calling frame reads
- Store only the **latest frame** in a single shared variable
- Use a `threading.Lock` to protect that variable on every read and write
- Never call any YOLO, alert, or streaming logic directly

If the design mixes acquisition with processing, refactor separation first
before making any other changes.

### Step 3 — Verify the Frame Buffer Is Minimized
Check that the capture object sets the internal OS frame buffer to its
minimum value immediately after opening. This is the single most important
setting for real-time performance. A default buffer causes the pipeline to
process frames that are 3–10 seconds old. Confirm this is set before
the first frame read, not after.

### Step 4 — Confirm Self-Healing Logic Exists
Every camera module must handle these failure modes silently:
- Frame read returns empty or no data
- Capture object reports open but delivers no frames (zombie stream)
- Network drop for RTSP sources
- USB disconnection for hardware cameras

The recovery strategy must use **exponential backoff** — each retry waits
longer than the last, capped at a maximum delay. Fixed-interval retries
cause CPU spikes and should be refactored on sight.

### Step 5 — Check the Async Bridge
The camera module runs in a synchronous thread. All consumers (MJPEG
stream, WebSocket, inference) run in the async FastAPI event loop.
Confirm that every point where frames cross from the sync thread to the
async side goes through `loop.run_in_executor()`. No synchronous camera
operation should ever be called directly inside an `async def`.

### Step 6 — Validate Thread Shutdown Order
When stopping a camera, the shutdown must follow this exact sequence:
1. Signal the reader thread to stop (via a stop event or flag)
2. Wait for the reader thread to finish (`thread.join()` with a timeout)
3. Release the capture object only after the thread has fully exited

Releasing the capture before the thread exits causes segmentation faults.
This order is non-negotiable.

### Step 7 — Update or Write Tests
After any change to the camera module, verify or add tests in
`tests/unit/test_camera.py`. Tests must not require physical hardware.
All camera device access must be mocked. Tests must cover:
- Normal frame delivery
- Empty frame / failed read recovery
- Reconnection after stream drop
- Thread-safe concurrent reads from multiple consumers
- Clean shutdown without resource leaks

---

## RULES

### MUST DO

- **MUST** run all frame acquisition in a dedicated background thread, never inline in an async function or the main thread
- **MUST** store only the single latest frame in a shared variable — not a queue, not a list, not a ring buffer
- **MUST** protect the shared frame variable with a threading lock on every read and every write
- **MUST** return a copy of the frame to every consumer — never the raw shared reference
- **MUST** set the capture buffer to its minimum value immediately after opening the device
- **MUST** implement exponential backoff for all reconnection attempts, with a maximum delay cap
- **MUST** set the camera health state to False when a stream fails, and back to True only after successful reconnection
- **MUST** read all camera parameters from `app/core/config.py` — never from hardcoded values
- **MUST** use `opencv-python-headless` in Docker and production environments
- **MUST** follow the shutdown order: signal stop → join thread → release capture
- **MUST** mock all hardware access in unit tests — no test should require a physical camera or GPU

### MUST NOT

- **MUST NOT** call `cap.read()`, `cv2.VideoCapture()`, or any blocking OpenCV function directly inside `async def`
- **MUST NOT** use a `queue.Queue` for frame buffering in real-time mode — queues accumulate lag
- **MUST NOT** call `cap.release()` before the reader thread has stopped
- **MUST NOT** open the same camera device index from more than one thread simultaneously
- **MUST NOT** ignore the return status from frame reads — an empty frame must trigger recovery logic
- **MUST NOT** raise unhandled exceptions from inside the reader thread — the thread must catch, log, and retry
- **MUST NOT** hardcode camera source, resolution, FPS, or reconnection timing anywhere in source files
- **MUST NOT** pass the raw shared frame reference to consumers — always pass a copy
- **MUST NOT** perform color space conversion inside the reader thread — deliver raw BGR frames; let consumers convert as needed
- **MUST NOT** add YOLO inference, violation checking, or alert logic to the camera module — it is a frame producer only

### DECISION RULES

- **Frame freshness wins**: When choosing between a stale queued frame and waiting for the next live frame, always wait for live — a stale frame is worse than a brief pause in a safety system
- **Fail silently, recover loudly**: Camera errors must not propagate as exceptions to the API or dashboard — absorb internally and expose health state via a property
- **One responsibility**: The camera module produces frames. It knows nothing about what happens to them. Any change that adds downstream logic to this module is a design violation
- **Config is the only source of truth**: If a value can change between environments (dev, staging, prod), it belongs in `.env` and `config.py` — not in the camera module

---

*This file lives at `docs/camera-skill.md`.
Claude reads it before touching any file in the `app/camera/` directory.*
