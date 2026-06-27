---
name: safesite-face-recognition-fix
description: >
  Fix worker identity misassignment in SafeSite AI PPE detection systems. Use this skill
  whenever the face recognition pipeline incorrectly assigns PPE violations to a known
  worker, such as "Abid", when the uploaded image or live frame does not contain a clear
  matching enrolled face. Covers FastAPI backend face recognition logic, SQLAlchemy
  violation logging, fine/challan generation, database schema, upload detection, and
  React frontend display of unidentified workers.
---

# SafeSite AI — Face Recognition Worker Assignment Fix

## Project Context

SafeSite AI uses:

- FastAPI backend
- SQLAlchemy ORM
- SQLite for development and PostgreSQL/Supabase for production
- React frontend
- YOLO PPE detection
- DeepFace / FaceNet worker identification
- Violation logging with optional worker identity
- Fine/challan generation only when a worker is confidently identified

Do **not** use Django patterns in this project. Do not create Django views, Django migrations,
Django decorators, Django models, or Django ORM queries. All implementation must follow the
existing FastAPI + SQLAlchemy structure already present in the SafeSite AI codebase.

---

## Problem Summary

When a user uploads an image for PPE detection, every violation is incorrectly assigned to one
worker, for example "Abid", even when:

- the image contains no face,
- the face does not match any registered worker,
- the face is unclear, masked, side-facing, or cropped,
- the match confidence is too low,
- only one worker exists in the database,
- the backend is falling back to the nearest embedding.

This is a critical identity and accountability bug.

The system must never assign a worker only because that worker is the closest embedding.
If there is no confident face match, the violation must be saved as:

```text
worker_id = null
worker_name = "Unidentified"
fine/challan = not generated
```

---

## Industry-Safe Identity Rule

Use this decision policy everywhere worker identification is used:

```text
No face detected                       -> worker_id = None
Multiple ambiguous faces               -> worker_id = None
Face embedding extraction failed       -> worker_id = None
Best match distance above threshold    -> worker_id = None
Best and second-best too close         -> worker_id = None
Only one clear confident match         -> assign matched worker_id
```

Nearest worker is not equal to identified worker.

A worker should only be assigned when:

1. exactly one usable face is detected, or the face is correctly associated with the detected person crop,
2. the best embedding distance is below `FACE_MATCH_THRESHOLD`,
3. the best match is clearly better than the second-best match using `FACE_MATCH_MARGIN`,
4. the result passes all validation checks.

Recommended environment values:

```env
FACE_MATCH_THRESHOLD=0.45
FACE_MATCH_MARGIN=0.08
FACE_DEBUG_LOGS=true
```

Lower threshold means stricter matching. Tune based on the exact DeepFace model and distance
metric used in the project.

---

## Step 1 — Explore the Codebase First

Before editing anything, inspect the existing files and map the real call chain.

Search backend:

```bash
grep -R "DeepFace\|Facenet\|face_encoding\|embedding\|identify" backend -n --include="*.py"
grep -R "worker_id\|worker_name\|Worker" backend -n --include="*.py"
grep -R "Violation\|create_violation\|log_violation" backend -n --include="*.py"
grep -R "Fine\|challan\|fine" backend -n --include="*.py"
grep -R "detect\|upload\|image" backend/routes backend/detection -n --include="*.py"
```

Search frontend:

```bash
grep -R "worker_id\|worker_name\|worker?.name\|Unidentified\|Abid" frontend/src -n
```

Map the complete flow:

```text
upload image
  -> run YOLO PPE detection
  -> detect/extract face
  -> create embedding
  -> compare with enrolled workers
  -> return worker_id or None
  -> create violation
  -> optionally create fine/challan
  -> return response
  -> frontend displays worker
```

Do not implement until the actual files and functions are identified.

---

## Step 2 — Remove Unsafe Fallbacks

Find and remove any logic like this:

```python
# Unsafe examples - remove these patterns
worker_id = 1
worker_id = worker_id or 1
worker = db.query(Worker).first()
return workers[0].id
return best_worker.id  # without threshold validation
default_worker_id = 1
```

