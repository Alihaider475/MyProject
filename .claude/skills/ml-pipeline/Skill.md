# Task: Fix duplicate person detection and association-based PPE violation logic in SafeSite AI

## Context

SafeSite AI is a real-time PPE compliance system that detects safety violations, identifies the responsible worker via face recognition, and issues financial penalties. Because violations drive **fines**, correctness and stable identity attribution are safety-critical, not cosmetic.

Stack:

* Backend: Python + FastAPI
* Detection: Ultralytics YOLO model loaded by backend detector / CameraManager
* Live processing: CameraManager runs a per-camera frame processing loop
* Violation logic: ViolationChecker confirms and logs violations after persistence/cooldown
* Detection entry points (three paths, must stay consistent): **live camera stream**, **uploaded image detection**, **uploaded video detection**
* Frontend: React dashboard showing live counts such as Persons, Hardhats, Vests, Masks, and Violations

Current model classes are positive-only:

* `Person`
* `Hard Hat`
* `Mask`
* `Safety Vest`

There is no negative class such as `NO-Hardhat`. Violations must be derived from spatial association:

* Person without matched hardhat = `NO-Hardhat`
* Person without matched vest = `NO-Vest`
* Person without matched mask = `NO-Mask`, only if mask checking is enabled

## Current bugs

1. **Duplicate / ghost person detection.** One visible person is counted as 2. Example: two low-confidence person boxes (≈0.28 and ≈0.45) on the same body. This inflates counts and corrupts violation logic.
2. **Broken violation logic.** A person without a hardhat shows `Hardhats = 0` but `Violations = 0`. Missing PPE is not being derived from person-to-PPE spatial matching.
3. **Temporal instability.** Counts and violations flicker across frames. Persistence/cooldown must be keyed to a stable identity, not raw per-frame boxes.

## Important constraints

* Do not retrain or replace the YOLO model.
* Do not add fake negative YOLO classes.
* Do not globally raise all confidence thresholds; PPE objects are small and a high global floor will drop real hardhats/vests/masks.
* Do not use `agnostic_nms=True` globally — it can suppress PPE boxes that legitimately sit inside person boxes. Standard YOLO NMS is already class-aware and is sufficient.
* Preserve existing API response formats, WebSocket count-push format, and DB logging interfaces unless a backward-compatible field is strictly required.
* Keep changes scoped to the existing detector / CameraManager / ViolationChecker pipeline.
* Performance: the system must still sustain the 10 FPS-per-stream target across multiple simultaneous cameras. Accuracy fixes must not silently break the latency budget.
* Before coding, inspect the current files and explain the current flow.

## Required workflow

1. **Explore relevant files first:**
   * detector / YOLO wrapper
   * CameraManager live processing loop
   * **image-upload and video-upload detection paths** (confirm whether they share violation logic with live or duplicate it)
   * ViolationChecker
   * ROI filtering logic
   * WebSocket count-push logic
   * any existing DeepSORT / ByteTrack / track_id handling
   * face-recognition / worker-identification module (to understand how `worker_id` is produced)
   * frontend count display only if backend response fields need clarification

2. **Explain the current implementation:** how detections are produced; how persons are counted; how hardhats/vests/masks are counted; how violations are generated; whether tracking already exists; whether image/video/live share violation code or diverge; where persistence/cooldown is applied.

3. **Provide a file-by-file plan and wait for approval before editing.**

## Required implementation details

### 1. Inference and post-processing hardening

Use class-aware detection output. Do **not** enable global class-agnostic NMS.

Recommended settings:

* YOLO confidence remains configurable.
* Class-specific minimum confidence thresholds:
  * Person: default `0.45`–`0.50`  ← **this is the primary fix for the ghost-box bug**; the 0.28 phantom is removed by the floor alone
  * Hard Hat / Safety Vest / Mask: default `0.25`–`0.30`
* Configurable IoU (NMS) threshold, default ≈`0.50`.

Add a **secondary** person-dedup pass as a safety net only — it exists to catch the case where a head-box and a body-box on the same person have IoU below the NMS threshold. Keep it simple:

* Remove duplicate person boxes using IoU + containment (one box mostly inside another) + area ratio.
* When two boxes are near-duplicates, keep the larger full-body box; prefer it when confidences are close.

Do **not** over-engineer this pass into a large heuristic with many tunable corner cases. The confidence floor does most of the work; this is belt-and-suspenders. Never discard PPE boxes for overlapping a person box — PPE is expected inside the person region.

### 2. Pose guard for association (false-fine prevention)

Head/torso ROIs assume an upright person. Before associating PPE, check the person box aspect ratio:

* If the box indicates a non-upright pose (e.g. width clearly exceeds height, suggesting lying/crawling), **skip hardhat/vest association for that person** (or mark it low-confidence) instead of emitting a `NO-Hardhat`/`NO-Vest` violation.
* Make the aspect-ratio threshold configurable. This prevents false fines on unusual poses where "top 35%" is not the head.

### 3. Tracking

Inspect whether a tracker (DeepSORT/ByteTrack/etc.) already exists.

