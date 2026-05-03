---
name: camera
description: >
  Handles webcam and live feed management for the PPE detection system.
  Use this skill when working on camera lifecycle (start/stop), frame
  processing loops, source backends, MJPEG streaming, or WebSocket
  broadcast. Covers CameraManager, WebcamSource, and related async patterns.
triggers:
  - camera
  - webcam
  - live feed
  - stream
  - MJPEG
  - WebSocket broadcast
  - frame loop
  - CameraManager
  - WebcamSource
  - source connect
  - CAP_DSHOW
  - read_frame
---

# Camera / Live Feed Skill

Reference: `app/camera/manager.py`, `app/camera/webcam_source.py`, `app/camera/source.py`

---

## Workflow

The camera lifecycle follows these ordered steps:

1. **API trigger** — `POST /api/v1/cameras/{id}/start` calls `CameraManager.start_camera(camera_id, source_type, source_uri)`.

2. **Guard check** — `_launch_camera` returns `False` immediately if the camera task is already running (`task and not task.done()`).

3. **Build source** — `_build_source(source_type, source_uri)` instantiates the correct `CameraSource` subclass:
   - `"webcam"` → `WebcamSource(int(source_uri))`
   - `"rtsp"` → `RTSPSource(source_uri)`
   - `"file"` → `FileSource(source_uri)`

4. **Connect** — `await source.connect()` opens the device. For `WebcamSource` on Windows, tries `CAP_DSHOW` first (lower latency), then falls back to `CAP_ANY`. Returns `False` on failure; the caller surfaces this as an error response.

5. **Register entry** — A `_CameraEntry` dataclass is stored in `_entries[camera_id]` holding the source, task handle, latest JPEG frame, latest detection counts, and `alert_sent_until` timestamp.

6. **Spawn loop task** — `asyncio.create_task(_process_loop(entry))` starts the per-camera processing loop. Task is named `camera-{id}` for debuggability.

7. **_process_loop (frame-by-frame)**:
   a. `await entry.source.read_frame()` — non-blocking; yields `None` on missed frames (sleeps 50 ms and retries).
   b. `await loop.run_in_executor(None, self.detector.detect, frame)` — YOLO inference runs in the thread pool; never blocks the event loop.
   c. Detection counts (hardhat, vest, person) are stored in `entry.latest_counts`.
   d. `self._checker.check(camera_id, detections)` — `ViolationChecker` triggers a `Violation` object only after `VIOLATION_PERSIST_SECONDS`; respects `ALERT_COOLDOWN_SECONDS`.
   e. If a violation is returned: frame is saved to `FRAMES_DIR/camera_{id}/violation_{ts}.jpg` via `run_in_executor`, `frame_path` is set as a relative forward-slash path, `AlertDispatcher.dispatch(violation)` is awaited.
   f. Frame is annotated (`annotate_frame`), optionally resized to `STREAM_WIDTH × STREAM_HEIGHT`, JPEG-encoded at `STREAM_JPEG_QUALITY`, and stored in `entry.latest_frame`.
   g. `await _broadcast(camera_id, entry.latest_counts)` — pushes counts to all WebSocket queues via `put_nowait` (drops silently on `QueueFull`).
   h. `await asyncio.sleep(1.0 / STREAM_TARGET_FPS)` — paces the loop; `sleep(0)` when FPS=0 to yield without rate-limiting.

8. **Shutdown / stop**:
   - `stop_camera(camera_id)` cancels the task, awaits it catching `CancelledError`, calls `source.release()`, removes the entry, and resets violation state via `_checker.reset(camera_id)`.
   - On app shutdown (`CameraManager.stop()`), all `is_active` flags are cleared in the DB first, then every task is cancelled in order.

9. **WebSocket subscription** — `subscribe(camera_id)` returns an `asyncio.Queue(maxsize=10)`. Callers `await q.get()` to receive count dicts. Call `unsubscribe` when the WebSocket disconnects to remove the queue.

10. **MJPEG polling** — `get_latest_frame(camera_id)` returns `bytes | None` from `entry.latest_frame`. The stream route reads this in a loop at the client's pull rate.

---

## Rules

### MUST DO