Also check the SQLAlchemy model:

```python
# Unsafe
worker_id = Column(Integer, ForeignKey("workers.id"), default=1)

# Safe
worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True, default=None)
```

Search frontend for unsafe fallback:

```jsx
// Unsafe
const workerName = violation.worker?.name || "Abid";
const workerName = violation.worker_name || "Abid";

// Safe
const workerName = violation.worker?.name ?? violation.worker_name ?? "Unidentified";
```

---

## Step 3 — Add Safe Face Matching

Implement threshold-gated matching in the existing face recognition module.

Expected behavior:

```python
def identify_worker_from_embedding(face_embedding, db):
    """
    Return:
      (worker_id, match_distance, decision_reason)

    worker_id must be None unless the match is confident.
    """
```

Safe logic:

```python
def identify_worker_from_embedding(face_embedding, db):
    if face_embedding is None:
        return None, None, "no_embedding"

    threshold = settings.FACE_MATCH_THRESHOLD
    margin = settings.FACE_MATCH_MARGIN

    enrolled_workers = get_enrolled_workers_with_embeddings(db)

    if not enrolled_workers:
        return None, None, "no_enrolled_workers"

    distances = []

    for worker in enrolled_workers:
        stored_embedding = load_worker_embedding(worker)
        distance = compute_embedding_distance(face_embedding, stored_embedding)
        distances.append((worker.id, distance))

    distances.sort(key=lambda item: item[1])

    best_worker_id, best_distance = distances[0]
    second_best_distance = distances[1][1] if len(distances) > 1 else None

    if best_distance > threshold:
        return None, best_distance, "below_threshold"

    if second_best_distance is not None:
        if (second_best_distance - best_distance) < margin:
            return None, best_distance, "ambiguous_match"

    return best_worker_id, best_distance, "matched"
```

Important notes:

- Use the project’s existing embedding storage format.
- Do not invent new tables unless absolutely required.
- Do not change the public API format unnecessarily.
- Add logs for `best_distance`, `second_best_distance`, `threshold`, `margin`, and final decision.

Example log format:

```python
logger.info(
    "[FaceID] decision=%s worker_id=%s best=%.4f second=%s threshold=%.4f margin=%.4f",
    decision,
    worker_id,
    best_distance if best_distance is not None else -1,
    second_best_distance,
    threshold,
    margin,
)
```

---

## Step 4 — Uploaded Image Detection Must Be Strict

Uploaded test images should not force worker identity.

Many PPE test images contain:

- no face,
- hidden face,
- helmet/mask-covered face,
- side profile,
- cropped body,
- stock dataset workers not enrolled in the system.

For upload detection:

```text
PPE violation detected + no confident face match -> save violation as Unidentified
```

Expected response for unidentified upload violation:

```json
{
  "worker_id": null,
  "worker_name": "Unidentified"
}
```

If the current upload route forces a worker match, remove that behavior.

---

## Step 5 — Violation Logging Rules

Update violation creation logic:

```python
violation = Violation(
    worker_id=worker_id,  # None is valid
    violation_type=violation_type,
    camera_id=camera_id,
    confidence=confidence,
    frame_path=frame_path,
)
db.add(violation)
db.commit()
```

Rules:

- `worker_id=None` must be valid.
- No fallback worker.
- No default worker.
- No fine/challan for unidentified violation.
- Fine/challan only when `worker_id is not None`.

Fine/challan guard:

```python
if violation.worker_id is None:
    logger.info("[Fine] Skipped fine generation for unidentified violation id=%s", violation.id)
    return None

create_fine_for_violation(violation)
```

---

## Step 6 — Database Safety

Check SQLAlchemy models and migrations/schema creation.

Required model behavior:

```python
worker_id = Column(Integer, ForeignKey("workers.id"), nullable=True, default=None)
```

If the project does not use Alembic and relies on `create_all`, do not blindly change existing
production tables. Provide a safe migration note or SQL patch.

SQLite example:

