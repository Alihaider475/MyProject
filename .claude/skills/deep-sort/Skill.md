---
name: safesite-ai-detection
description: >-
  Required patterns and guardrails for modifying the SafeSite AI PPE-detection
  pipeline (FastAPI backend + React frontend, YOLO detection, DeepSORT tracking,
  DeepFace worker ID). Use this skill whenever the task touches SafeSite AI
  detection, person tracking, PPE violation logic, duplicate or "ghost"
  detections, violation persistence or cooldown, track_id / worker_id handling,
  the CameraManager frame loop, ROI filtering, or the annotated live-stream
  output — even if the user does not name the skill. Also use it when WRITING or
  REFINING a prompt for a coding agent that will edit this pipeline, since the
  scoping discipline below is what keeps those changes safe.
---

# SafeSite AI — detection pipeline skill

This skill captures hard-won rules for changing SafeSite AI's vision pipeline without breaking it or shipping subtly wrong safety logic. The system issues real fines based on detections, so correctness and stable identity attribution are safety-critical, not cosmetic. Apply the workflow discipline first, then the domain rules.

## System map (reuse, do not rebuild)

The pipeline flows: camera sources (webcam / RTSP) → CameraManager per-camera loop → YOLO detection → ROI filter + person dedup + tracking → PPE association → violation check (persistence + cooldown) → worker identification + fine → alerts + dashboard.

Fixed facts about the stack:

- YOLO detects positive classes only: `person`, `hardhat/helmet`, `vest`, `mask`. There is **no** `NO-Hardhat` negative class. Violations are therefore **derived by spatial association**, never by detecting an absence class.
- `DeepFace` produces a permanent `worker_id` (registered identity). `DeepSORT` produces a temporary per-camera-session `track_id`. They coexist — DeepSORT never replaces DeepFace.
- Per-camera config already exists: confidence threshold, ROI polygon, persistence duration, violation cooldown.
- The system targets ~10 FPS per stream across multiple simultaneous cameras.

## The non-negotiable workflow

These three habits prevent the failure mode where an agent rewrites half the repo to fix one bug.

### 1. Explore → explain → plan → wait

Before editing anything: explore the relevant files only, report where YOLO runs / where frames are processed / where violations are checked and logged / where the `violations` model lives / whether tracking already exists, explain the current flow in a few lines, give a file-by-file plan, then **stop and wait for explicit approval**. Write no code until the user approves. This gate is the single biggest protection against scope sprawl.

### 2. Fence the scope with an allowlist and denylist

State up front which files may be edited and which are off-limits. A typical fence for a detection task:

- **May edit:** YOLO/detection module, CameraManager loop, ViolationChecker, the `violations` model, the requirements file, plus any new tracker/helper file.
- **Must not touch:** DeepFace logic, fine/challan calculation, alert dispatch, auth/Supabase, the frontend (except a single annotated-frame label), and the single-image detection path.

If a change appears to require editing a denylist file, stop and ask rather than working around it.

### 3. Phase the work; build the smallest slice first

When a request bundles several concerns (e.g. live tracking + video + DeepFace caching + DB migration), split it: build Phase 1 (the live path) and propose Phases 2–3 without building them. A tightly-scoped Phase 1 the agent finishes cleanly beats a complete spec it half-implements across twenty files. When a prompt feels like it is getting long, that is the signal to split into phases, not to add more clauses.

## Perception correctness rules

These fix the "one person counted as two" and "no helmet but zero violations" bugs.

- **Use class-specific confidence floors, not one global threshold.** Person ≈ 0.45–0.50 (a person is a large, easy object; low-confidence person boxes are almost always noise — raising this floor is the primary fix for ghost duplicate persons). PPE classes ≈ 0.25–0.30 (hardhats/vests/masks are small; a high global floor silently drops real ones).
- **Do not enable global `agnostic_nms`.** Standard YOLO NMS is already class-aware and is sufficient. Class-agnostic NMS lets a person box suppress a PPE box that legitimately sits inside it.
- **Add a secondary person-dedup pass as a safety net only.** It exists to catch the rare case where a head-box and a body-box on the same person have IoU below the NMS threshold. Use IoU + containment + area ratio; keep the larger full-body box. Do not over-engineer it into a large heuristic — the confidence floor does most of the work.
- **Never discard a PPE box for overlapping a person box.** PPE is expected to sit inside the person region.

## Tracking rules