- **Always use `run_in_executor`** for every OpenCV call (`cv2.VideoCapture`, `cap.read`, `cap.release`, `cv2.imwrite`, `cv2.imencode`, `cv2.resize`). These are blocking C extensions.
- **Always wrap task cancellation** with `try/await task; except asyncio.CancelledError: pass` to ensure clean teardown.
- **Always release the source** (`await source.release()`) when stopping, even if the task was already done or cancelled.
- **Store frame paths relative to `FRAMES_DIR`** using forward slashes so the `/frames/<path>` URL works on both Windows and Linux.
- **Call `_checker.reset(camera_id)`** when stopping a camera so stale violation state does not affect the next start.
- **Respect the `_CameraEntry` dataclass** as the single source of truth for per-camera state; do not store camera state elsewhere.
- **Use `asyncio.create_task`** (not `await`) when spawning `_process_loop` so it runs concurrently alongside the event loop.
- **On Windows**, always try `CAP_DSHOW` before `CAP_ANY`; validate with a test `cap.read()` because `isOpened()` can return `True` even when the camera is privacy-blocked.

### MUST NOT

- **Do NOT call `cv2.*` directly from a coroutine** without `run_in_executor` — it will block the entire event loop.
- **Do NOT auto-start cameras on app startup** — cameras are started only on explicit user action (`POST /{id}/start`). The `CameraManager.start()` method is intentionally a no-op.
- **Do NOT access `CameraSource` directly** from outside `CameraManager`; all source interaction must go through the manager.
- **Do NOT hardcode camera config** (FPS, resolution, quality, paths) — always read from `settings.*`.
- **Do NOT raise inside `_process_loop`** without catching: unhandled exceptions kill the task silently. Log with `logger.exception` and let `CancelledError` propagate naturally.
- **Do NOT call `q.put` (blocking)** in `_broadcast`; always use `put_nowait` and catch `QueueFull` to avoid stalling the loop when a slow subscriber falls behind.
- **Do NOT share a single `CameraSource` instance** across multiple `_CameraEntry` objects.

## METADATA

| Field          | Value                                        |
|----------------|----------------------------------------------|
| Module path    | `app/camera/manager.py`                      |
| Source classes | `WebcamSource`, `RTSPSource`, `FileSource`   |
| Entry class    | `_CameraEntry`                               |
| Config file    | `app/core/config.py`                         |
| Test location  | `tests/unit/test_camera_manager.py`          |
| Stream route   | `GET /api/v1/stream/{id}`                    |
| WebSocket route| `WS /api/v1/ws/{id}`                         |

### Key Config Variables

| Variable             | Purpose                                    |
|----------------------|--------------------------------------------|
| `STREAM_TARGET_FPS`  | Loop pace — frames per second              |
| `STREAM_WIDTH`       | Output frame width after resize            |
| `STREAM_HEIGHT`      | Output frame height after resize           |
| `STREAM_JPEG_QUALITY`| JPEG compression level for stream frames   |
| `FRAMES_DIR`         | Root directory for violation snapshots     |

---

## DECISION RULES

- **CAP_DSHOW first on Windows**: Always try DirectShow before CAP_ANY
  — lower latency and avoids privacy-block false positives
- **None frame = retry, not crash**: A missed frame is normal under
  load — sleep 50ms and continue, never treat it as a fatal error
- **QueueFull = drop silently**: A slow WebSocket client must never
  stall the detection loop — drop the frame, keep moving
- **Stop before restart**: If start_camera is called on an already
  running camera, return False immediately — never spawn two loops
  for the same camera_id

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Calling `cv2.imencode()` inside `async def` without executor | Blocks event loop — all API requests freeze during encoding |
| Auto-starting cameras in `CameraManager.start()` | Activates hardware without user consent — violates explicit start rule |
| Storing camera state outside `_CameraEntry` | Creates split state — manager and caller disagree on camera status |
| Using `q.put()` instead of `put_nowait()` in broadcast | One slow WebSocket client stalls the entire detection loop |
| Sharing one `CameraSource` across two entries | Concurrent `cap.read()` calls corrupt frame data |
| Not calling `_checker.reset()` on stop | Stale cooldown blocks alerts on the very next camera start |
| Catching `CancelledError` and not re-raising | Task never actually cancels — shutdown hangs forever |