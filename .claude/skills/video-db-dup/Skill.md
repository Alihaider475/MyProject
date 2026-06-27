---
name: safesite-video-upload-stability
description: Debug and fix SafeSite AI's uploaded-video PPE detection pipeline (FastAPI + OpenCV + YOLO/Ultralytics + React). Use this whenever the user reports that an uploaded video gets stuck in "Processing...", the processed result never appears, the backend video loop hangs or runs slowly, a short clip creates many duplicate violation rows (e.g. 40-50), video uploads spam Gmail/email alerts, or Dashboard/Violations counts don't refresh after a video finishes — even when the user only describes the symptom ("my upload is stuck", "I got 40 emails", "the count won't update") without naming the cause. Do NOT use for live-camera detection, image-only upload, auth, face recognition (DeepFace), worker/fine/payroll, routing, or DB schema work.
---

# SafeSite AI — Uploaded Video Detection Stability

You are an expert FastAPI + OpenCV + YOLO/Ultralytics + React debugging engineer. Your job is to stabilize the **uploaded-video** detection path on the Video Detection page without touching anything else.

## System context

- **Backend:** FastAPI, OpenCV, YOLO/Ultralytics, SQLAlchemy, email/MQTT/webhook alerts, dashboard/violation cache.
- **Frontend:** React, Video Detection page, Dashboard count cards, Violations page, alert logs, React Query (or equivalent) for refetch.
- **Expected behavior of an upload:** process the video → return/show the annotated result → save a *summarized* set of violation records → send at most one summary alert → refresh dashboard/violation data.

## Guardrails (do not break these)

Live camera detection, image upload detection, annotated video output, and existing API response shapes must keep working. Do not modify auth, DeepFace, WebRTC overlay alignment, worker management, fine config, payroll, routing, or the DB schema unless a fix is impossible without it — and if so, flag it and get approval first. Keep changes small, testable, and confined to the upload path.

## Workflow — plan before you code

Never edit code first. The upload path is entangled with shared services (violation logging, alert dispatch, cache), so a blind edit risks the camera path. Instead:

1. Inspect, don't assume: run `git status`, `git diff --stat`, and read the relevant backend + frontend files (see *Where to look*).
2. State what is **already fixed**, what is **still broken**, and the **root cause** of each remaining issue, with evidence from the files/logs.
3. Give a **file-by-file fix plan** mapped to the fixes below.
4. **Wait for explicit approval** before modifying anything.

## Where to look

**Backend:** the video upload endpoint/controller; the `cv2.VideoCapture` loop; the YOLO inference call for video; the video writer/output generation; any status/background-job handling; exception handling and `finally` cleanup; violation label normalization; the violation create service/repository and SQLAlchemy model; the alert dispatcher call site; cache invalidation; the dashboard summary endpoint; the violations listing endpoint; config for frame stride, max video violations, alert mode, and YOLO image size.

**Frontend:** the Video Detection page and its upload submit handler; loading/processing state; API response handling and result-URL state; polling/status logic if present; React Query invalidation after processing; the dashboard summary query; the violations page query.

## Diagnosis map — symptom → root cause → fix

Use this to go straight from a complaint to the right fix. Confirm the root cause in the actual code before applying.

| Symptom | Likely root cause | Fix |
|---|---|---|
| Stuck in "Processing..." forever; result never appears | Loop never reaches a terminal state, or frontend never clears loading in `finally`; missing `cap`/`writer` release | Fix 1 |
| Processing feels infinite or very slow | YOLO runs on **every** frame; no frame stride; large `imgsz` | Fix 2 |
| Short clip creates 40-50 duplicate violation rows | A DB row is written **inside the frame loop**, once per detected frame | Fix 3 |
| Gmail/email spammed after one upload | Alert dispatched **per violation/frame** instead of once per upload | Fix 4 |
| Dashboard/Violations only update after a manual browser refresh | Backend cache not invalidated and/or frontend queries not refetched | Fix 5 |

## The five fixes

Implement only the ones still missing. Each fix says what to guarantee and why.

### Fix 1 — Video processing always terminates

A hang almost always means the loop or the UI has no guaranteed exit. Guarantee both ends reach a terminal state.

Backend must: open with `cv2.VideoCapture` and validate `cap.isOpened()`; read FPS/frame count safely; break when `cap.read()` returns `False`; release `cap` and `writer` in a `finally` block; and return `{ success, output_url, processed_frames, detected_violation_types, saved_violation_count, message }` (or `error` on failure).

```python
try:
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        # process frame
finally:
    cap.release()
    if writer is not None:
        writer.release()
```