- One tracker instance **per camera stream**, keyed by `camera_id`. Never a single global tracker. Dispose the instance when its camera stops so trackers do not leak across sessions.
- Track only `person` detections. PPE classes are associated afterward, not tracked.
- If `deep-sort-realtime` is used, note that its default MobileNet embedder runs every frame and adds latency. Make the embedder configurable so it can be tuned (or disabled) to protect the FPS budget.
- Every confirmed person carries a stable `track_id`. For unmatched persons, a deterministic fallback key from box center/size may be used for current-frame counting only — never for long-term logging.

## Association-based violation logic

Derive missing-PPE violations from geometry, independent of any negative class:

- For each valid, upright person box, define a head region (top ~35% of the box) and a torso region.
- A hardhat/mask is matched if its centroid falls in (or sufficiently overlaps) the head/face region; a vest if it matches the torso region. No match → emit the corresponding `NO-Hardhat` / `NO-Vest` / `NO-Mask` candidate.
- Factor this into **one shared helper** that live, video, and image paths all call, so the same frame yields the same violations regardless of entry point.
- **Pose guard:** if the person box aspect ratio indicates a non-upright pose (width clearly exceeds height — lying/crawling), skip association for that person rather than emitting a false violation. "Top 35%" is only the head when the person is upright.

## Persistence, cooldown, and the identity key

Keep two gates distinct — they do different jobs:

- **Persistence:** a violation must hold for the configured persist window for a given identity before the **first** log. This kills single-frame flicker.
- **Cooldown:** after a log, suppress re-logging for the cooldown window.

**Identity key for throttling (correctness-critical):** prefer `camera_id + worker_id + violation_type` when `worker_id` is known (DeepFace matched); fall back to `camera_id + track_id + violation_type` only when it is not. The reason: trackers reassign a **new** `track_id` after a long occlusion (a worker walking behind a beam and reappearing), so keying cooldown on `track_id` alone re-logs the same physical person and produces **duplicate fines**. `worker_id` is stable, so it is the correct key whenever available.

Different people in one camera must still log separately; different cameras stay independent.

## Live vs logged counts

Separate current-frame violation candidates from persisted DB records. The dashboard's live `Violations` count should reflect active candidates after association; DB records appear only after persistence + cooldown. If the existing UI count actually shows only logged violations, it will read as "0 violations" during the persistence window — surface a live count via a backward-compatible field (`current_violations_count`, `current_violations_by_type`) rather than breaking existing fields.

## Database discipline

- Add `track_id` to the `violations` model as **nullable** (old rows, image uploads, and pre-tracking records have none).
- If the project uses SQLAlchemy `create_all` **without Alembic**: `create_all` will not add a column to an existing table. Use a guarded one-time `ALTER TABLE ... ADD COLUMN` at startup (check `PRAGMA table_info` first) or a documented manual step. Never drop/recreate the table; never break existing rows.

## Performance and demo stability

- Support detecting every N frames (configurable stride) and propagating boxes via the tracker between detections, so tracking + association do not blow the 10 FPS budget.
- Report achieved FPS per stream (tracking on vs off) when changing the perception path.
- Do not introduce writes that trigger `uvicorn --reload` during a live demo (e.g. snapshot files landing in a watched path). Keep runtime storage behavior unchanged unless the task requires it.

## Output and compatibility rules

- Preserve existing API response formats, WebSocket count-push format, and DB logging interfaces. Add only backward-compatible fields (e.g. `track_id`).
- Draw a compact `ID: {track_id}` on each tracked person on the annotated stream; keep existing boxes/labels intact; avoid clutter.
- Provide exact run/verify commands for the user's platform (this project is typically verified on **Windows PowerShell**).

## Common failure modes (symptom → cause → fix)

- One person counted as two → low-confidence ghost box passing the floor → raise person confidence to ~0.45–0.50; add the dedup safety net.
- No helmet but `Violations = 0` → violation logic waiting on a negative class, or low-conf person not triggering it → derive violations by head-region association; ignore sub-floor persons.
- Same worker fined repeatedly every few frames → cooldown keyed on per-frame boxes or on a `track_id` that switches on occlusion → key cooldown on `worker_id` first, `track_id` fallback; add persistence.
- Counts flicker frame to frame → no tracking / per-frame independence → add per-camera tracking; key logic on stable IDs.
- False violation on an odd pose → upright-pose assumption in head region → apply the pose guard.
- Live view shows 0 during a real violation → UI showing logged (not live) violations → add a live candidate count.

## Validate like a measurement, not a vibe

Confidence thresholds decide whether a worker gets fined. Validate them on a small **labeled** set of real construction-site frames and report precision/recall per class, and give before/after on a real clip — not on a single out-of-distribution test frame (e.g. an indoor selfie), where degraded behavior is expected and misleading.