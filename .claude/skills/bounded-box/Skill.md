Role: Act as an expert Full-Stack Computer Vision Engineer specializing in FastAPI, React.js, YOLO/Ultralytics, OpenCV, WebSocket streaming, and low-latency real-time video pipelines.

Project Context:
I am working on SafeSite AI, a real-time PPE detection dashboard. The backend uses FastAPI, OpenCV, and YOLO/Ultralytics for live PPE detection. The frontend uses React.js and displays a live camera feed with an HTML5 canvas overlay for bounding boxes received through WebSocket.

Current Bugs:

1. Severe inference latency / stale frame processing:
   Bounding boxes trail behind moving workers by around 0.5 to 1.0 seconds and update in a choppy/stuttering way. This suggests the backend may be processing old queued frames instead of always processing the latest available camera frame.

2. Bounding box coordinate mismatch:
   The bounding boxes are visually shifted downward. For example, a “NO-Mask” box appears around the chest instead of the face. This may be caused by a coordinate-space mismatch between:

   * original camera frame size,
   * YOLO inference input size,
   * any resized/letterboxed/padded frame,
   * WebSocket box coordinates,
   * rendered browser video size,
   * frontend canvas size.

Important Coordinate Warning:
Do not assume the boxes are definitely in 640x640 model-space coordinates. Terminal logs show boxes like `[672, 290, 945, 498]`, which may indicate original source-frame coordinates from a larger frame such as 1280x720. First inspect the actual coordinate space. Determine whether Ultralytics is returning original-frame coordinates, resized-frame coordinates, or manually letterboxed coordinates. Only apply inverse letterbox math if the backend is actually sending padded/model-space coordinates.

Strict Workflow:

1. Do not edit any files yet.
2. First inspect the relevant files and explain the current implementation.
3. Search and inspect:

   * Backend camera capture loop.
   * Backend frame queue/buffering logic.
   * Backend YOLO inference loop.
   * Backend coordinate extraction and WebSocket payload generation.
   * Frontend WebSocket detection handling.
   * React video element rendering.
   * React canvas overlay drawing and scaling logic.
4. Explain exactly:

   * Where stale-frame latency is introduced.
   * Whether frames are queued, buffered, or processed synchronously.
   * What coordinate space YOLO boxes are currently in.
   * What coordinate space the frontend assumes.
   * Why the boxes are shifted.
5. Provide a file-by-file fix plan.
6. Wait for my approval before modifying any code.
7. Do not touch unrelated features such as DeepFace, alerts, auth, routing, database schema, worker management, fine configuration, or reports.

Required Fix 1: Latest-Frame-Only Backend Capture
Refactor the backend live camera pipeline so it prioritizes low latency over processing every frame.

Requirements:

* Run video capture in a separate background thread or equivalent non-blocking loop.
* Continuously read frames from the camera.
* Keep only the absolute newest frame.
* Use either:

  * a shared latest-frame variable protected by a lock, or
  * `Queue(maxsize=1)` where old frames are dropped before adding a new one.
* The YOLO inference loop must always process the newest available frame.
* Old/stale frames must be discarded.
* Do not allow a growing frame queue.
* Add lightweight debug logs showing when stale frames are dropped or when the latest frame is used.

Goal:
Bounding boxes should track the currently visible frame with minimal delay instead of lagging behind because of queued frame processing.

Required Fix 2: Correct Coordinate Space Handling
Fix backend coordinate generation only after confirming the actual coordinate space.

Requirements:

* Inspect how frames are passed into YOLO.
* Confirm whether YOLO receives:

  * original frame,
  * resized frame,
  * manually letterboxed 640x640 frame,
  * or another transformed frame.
* Confirm whether the emitted boxes are:

  * original source-frame coordinates,
  * model input coordinates,
  * letterboxed/padded coordinates,
  * or already normalized coordinates.
* Standardize the WebSocket payload so every detection includes corrected source-frame coordinates.
* The WebSocket payload must include:

  * `source_width`
  * `source_height`
  * corrected `x1`, `y1`, `x2`, `y2`
  * `label`
  * `confidence`
  * `camera_id`

