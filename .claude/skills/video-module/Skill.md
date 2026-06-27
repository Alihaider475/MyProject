---

name: video-module
description: Optimize SafeSite AI video upload processing in backend/detection/video_jobs.py. Use when video uploads are processing too slowly due to naive OpenCV decoding, slow YOLO CPU inference, or thread starvation from live camera executors.
disable-model-invocation: true
argument-hint: "[optional video performance issue or benchmark details]"
------------------------------------------------------------------------

# Fast Video Job Optimization

## Role

Act as an expert Python Backend and Computer Vision Engineer working on the SafeSite AI PPE detection project.

## Objective

Optimize `backend/detection/video_jobs.py` so short uploaded videos process quickly. A 13-second clip should complete in seconds, not several minutes.

The optimization must not break live camera detection, MJPEG streaming, WebRTC streaming, live alerts, or existing API response formats.

## Target problem

The current video upload job may be slow because of one or more of these issues:

1. The video job decodes every frame using a loop like `while cap.read():`, even when most frames are skipped.
2. YOLO inference is running at a large image size on CPU.
3. The background video job may be sharing a busy `ThreadPoolExecutor` with live camera processing.

## Required workflow

Before editing code:

1. Inspect the relevant files first.
2. Identify how `run_video_job` currently samples frames, runs YOLO inference, updates job progress, and dispatches alerts.
3. Identify whether video jobs share an executor or worker pool with live cameras.
4. Explain the current bottleneck clearly.
5. Propose a file-by-file fix plan.
6. Wait for explicit user approval before modifying files.

Do not implement immediately.

## Primary file scope

Main target file:

* `backend/detection/video_jobs.py`

Only inspect additional files if needed to understand model loading, executor usage, alert dispatch, or live camera thread pools.

Possible related files may include:

* backend camera manager files
* detection model loading files
* upload route files
* app startup/background task files
* alert dispatcher files

Do not modify related files unless the plan proves it is necessary.

## Strict implementation requirements

### 1. Fast OpenCV seeking

Refactor the video-processing loop so it does not decode every frame just to skip frames.

Use frame seeking:

```python
cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
ok, frame = cap.read()
```

Expected approach:

1. Read video metadata:

   * FPS
   * total frame count
   * duration
2. Decide which frames actually need YOLO inference.
3. Compute target frame numbers directly.
4. Seek to each target frame using `cv2.CAP_PROP_POS_FRAMES`.
5. Decode only the selected frames.
6. Avoid `while cap.read()` for frame skipping.

The final implementation should process sampled frames directly instead of scanning the whole video.

### 2. Low-resolution YOLO inference

Inside the video job only, explicitly pass:

```python
imgsz=320
```

to the YOLO `model.predict()` call.

Example target shape:

```python
results = model.predict(
    frame,
    conf=...,
    imgsz=320,
    verbose=False
)
```

Do not change live camera inference size unless the user separately requests it.

### 3. Thread independence

Ensure uploaded video jobs are not starved by the same executor or worker pool used by live cameras.

Required behavior:

1. Video upload jobs should have independent execution capacity.
2. Live camera processing should continue working.
3. Avoid using the live camera executor for upload processing.
4. If an executor is needed, create or use a separate video-job executor with conservative worker count.
5. Do not introduce unbounded thread creation.

## Safety constraints

Do not break:

* live camera streaming
* live camera detection
* WebSocket counts
* MJPEG output
* WebRTC output
* violation logging
* image upload detection
* alert dispatch behavior
* existing API response formats
* database schema unless absolutely required

Do not change:

* model file paths
* frontend contracts
* authentication behavior
* unrelated routes
* unrelated camera code

Do not rewrite the whole module unless necessary.

## Performance expectations

The revised video job should:

1. Decode only sampled frames.
2. Run YOLO at `imgsz=320`.
3. Avoid blocking live camera workers.
4. Keep progress updates stable.
5. Release OpenCV resources reliably using `cap.release()`.
6. Handle corrupt videos, missing FPS, zero frame count, and read failures gracefully.

## Edge cases to preserve

Handle these cases safely:

* FPS is missing or zero.
* Frame count is missing or zero.
* Video duration cannot be calculated.
* Seeking fails for a target frame.
* A selected frame cannot be decoded.
* YOLO returns no detections.
* The video has very few frames.
* The job is cancelled or fails midway.
* The database session must be closed properly.
* Temporary files must be cleaned up if current behavior already does this.

## Expected code pattern

Prefer a direct target-frame loop similar to:

```python
fps = cap.get(cv2.CAP_PROP_FPS) or 30
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

target_frames = compute_sampled_frame_indices(
    total_frames=total_frames,
    fps=fps,
    sample_interval_seconds=...
)

for index, target_frame in enumerate(target_frames):
    cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
    ok, frame = cap.read()

    if not ok or frame is None:
        continue

    results = model.predict(
        frame,
        conf=confidence,
        imgsz=320,
        verbose=False
    )

    # preserve existing detection, violation logging, progress, and alert logic
```

Do not blindly paste this pattern. Adapt it to the current project code.

## Plan format required before implementation

Before editing, respond with:

1. Current bottleneck summary
2. Files inspected
3. Proposed file changes
4. Exact logic change for frame sampling
5. Exact logic change for YOLO `imgsz=320`
6. Exact logic change for thread independence
7. Risks and how they will be avoided
8. Tests or verification commands to run

Then wait for user approval.

## Verification after approved implementation

After implementation, run the most relevant available checks, such as:

```bash
python -m pytest tests/unit -q
```

or on Windows PowerShell:

```powershell
.venv/Scripts/python.exe -m pytest tests/unit -q
```

If no dedicated tests exist for video jobs, provide manual verification steps:

1. Upload a 13-second video.
2. Confirm processing finishes in seconds.
3. Confirm detections still appear.
4. Confirm violations are logged.
5. Confirm upload alert behavior still works.
6. Confirm live camera stream still works at the same time.
7. Confirm no executor starvation occurs.

## Final response format after implementation

After approved edits, report:

1. Files changed
2. Summary of changes
3. Performance-related changes made
4. Tests run and results
5. Manual verification steps
6. Any limitations or follow-up recommendations