* If reliable tracking exists, reuse the existing `track_id`; do not replace it without strong reason.
* If no reliable tracking exists, add it with the least disruptive option. Prefer Ultralytics `model.track(persist=True, tracker="bytetrack.yaml")` if it fits the detector wrapper cleanly. Keep tracker config configurable. Ensure every confirmed person carries a stable `track_id`.
* For unmatched persons, derive a deterministic fallback key from box center/size for **current-frame counting only**; do not use it for long-term logging.

**Note the known limitation and upgrade path (do not implement now unless trivial):** ByteTrack is motion-only and will swap IDs when workers cross or occlude one another — exactly when persistence and worker attribution matter most. Document `BoT-SORT + ReID` as the recommended upgrade for occlusion-heavy sites, and keep the tracker swappable via config so this is a one-line change later.

### 4. ROI filtering

Respect the camera ROI polygon: ignore detections whose centroid is outside the ROI, applied **before** counting and **before** violation association. Keep existing ROI behavior if present, but verify it works for all classes.

### 5. Single shared association + violation-derivation function (critical)

Extract the PPE association and violation-derivation into **one shared function** that the live camera loop, the image-upload path, and the video-upload path all call. The same frame must produce the same violations regardless of entry point. Do not leave image/video paths on separate/legacy violation logic.

For each valid (and upright) person box:

* `head_roi` ≈ top 35% of the person box; `torso_roi` ≈ middle/lower body; optional `face_roi` within the head region for masks.
* **Hardhat match** if its centroid is inside `head_roi` or it sufficiently overlaps it; else generate a `NO-Hardhat` candidate.
* **Vest match** if its centroid is inside `torso_roi` or it overlaps sufficiently; else `NO-Vest` candidate.
* **Mask match** (only if enabled) inside/over `face_roi`/`head_roi`; else `NO-Mask` candidate.

Never rely on a `NO-Hardhat`/`NO-Vest`/`NO-Mask` YOLO class — these are derived labels only.

### 6. Live count vs logged violation separation

Separate current-frame live violation candidates from persisted DB violations.

* Frontend live `Violations` reflects current active violation candidates after association.
* DB records are created only after persistence and cooldown pass.
* If the current UI count actually shows only logged violations, either rename it internally to "logged" or add backward-compatible fields (`current_violations_count`, `current_violations_by_type`, `detections_by_class`). Do not break existing frontend fields.

### 7. Per-track temporal persistence and occlusion-safe cooldown

**Persistence** is keyed by `(track_id, violation_type, camera_id)`:

* Start a timer when a track first becomes non-compliant for a violation type.
* Continue while the same track stays non-compliant; confirm/log only after `persist_seconds`.
* Reset when the person becomes compliant; remove stale state when the track disappears.

**Cooldown must survive ID switches.** Because track IDs are reassigned after occlusion (a worker reappearing from behind a beam often gets a new ID), do **not** key cooldown on `track_id` alone — that re-fires the same physical person immediately and produces duplicate fines.

* Where a worker is identified by the face module, key cooldown on `(camera_id, violation_type, worker_id)`.
* Fall back to `track_id` only when no `worker_id` is available.

### 8. Configuration

Make configurable via existing settings/camera config (no hardcoded magic values in the loop):

* detection confidence, IoU threshold
* person confidence floor, PPE confidence floor
* pose-guard aspect-ratio threshold
* persist_seconds, cooldown_seconds
* tracker enable/disable and tracker config name/path
* detection stride / frame-skip (see Performance)

### 9. Performance budget

To protect the 10 FPS-per-stream target across multiple cameras:

* Support **detecting every N frames** (configurable stride) and propagating boxes via the tracker on intermediate frames, instead of running full detection + association + dedup on every frame.
* Report **achieved FPS per stream** in the before/after results.

### 10. Debugging support

When `WEBCAM_DEBUG=true`, log/save enough for one frame to diagnose: raw YOLO detections; detections after ROI; person boxes after dedup; PPE boxes used for association; per-person matched hardhat/vest/mask status; pose-guard decisions; generated live violation candidates; and the reason when no violation is generated. Keep logs concise — do not spam every frame.

## Acceptance criteria

1. One clearly visible person produces `Persons = 1`, not 2.
2. A visible person without a hardhat produces a live `NO-Hardhat` candidate.
3. The violation is logged only after the configured persistence window.
4. Single-frame flickers do not create violation records.
5. A person wearing a hardhat does not trigger `NO-Hardhat`.
6. Counts remain stable frame-to-frame for a stationary person.
7. The **same frame** yields the **same violations** across live, image-upload, and video-upload paths.
8. A worker who walks out of frame and returns (new track ID) is **not** re-fined within the cooldown window.
9. A non-upright person (lying/crawling) does not produce a false `NO-Hardhat`/`NO-Vest`.
10. Achieved FPS per stream still meets the target with tracking + association enabled.
11. Existing image detection, video detection, live detection, WebSocket updates, and DB logging still work.

## Verification (measure, don't eyeball)

* Validate the chosen confidence thresholds on a small **labeled** set of real construction-site frames and report **precision/recall per class** — these numbers decide whether a worker gets fined, so treat them as measurements, not a single-clip vibe check.
* Provide before/after on a real construction-site clip (and a webcam test), not only one static frame.

## Final response required after implementation

* changed files
* summary of logic changes
* new settings/env values
* per-class precision/recall on the labeled set + achieved FPS per stream
* before/after behavior
* verification steps for live webcam and uploaded video