```sql
-- Verify whether worker_id has unsafe default behavior.
PRAGMA table_info(violations);
```

PostgreSQL example:

```sql
-- Remove unsafe default if it exists.
ALTER TABLE violations ALTER COLUMN worker_id DROP DEFAULT;

-- Allow unidentified violations.
ALTER TABLE violations ALTER COLUMN worker_id DROP NOT NULL;
```

Do not run destructive database changes automatically.

---

## Step 7 — Frontend Display Rules

In violation history and upload detection result:

```text
worker_id exists     -> show worker name
worker_id is null    -> show "Unidentified"
```

React example:

```jsx
function getWorkerName(violation) {
  return violation?.worker?.name
    ?? violation?.worker_name
    ?? "Unidentified";
}
```

But make sure empty strings do not become fake names:

```jsx
const name = getWorkerName(violation);
```

Search and remove hardcoded fallback names:

```bash
grep -R "Abid\|defaultWorker\|fallbackWorker\|workerName.*||" frontend/src -n
```

---

## Step 8 — Tests to Add

Use the existing pytest structure in the project. Do not add Django tests.

Minimum backend regression tests:

```text
1. Uploaded image with no face -> worker_id is None.
2. Uploaded image with unknown face -> worker_id is None.
3. Low-confidence face match -> worker_id is None.
4. Ambiguous match where second-best is too close -> worker_id is None.
5. Enrolled worker above threshold -> correct worker_id is returned.
6. Unidentified violation -> no fine/challan generated.
7. Violation model accepts worker_id=None.
```

Frontend tests if test setup exists:

```text
1. Violation row with worker_id=null displays "Unidentified".
2. Violation row with worker_id=null does not display "Abid".
```

If frontend tests are not configured, manually verify in browser.

---

## Step 9 — Cleanup Existing Wrong Data

Do not run cleanup automatically. Provide preview queries only.

PostgreSQL / SQLite-style preview:

```sql
SELECT v.id, v.created_at, v.violation_type, v.worker_id, w.name AS worker_name
FROM violations v
JOIN workers w ON w.id = v.worker_id
WHERE LOWER(w.name) = LOWER('Abid')
ORDER BY v.created_at DESC;
```

Safer upload-only preview if the schema has a source/upload field:

```sql
SELECT v.id, v.created_at, v.violation_type, v.worker_id, w.name AS worker_name
FROM violations v
JOIN workers w ON w.id = v.worker_id
WHERE LOWER(w.name) = LOWER('Abid')
  AND (
    v.source = 'upload'
    OR v.camera_id IS NULL
  )
ORDER BY v.created_at DESC;
```

Manual fix after review only:

```sql
-- Run only after confirming these are wrong uploaded/test violations.
-- UPDATE violations
-- SET worker_id = NULL
-- WHERE worker_id = (SELECT id FROM workers WHERE LOWER(name) = LOWER('Abid'))
--   AND (source = 'upload' OR camera_id IS NULL);
```

If the database schema does not contain `source`, adapt based on existing columns such as
`camera_id`, `frame_path`, or upload route metadata.

---

## Acceptance Criteria

The fix is complete only when all are true:

- Uploaded PPE image without a clear enrolled face is saved as `worker_id = null`.
- Frontend shows `Unidentified`, not Abid.
- Unknown faces are not assigned to nearest worker.
- Low-confidence matches are rejected.
- Ambiguous matches are rejected.
- Real enrolled worker can still be identified when confidence is high.
- Unidentified violations do not create fines/challans.
- Live camera detection still works.
- Worker registration/enrollment still works.
- Existing API consumers are not broken.
- Tests or manual verification prove the regression is fixed.

---

## Final Response Required From Claude Code

After implementation, respond with:

```text
Changed files:
- path/to/file.py — what changed
- path/to/component.jsx — what changed

Validation:
- tests run
- manual checks performed

Result:
- no-face upload -> Unidentified
- unknown face -> Unidentified
- known enrolled face -> correct worker
- unidentified violation -> no fine/challan
```
