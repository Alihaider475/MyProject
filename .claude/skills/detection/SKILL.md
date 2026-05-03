---
name: detection
description: >
  Use this skill when working on anything related to YOLO model loading,
  PPE inference, detection results, class mapping, confidence filtering,
  bounding box annotation, PPEDetector, DetectionResult, model backend
  selection, or any code that runs the AI model and interprets its output.
version: 1.0.0
project: Construction-PPE-Detection
module: app/core/detector.py
triggers:
  - PPEDetector
  - DetectionResult
  - YOLO
  - model.predict
  - detect
  - inference
  - confidence threshold
  - class mapping
  - bounding box
  - annotate_frame
  - model loading
  - TensorRT
  - PyTorch
  - NO-Hardhat
  - NO-Vest
  - NO-Mask
  - detection classes
---

# PPE Detection Skill

This skill governs how Claude reads, writes, debugs, and extends the
YOLO-based detection module of the PPE Detection System. The detector
is the **AI engine** of the pipeline — it receives raw frames from the
camera module and returns structured detection results that the
ViolationChecker consumes.

---

## METADATA

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Module path    | `app/core/detector.py`                             |
| Main class     | `PPEDetector`                                      |
| Result class   | `DetectionResult` (dataclass)                      |
| Model file     | `Model/ppe.pt`                                     |
| Framework      | Ultralytics YOLOv8 / YOLOv11                       |
| Config file    | `app/core/config.py` (Pydantic BaseSettings)       |
| Annotation fn  | `annotate_frame(frame, detections)`                |
| Test location  | `tests/unit/test_detector.py`                      |
| Consumers      | `CameraManager._process_loop`, image upload route  |

### Key Config Variables

| Variable                | Purpose                                          |
|-------------------------|--------------------------------------------------|
| `MODEL_PATH`            | Path to YOLO weights file                        |
| `DETECTION_CONFIDENCE`  | Minimum confidence to include a detection        |
| `BACKEND`               | `pytorch` or `tensorrt` — model backend selector |
| `STREAM_WIDTH`          | Frame width fed to model                         |
| `STREAM_HEIGHT`         | Frame height fed to model                        |

### YOLO Class Mapping (10 Classes)

| ID | Class Name    | Type      | Action Required        |
|----|---------------|-----------|------------------------|
| 0  | Person        | Subject   | Track for PPE check    |
| 1  | Hardhat       | PPE OK    | Compliant              |
| 2  | NO-Hardhat    | Violation | Trigger ViolationEvent |
| 3  | Mask          | PPE OK    | Compliant              |
| 4  | NO-Mask       | Violation | Trigger ViolationEvent |
| 5  | Safety Vest   | PPE OK    | Compliant              |
| 6  | NO-Safety Vest| Violation | Trigger ViolationEvent |
| 7  | Safety Cone   | Object    | No action              |
| 8  | Machinery     | Object    | No action              |
| 9  | Vehicle       | Object    | No action              |

### DetectionResult Dataclass Fields

| Field        | Type    | Description                              |
|--------------|---------|------------------------------------------|
| `class_id`   | int     | YOLO class index (0–9)                   |
| `class_name` | str     | Human-readable class label               |
| `confidence` | float   | Model confidence score (0.0 – 1.0)       |
| `bbox`       | tuple   | `(x1, y1, x2, y2)` pixel coordinates    |
| `is_violation` | bool  | True if class is a NO-* violation class  |

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the
detection module.

### Step 1 — Identify the Task Scope
Before changing any detection logic, identify which layer the task touches:
- **Model loading** — how the YOLO model is initialized at startup
- **Inference** — how `detect()` runs predictions on a frame
- **Filtering** — how confidence threshold is applied to raw results
- **Class mapping** — how YOLO integer IDs become structured results
- **Annotation** — how bounding boxes and labels are drawn on frames
- **Backend switching** — PyTorch vs TensorRT selection

Each layer has separate rules. Never mix inference changes with
annotation changes in the same edit.

### Step 2 — Confirm Model Loads Once at Startup
The YOLO model must be loaded exactly once during application startup
via the FastAPI lifespan context into `app.state.detector`. Confirm this
before making any change that touches model initialization. If the model
is being loaded inside `detect()` on every call, that is a critical
performance bug — fix it before anything else.

### Step 3 — Confirm detect() Is Called via run_in_executor
Every call to `PPEDetector.detect()` from an async context must go
through `loop.run_in_executor(None, self.detector.detect, frame)`.
YOLO inference is CPU/GPU-bound and will freeze the entire FastAPI
event loop if called directly inside `async def`. Verify this before
adding any new detection call site.

### Step 4 — Apply Confidence Filtering After Inference
Raw YOLO results must be filtered by `DETECTION_CONFIDENCE` before
being returned as `DetectionResult` objects. This filter must read from
config — never hardcode a threshold value. Detections below the
threshold are silently dropped, not returned as low-confidence results.

### Step 5 — Map Class IDs to Structured Results
After filtering, every detection that passes the threshold must be
converted to a `DetectionResult` dataclass using the class mapping
table above. The `is_violation` field must be set to `True` only for
classes: NO-Hardhat (2), NO-Mask (4), NO-Safety Vest (6).
All other classes set `is_violation = False`.