Frontend must: set loading true on upload start; show the result on success and a clear error on failure; **always** clear loading in `finally`; stop polling once status is `completed` or `failed`; and add a timeout so the UI can never sit in processing indefinitely.

### Fix 2 — Frame stride (don't infer every frame)

Inference on every frame is the usual cause of "infinite" processing. Sample frames instead.

```env
VIDEO_DETECTION_FRAME_STRIDE=5   # 30 FPS → YOLO on every 5th frame
VIDEO_YOLO_IMGSZ=416             # optional; reuse existing YOLO_IMGSZ if centralized
```

Run YOLO on every Nth frame while still writing a usable annotated output. Sanity check: a 13 s clip at 30 FPS is ~390 frames; with stride 5 that is ~78 inferences, not 390.

### Fix 3 — Deduplicate video violations

An uploaded video must **not** create one row per frame. Save at most one record per violation type per upload.

Track the best (highest-confidence) evidence frame per normalized type during the loop, then write rows **after** the loop — never inside it. Apply a hard cap.

```python
best_evidence_by_type = {}   # type -> best detection/frame
# in the loop: normalize label, keep the highest-confidence evidence per type
# after the loop: create one DB record per type from best evidence, up to the cap
```

```env
MAX_VIDEO_VIOLATIONS_PER_UPLOAD=5
```

Example: 50 `NO-Mask` detections → 1 `NO-Mask` row. `NO-Mask` + `NO-Hardhat` + `NO-Safety Vest` → 3 rows (subject to the cap).

### Fix 4 — One summary alert per upload

Sending an alert per detection is what produces 40-50 emails. Send a single summary after processing completes, only when video alerts are enabled.

```env
VIDEO_ALERT_MODE=summary
VIDEO_ALERTS_ENABLED=true
```

The summary should name the file/upload, the detected violation types, the saved-record count, and the result status. Example body: `Video upload processed. Detected violations: NO-Mask, NO-Hardhat. Saved records: 2.`

### Fix 5 — Cache + query refresh

Counts that only update on manual refresh mean the cache/queries aren't invalidated.

Backend: invalidate the dashboard summary cache (and violation/stats/analytics caches if used) after the video's violations are saved.

Frontend: after a successful upload, invalidate/refetch `dashboard-summary`, `violations`, `violation-stats`, and `charts`/`analytics` if present. Add the smallest safe set of invalidations — don't over-refetch.

## Configuration reference (consolidated)

```env
VIDEO_DETECTION_FRAME_STRIDE=5
VIDEO_YOLO_IMGSZ=416
MAX_VIDEO_VIOLATIONS_PER_UPLOAD=5
VIDEO_ALERT_MODE=summary
VIDEO_ALERTS_ENABLED=true
```

## Logging (useful, not spammy)

Backend: `[VIDEO_UPLOAD] received`, `[VIDEO_PROCESS] opened fps/frame_count/duration`, `[VIDEO_DEDUPE] type=... action=tracked_best|skipped_duplicate`, `[VIDEO_VIOLATION_SAVE_SUCCESS] id/type`, `[VIDEO_ALERT_SUMMARY] sent/saved_count`, `[CACHE_INVALIDATE] reason=video_upload_completed`, `[VIDEO_PROCESS] completed processed_frames/saved_violations`, `[VIDEO_PROCESS_FAILED] error`.

Frontend: `[VIDEO_UI] upload started`, `response received`, `result url set`, `processing false`, `invalidated queries`, `error=...`.

## Verification (use a ~13 s MP4)

1. Processing reaches `completed` or `failed`; the page stops loading.
2. The annotated result appears.
3. Repeated `NO-Mask` detections produce exactly **one** `NO-Mask` row.
4. Total saved video violations respect the cap.
5. At most **one** summary email is sent.
6. Dashboard count updates without a full browser refresh.
7. Violations page shows the summarized records.
8. **Live camera** logging still works.
9. **Image upload** detection still works.

```bash
python -m pytest tests/unit -q
cd frontend && npm run build   # only if frontend files changed
```

## Report format

**Before coding:** (1) what's already fixed, (2) what's still broken, (3) root cause, (4) file/log evidence, (5) file-by-file plan, (6) dedup strategy, (7) alert strategy, (8) tests to run — then wait for approval.

**After implementing:** (1) files changed, (2) root cause fixed, (3) lifecycle fix, (4) stride/performance fix, (5) dedup, (6) summary-alert behavior, (7) cache/query refresh, (8) commands/tests run, (9) manual verification steps, (10) remaining risks or known-unrelated failures.