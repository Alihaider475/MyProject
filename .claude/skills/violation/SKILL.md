---
name: violation
description: >
  Use this skill when working on anything related to violation detection,
  violation events, snapshot saving, violation state tracking, cooldown
  logic, persistence logic, ViolationChecker, ViolationEvent, violation
  frames, frame_path, violation logging, or any code that decides whether
  a PPE breach has occurred and what happens next.
version: 1.0.0
project: Construction-PPE-Detection
module: app/core/violation_checker.py
triggers:
  - ViolationChecker
  - ViolationEvent
  - violation frame
  - snapshot save
  - cooldown
  - persistence logic
  - no hardhat detected
  - PPE breach
  - violation log
  - frame_path
---

# Violation Detection & Snapshot Skill

This skill governs how Claude reads, writes, debugs, and extends the
violation checking module of the PPE Detection System. The violation
module is the **decision brain** of the pipeline — it receives raw
detections from YOLO and decides whether a real violation has occurred,
when to fire an alert, and how to save evidence.

---

## METADATA

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Module path    | `app/core/violation_checker.py`                    |
| Event class    | `ViolationEvent`                                   |
| Snapshot dir   | `violation_frames/camera_{id}/`                    |
| Filename format| `violation_{timestamp}_{type}.jpg`                 |
| DB table       | `violations`                                       |
| DB model       | `app/db/models.py → Violation`                     |
| Config file    | `app/core/config.py` (Pydantic BaseSettings)       |
| Consumers      | `AlertDispatcher`, Dashboard violations table      |
| Test location  | `tests/unit/test_violation_checker.py`             |

### DB Columns Written On Every Violation

| Column           | Type      | Description                              |
|------------------|-----------|------------------------------------------|
| `camera_id`      | Integer   | ID of the camera that caught the breach  |
| `violation_type` | String    | e.g. `NO_HARDHAT`, `NO_VEST`, `NO_MASK` |
| `confidence`     | Float     | YOLO detection confidence (0.0 – 1.0)   |
| `timestamp`      | DateTime  | UTC time of the violation event          |
| `frame_path`     | String    | Relative path to saved snapshot jpg      |
| `resolved_at`    | DateTime  | Null until admin marks it resolved       |
| `is_false_positive` | Boolean | False by default, admin can flag it     |

### Key Config Variables

| Variable                  | Purpose                                          |
|---------------------------|--------------------------------------------------|
| `VIOLATION_PERSIST_SECONDS` | Seconds person must lack PPE before triggering |
| `ALERT_COOLDOWN_SECONDS`  | Minimum gap between alerts for same camera       |
| `DETECTION_CONFIDENCE`    | Minimum YOLO confidence to count as detection    |
| `FRAMES_DIR`              | Root directory for snapshot storage              |

### Violation Type Mapping

| YOLO Class   | Violation Type  | Severity |
|--------------|-----------------|----------|
| NO-Hardhat   | `NO_HARDHAT`    | HIGH     |
| NO-Vest      | `NO_VEST`       | HIGH     |
| NO-Mask      | `NO_MASK`       | MEDIUM   |
| NO-Glasses   | `NO_GLASSES`    | MEDIUM   |
| NO-Gloves    | `NO_GLOVES`     | LOW      |

---

## WORKFLOW

Claude must follow these steps **in order** every time it works on the
violation module.

### Step 1 — Understand What Triggered the Task
Before changing any violation logic, identify whether the task is about:
- **Detection logic** — when to fire a ViolationEvent
- **Snapshot saving** — how the frame is stored to disk
- **Database logging** — what gets written to the violations table
- **Cooldown / persistence** — timing rules around when alerts fire

Each of these has separate rules. Do not mix them in a single change.

### Step 2 — Check Persistence Logic Before Touching Thresholds
Confirm that a ViolationEvent only fires after a person has been detected
without PPE for `VIOLATION_PERSIST_SECONDS` continuously. A single frame
detection must never trigger a violation. If the current code fires on
a single frame, fix persistence tracking before any other change.

### Step 3 — Check Cooldown Before Adding Any New Alert Path
Before adding any new alert type (email, MQTT, PLC), confirm that
`ALERT_COOLDOWN_SECONDS` is enforced per camera. The same camera must
not fire two alerts for the same violation type within the cooldown
window. If cooldown is missing, add it first.

### Step 4 — Save Snapshot Before Writing DB Row
The snapshot frame must be saved to disk before the database row is
written. The `frame_path` column in the DB must point to a file that
actually exists. Never write a DB row with a `frame_path` that has not
been confirmed saved to disk first.

### Step 5 — Use Relative Paths for frame_path
The `frame_path` stored in the database must be relative to `FRAMES_DIR`,
not an absolute system path. This ensures the path works across different
machines, Docker containers, and deployment environments.
Example: `camera_1/violation_2026-04-28_14-32-01_NO_HARDHAT.jpg`
Never: `C:/Users/mirza/project/violation_frames/camera_1/...`

