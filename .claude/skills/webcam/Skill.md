# SafeSite AI — Fix Zero-Detection Bug in Live Camera Pipeline

## Project Context

This is SafeSite AI (FYP Project Fall25-48, University of Lahore).

**Stack:**
- Backend: FastAPI (Python 3.10+), Ultralytics YOLO, OpenCV, DeepFace/Facenet, SQLAlchemy ORM
- Frontend: React 18 + Vite + Tailwind + Recharts
- Database: PostgreSQL (prod) / SQLite (dev)
- Auth: Supabase Auth (JWT only — NOT used as database)
- Streaming: MJPEG for video, WebSocket for live detection counts
- Alerts: SMTP Email + MQTT Broker + HTTP Webhook (three channels, all logged to `alert_log` table)

**Key SRS-defined components (do not rename these):**
- `PPEDetector` — loaded once at FastAPI startup into `app.state.detector` (FR_09)
- `CameraManager` — runs async per-camera processing loops (constraint 2.2.4)
- `ViolationChecker` — enforces `persist_seconds` (1–10s) and `cooldown_seconds` (5–300s) per FR_06
- `FaceRecognizer` — DeepFace identification every 10 frames per FR_14
- `FineHandler` — creates challan records per FR_15
- `AlertDispatcher` — fans out to EmailHandler + MQTTHandler + WebhookHandler per FR_11

**Three (and only three) violation classes** per SRS section 5.2.1.5:
- `"No Hard Hat"`, `"No Safety Vest"`, `"No Mask"`

## The Bug

The webcam stream opens correctly and the MJPEG feed shows in the React dashboard, but the WebSocket detection counts stay at `Persons: 0, Hardhats: 0, Violations: 0` indefinitely. No violation is logged to the database, no fine record is created, and no row is written to `alert_log`. Detection works correctly on uploaded test images via `POST /api/v1/detect` (FR_10), so the model itself is fine — the bug is somewhere in the live camera processing loop inside `CameraManager`.

## Suspected Root Causes (Hypotheses to Verify)

1. **BGR→RGB missing** — OpenCV reads BGR, YOLO expects RGB. If this conversion is missing in the camera loop, the model silently produces near-zero confidence on every frame. This is the #1 most likely cause.
2. **No preprocessing for indoor/dark frames** — webcam frames in indoor lighting are far from YOLO training distribution.
3. **Per-camera confidence threshold (default 0.50) too strict** for borderline close-up webcam scenes.
4. **Person-centric validation suppresses violations** — `ViolationChecker` likely requires a Person box; when Person detection itself fails on the webcam, downstream NO-PPE detections get silently dropped.
5. **No diagnostics** to see where in the funnel frames are being lost.

## Your Task — Phase 1: DIAGNOSE FIRST

**Do not write any fix yet.** First, explore the repo and confirm what's actually there:

1. Find the FastAPI entrypoint (likely `main.py` or `app/main.py`) and locate the lifespan/startup function. Confirm `PPEDetector` is loaded once into `app.state.detector`.
2. Locate `CameraManager` and the per-camera processing loop (the function that reads frames in a loop, calls YOLO, and pushes counts via WebSocket).
3. Locate `PPEDetector.predict()` or whichever method runs `self.model(frame, ...)`.
4. Locate `ViolationChecker` and the logic that decides whether to log a violation.
5. Locate `AlertDispatcher` and confirm the three handlers (Email, MQTT, Webhook) and `alert_log` table writes are wired.
6. Locate the `Camera` SQLAlchemy model and confirm the fields: `id`, `name`, `source_uri`, `confidence` (or `threshold`), `roi_polygon`, `status`.

**Report back to me with:**
- File paths for each of the above components
- The exact lines where frames are passed to the YOLO model (look for `self.model(...)` or `detector.predict(...)`)
- Whether `cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)` appears anywhere in the camera loop
- The current logic in `ViolationChecker` for deciding to log (especially any `if not persons: return` pattern)
- The current frame-count handling in the WebSocket publisher

Show me what you found before making any changes.

## Your Task — Phase 2: APPLY THE FIX

After I confirm your findings, implement these changes in this order:

### Fix 1 (smallest, most likely to fully resolve it): BGR→RGB conversion
If the camera processing loop is missing `cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)` before passing the frame to YOLO, add it. This alone may completely resolve the bug.

### Fix 2: Add adaptive preprocessing
Insert a preprocessing step in the camera loop that runs BEFORE YOLO inference:
- CLAHE on the L-channel of LAB color space (clipLimit=2.5, tileGridSize=(8,8)) to normalize indoor lighting
- Bilateral filter (d=5, sigmaColor=50, sigmaSpace=50) to denoise webcam noise
- Then BGR→RGB conversion
Wrap this in a small `AdaptivePreprocessor` class for testability.