Only if boxes are proven to be in padded/model input coordinates, convert them back to original source-frame coordinates using inverse letterbox math:

```python
scale = min(input_w / orig_w, input_h / orig_h)
pad_x = (input_w - orig_w * scale) / 2
pad_y = (input_h - orig_h * scale) / 2

x1_orig = (x1_padded - pad_x) / scale
y1_orig = (y1_padded - pad_y) / scale
x2_orig = (x2_padded - pad_x) / scale
y2_orig = (y2_padded - pad_y) / scale
```

Then clamp the coordinates:

```python
x1_orig = max(0, min(orig_w, x1_orig))
y1_orig = max(0, min(orig_h, y1_orig))
x2_orig = max(0, min(orig_w, x2_orig))
y2_orig = max(0, min(orig_h, y2_orig))
```

If Ultralytics is already returning original-frame coordinates, do not apply inverse letterbox conversion. In that case, fix the frontend scaling/layout instead.

Required Fix 3: Responsive Frontend Canvas Scaling
Fix the React canvas overlay so it exactly matches the rendered video element.

Requirements:

* Use a `videoRef` for the video element.
* Use a `canvasRef` for the canvas overlay.
* Use `getBoundingClientRect()` to get the actual rendered video dimensions.
* Use a `ResizeObserver` or reliable resize/update loop so resizing the browser keeps the overlay aligned.
* Set the canvas internal pixel size to match the displayed video size.
* Position the canvas absolutely over the video.
* Use the backend-provided `source_width` and `source_height` to scale boxes:

```javascript
const rect = videoRef.current.getBoundingClientRect();

const scaleX = rect.width / source_width;
const scaleY = rect.height / source_height;

const drawX = x1 * scaleX;
const drawY = y1 * scaleY;
const drawW = (x2 - x1) * scaleX;
const drawH = (y2 - y1) * scaleY;
```

* Make sure canvas CSS and video CSS use the same dimensions and positioning.
*Ensure the <video> and <canvas> share the exact same parent container, which should have position: relative. The video and canvas should both have position: absolute, top: 0, left: 0, width: 100%, height: 100%, and object-fit: cover or fill to guarantee their coordinate grids perfectly overlap without browser-rendered letterboxing.

Debug Logging Required:
Add useful logs without spamming too much:

Backend:

* `[CAPTURE] latest frame updated`
* `[CAPTURE] stale frame dropped`
* `[INFERENCE] processing frame timestamp=...`
* `[DETECTIONS_RAW] boxes before coordinate correction`
* `[DETECTIONS_WS] boxes sent to frontend with source_width/source_height`

Frontend:

* Log once when video/canvas dimensions change:

  * rendered video width/height
  * canvas width/height
  * source_width/source_height
  * scaleX/scaleY

Constraints:

* Do not rewrite unrelated code.
* Preserve existing API response formats unless the WebSocket payload must be extended with `source_width` and `source_height`.
* Do not break image/video upload detection.
* Do not change database schema.
* Do not modify DeepFace, alerts, auth, routing, worker management, reports, or fine configuration.
* Keep changes small, targeted, and testable.

Testing:
After implementation, run the relevant backend and frontend checks:

* Backend unit tests if available.
* Frontend build.
* Manual live camera test.

Acceptance Criteria:

1. Bounding boxes track the latest visible frame with minimal noticeable lag.
2. Moving your face/body should not cause boxes to trail behind by 0.5–1.0 seconds.
3. “NO-Mask” box should align with the face area, not the chest.
4. Person/PPE boxes should remain locked to the correct objects.
5. Resizing the browser window should not break overlay alignment.
6. Stopping and starting the camera should not create stale-frame buildup.
7. WebSocket payload includes `source_width` and `source_height`.
8. Frontend canvas dimensions exactly match the rendered video dimensions.
9. No unrelated project features are changed.

Final Response Required:
After completing the approved implementation, provide:

* Files changed.
* Summary of root cause.
* Explanation of the latency fix.
* Explanation of the coordinate fix.
* Commands/tests run.
* Manual verification steps.