### Step 6 — Confirm Snapshot Directory Exists Before Saving
Before writing the jpg file, confirm the directory
`violation_frames/camera_{id}/` exists. Create it if it does not.
Never assume the directory was pre-created.

### Step 7 — Dispatch Alert Only After Snapshot + DB Write Succeed
The ViolationEvent must only be passed to AlertDispatcher after:
1. Snapshot jpg is saved to disk ✓
2. DB row is written with frame_path ✓

If either step fails, log the error but do not dispatch the alert
with missing evidence. An alert without a snapshot is incomplete.

### Step 8 — Update or Write Tests After Every Change
After any change to violation logic, update or add tests in
`tests/unit/test_violation_checker.py`. Tests must cover:
- Single frame detection does NOT trigger violation
- Violation fires after VIOLATION_PERSIST_SECONDS
- Cooldown prevents duplicate alerts
- Snapshot file is created on disk
- DB row contains correct frame_path
- ViolationEvent is NOT dispatched if snapshot save fails

---

## RULES

### MUST DO

- **MUST** track per-person, per-camera state — the same person missing
  a hardhat for 3 seconds is one violation, not 90 violations (one per frame)
- **MUST** read `VIOLATION_PERSIST_SECONDS` and `ALERT_COOLDOWN_SECONDS`
  from config — never hardcode timing values
- **MUST** create the snapshot directory before writing the frame
- **MUST** save the snapshot jpg before writing the database row
- **MUST** store `frame_path` as a relative path from `FRAMES_DIR`
- **MUST** use UTC timestamps for all violation records
- **MUST** set `is_false_positive = False` and `resolved_at = None`
  as defaults on every new violation row
- **MUST** use forward slashes in `frame_path` regardless of OS —
  ensures URL compatibility when serving snapshots via HTTP
- **MUST** log an error and continue if snapshot save fails —
  never crash the detection loop over a failed file write
- **MUST** enforce cooldown per camera per violation type independently —
  a NO_HARDHAT cooldown must not block a NO_VEST alert on the same camera

### MUST NOT

- **MUST NOT** fire a ViolationEvent on a single frame detection —
  persistence tracking is mandatory
- **MUST NOT** hardcode camera ID, file paths, or timing values
  anywhere in violation logic
- **MUST NOT** write an absolute system path into the `frame_path` column
- **MUST NOT** dispatch an alert before the snapshot is confirmed saved
- **MUST NOT** raise an unhandled exception from inside the violation
  checker — it must catch, log, and continue the detection loop
- **MUST NOT** apply one camera's cooldown state to another camera
- **MUST NOT** delete or overwrite existing violation frames —
  append only, never mutate historical evidence
- **MUST NOT** block the async event loop when saving snapshots —
  file writes must go through `run_in_executor`
- **MUST NOT** add detection or inference logic to this module —
  ViolationChecker only receives already-detected results from PPEDetector

### DECISION RULES

- **Persistence over speed**: It is better to miss a 1-second violation
  than to flood the system with false positives from brief occlusions
- **Evidence first**: No alert fires without a saved snapshot. Evidence
  is the product of this module, not the alert itself
- **Relative paths always**: If a path decision comes up, always choose
  relative over absolute — the system must be portable
- **Fail silently on IO**: Disk write failures must never stop the
  detection pipeline. Log it, skip the alert, keep detecting
- **Per-camera isolation**: Every camera maintains completely independent
  cooldown, persistence state, and snapshot directory —
  one camera's failure never affects another

---

## ANTI-PATTERN TABLE

| Anti-Pattern | Why It's Harmful |
|---|---|
| Firing ViolationEvent on every frame a person lacks PPE | Creates thousands of duplicate alerts per minute — floods email, MQTT, DB |
| Hardcoding `time.sleep(30)` for cooldown | Breaks when config changes — always read from `ALERT_COOLDOWN_SECONDS` |
| Saving absolute path in `frame_path` | Breaks on every other machine, Docker container, or deployment |
| Writing DB row before snapshot is saved | DB shows evidence that doesn't exist on disk — broken dashboard thumbnails |
| Blocking async loop with `open().write()` in async def | Freezes entire FastAPI event loop during file write |
| Sharing cooldown state across cameras | Camera 1 violation blocks Camera 2 alert — safety gap |
| Raising exception when snapshot directory missing | Crashes detection loop permanently over a missing folder |
| Storing frame_path with backslashes | Breaks HTTP URL when serving snapshot via `/frames/` static route |

---

*Place this file at `.claude/skills/violation/SKILL.md`
Claude reads it before touching any violation logic in the project.*