### Fix 3: Add a frame quality gate
Before preprocessing, reject frames where:
- Mean brightness < 25 (too dark) or > 230 (overexposed)
- Laplacian variance < 50 (too blurry)
On rejected frames, continue streaming the raw frame via MJPEG (don't freeze the UI) but skip YOLO inference. Track rejection counts per reason.

### Fix 4: Tiered inference in `PPEDetector.predict()`
Add a fallback retry: run YOLO at the camera's configured threshold first; if no `Person` is detected, retry once at `max(0.20, camera_threshold - 0.20)`. This recovers borderline detections without changing the admin-set threshold for normal site cameras. Do not change the method signature — keep accepting `frame` and using the per-camera threshold from the caller.

### Fix 5: Person-fallback in `ViolationChecker`
If the current logic has any pattern like:
```python
if not persons:
    return  # or continue
```
…modify it so that when:
- No `Person` box exists in the frame, BUT
- A "No Hard Hat" / "No Safety Vest" / "No Mask" detection exists with confidence >= `camera.confidence`

…the checker treats the entire frame as a person region instead of dropping the event. This handles close-up webcam scenes where only torso/head is visible. **Keep `persist_seconds` and `cooldown_seconds` logic exactly as is** — only change the "no person = drop" shortcut.

### Fix 6: Diagnostics endpoint
Add `GET /api/v1/cameras/{camera_id}/diagnostics` returning:
```json
{
  "camera_id": int,
  "frames_processed": int,
  "frames_rejected_by_reason": {"too_dark": int, "blurry": int, "overexposed": int},
  "detections_per_class_last_60s": {"Person": int, "Hardhat": int, ...},
  "person_fallback_triggered": int,
  "roi_dropped_count": int,
  "tiered_fallback_used": int,
  "last_violation_logged_per_type": {"No Hard Hat": timestamp, ...},
  "camera_threshold": float
}
```
Protect it with the existing JWT dependency used on other admin routes.

## Hard Constraints (Do Not Break)

- **Do not rename any of these classes**: `PPEDetector`, `CameraManager`, `ViolationChecker`, `FaceRecognizer`, `FineHandler`, `AlertDispatcher`, `EmailHandler`, `MQTTHandler`, `WebhookHandler`
- **Do not change** the FastAPI route paths consumed by the React frontend (`/api/v1/cameras/{id}/start`, `/api/v1/cameras/{id}/stop`, `/api/v1/violations`, `/api/v1/detect`, the MJPEG stream URL, the WebSocket URL)
- **Do not change** the SQLAlchemy models for `violations`, `fines`, `alert_log`, `workers`, `cameras`
- **Do not change** the `ViolationEvent` shape that `FineHandler` and `AlertDispatcher` consume
- **Do not change** the WebSocket payload shape that the React dashboard expects (`persons`, `hardhats`, `vests`, `violations`)
- **Do not bypass** `persist_seconds` or `cooldown_seconds` from FR_06
- **Do not regress** the image/video upload endpoint behavior (FR_10)
- **Do not load the model per-request** — keep the single shared `app.state.detector` per FR_09
- Keep the camera processing loop **async** (constraint 2.2.4) — do not introduce blocking calls into the event loop

## Acceptance Criteria

Once the fix is applied, all of these must hold:

1. Start the camera on an indoor laptop webcam → within 3 seconds, `Persons: 1` appears in the WebSocket payload and the React dashboard counters update.
2. Remove a hardhat in front of the webcam for at least `persist_seconds` → exactly one `"No Hard Hat"` row appears in the `violations` table, one fine record in `fines` with `status=pending`, and one row per configured channel in `alert_log`.
3. Repeat the violation within `cooldown_seconds` → no new row (existing cooldown behavior preserved).
4. Upload a PPE test image to `POST /api/v1/detect` → still detects correctly (no regression on FR_10).
5. `GET /api/v1/cameras/{id}/diagnostics` returns the full funnel breakdown with non-zero values across all stages.
6. All three alert channels (Email, MQTT, Webhook) still fire on each logged violation.

## Workflow

1. Start by exploring the repo and reporting what you found (Phase 1).
2. Wait for me to confirm before making edits.
3. Apply fixes incrementally — start with Fix 1 (BGR→RGB) alone and test, since that may resolve the issue without needing the other layers.
4. After each fix, run the existing tests if any exist, and tell me whether the bug appears to be resolved before moving on.
5. End by showing me the diagnostics endpoint output from a real webcam test, proving the funnel is now non-zero.