### Step 6 — Return Only DetectionResult Objects
The `detect()` method must return a `list[DetectionResult]`. It must
never return raw YOLO result objects, numpy arrays, or dictionaries.
Consumers (ViolationChecker, dashboard) depend on the `DetectionResult`
interface — changing its fields breaks the entire pipeline.

### Step 7 — Annotate Frames Separately From Detection
Frame annotation (drawing bounding boxes, labels, colors) must happen
in `annotate_frame()` as a separate function from `detect()`. Detection
logic must never modify the input frame. The caller decides whether to
annotate — the detector only detects.

### Step 8 — Backend Selection at Load Time Only
The model backend (PyTorch vs TensorRT) is selected once when the model
loads based on the `BACKEND` config variable. It must never be switched
mid-session. If `BACKEND=tensorrt` but no GPU is available, fall back
to PyTorch and log a warning — never crash.

### Step 9 — Update or Write Tests After Every Change
After any change to detection logic, update or add tests in
`tests/unit/test_detector.py`. Tests must cover:
- Model loads without error using a mocked weights file
- `detect()` returns a `list[DetectionResult]`
- Detections below confidence threshold are excluded
- `is_violation` is True only for NO-* classes
- `detect()` does not modify the input frame
- Annotation draws boxes without modifying detection results

---

## RULES

### MUST DO

- **MUST** load the YOLO model exactly once at startup — never inside
  `detect()` or any per-frame function
- **MUST** run `detect()` via `run_in_executor` from every async context —
  YOLO inference is blocking and must never touch the event loop directly
- **MUST** filter all results by `DETECTION_CONFIDENCE` from config
  before returning — never pass raw unfiltered results to consumers
- **MUST** return `list[DetectionResult]` from `detect()` — the
  dataclass interface is the contract with all downstream consumers
- **MUST** set `is_violation = True` only for class IDs 2, 4, 6
  (NO-Hardhat, NO-Mask, NO-Safety Vest)
- **MUST** keep `detect()` and `annotate_frame()` as separate functions —
  detection must never modify the input frame
- **MUST** read `MODEL_PATH` from config — never hardcode the weights path
- **MUST** fall back to PyTorch silently if TensorRT is configured but
  GPU is unavailable — log a warning, never crash startup
- **MUST** store `PPEDetector` instance in `app.state.detector` so it
  is shared across all requests and camera loops
- **MUST** mock the YOLO model in all unit tests — tests must never
  require the actual `ppe.pt` weights file or a GPU

### MUST NOT

- **MUST NOT** call `model.predict()` or any YOLO method directly inside
  `async def` without `run_in_executor`
- **MUST NOT** load the model inside `detect()` — one model load per
  application lifecycle only
- **MUST NOT** return raw YOLO result objects to consumers —
  always convert to `DetectionResult` first
- **MUST NOT** hardcode confidence thresholds — always read from
  `DETECTION_CONFIDENCE` in config
- **MUST NOT** modify the input frame inside `detect()` — annotation
  is the caller's responsibility via `annotate_frame()`
- **MUST NOT** change the `DetectionResult` dataclass fields without
  updating ViolationChecker and all consumers simultaneously
- **MUST NOT** set `is_violation = True` for Person, Hardhat, Mask,
  Safety Vest, Safety Cone, Machinery, or Vehicle classes
- **MUST NOT** switch model backend mid-session — backend is fixed
  at load time for the entire application lifecycle
- **MUST NOT** raise an unhandled exception from `detect()` —
  catch model errors, log them, and return an empty list

### DECISION RULES

- **Empty list over exception**: If YOLO returns no results or errors,
  return `[]` — an empty detection list is a valid result that
  ViolationChecker handles gracefully
- **Config over code**: If a threshold or path decision comes up,
  it belongs in `.env` and config — never in the detector source file
- **Separation of concerns**: If a task combines detection and annotation
  into one function, split them — the detector produces data,
  the annotator produces visuals
- **GPU optional**: TensorRT is an optimization, not a requirement —
  the system must always work on CPU-only machines
- **Mock in tests**: If a test requires the real `ppe.pt` file,
  the test is wrong — mock the model and test the logic around it

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Loading YOLO model inside `detect()` | Adds 2–5 second delay on every single frame — pipeline becomes unusable |
| Calling `model.predict()` in `async def` without executor | Blocks entire FastAPI event loop — no API requests served during inference |
| Returning raw YOLO result objects to ViolationChecker | Tightly couples detector to YOLO version — any model change breaks everything downstream |
| Hardcoding `confidence=0.5` in detect() | Config change has no effect — admins cannot tune sensitivity from dashboard |
| Modifying input frame inside detect() | Annotated frame passed to ViolationChecker — bounding box pixels corrupt detection logic |
| Setting `is_violation=True` for Person class | Every person on camera triggers a violation regardless of PPE status |
| Crashing on TensorRT unavailable | Entire system fails on CPU-only machines — GPU should be an optional optimization |
| Sharing `DetectionResult` mutable state across threads | One consumer modifies results while another is reading — race condition corrupts data |

---

*Place this file at `.claude/skills/detection/SKILL.md`
Claude reads it before touching any detection or inference logic in the project.*
