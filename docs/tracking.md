# ByteTrack Person Tracking Integration

## What It Does

The PPE detection system uses Ultralytics' **ByteTrack** to assign persistent
track IDs to each person in a camera feed. This enables per-person violation
deduplication instead of per-camera deduplication.

**Before:** If 3 workers lack hardhats in the same camera, only 1 violation fires (cooldown suppresses the other 2).

**After:** Each tracked person gets their own violation + cooldown timer, so 3 workers without hardhats produce 3 separate violations.

ByteTrack is a **motion-only** tracker (Kalman filter + IoU association) with no
appearance/re-ID embedder. It replaced the previous DeepSORT + MobileNet pipeline,
whose CPU embedder was the tracking bottleneck.

## Deduplication Rules

| Scenario | Dedup Key | Cooldown |
|----------|-----------|----------|
| Tracking active (track_id set) | `(camera_id, track_id, violation_type)` | `TRACK_DEDUP_SECONDS` (300s) |
| Tracking inactive (no track_ids) | `(camera_id, violation_type)` | `ALERT_COOLDOWN_SECONDS` (60s) |

The system automatically detects whether tracking is active based on whether any Person detections have a `track_id`. If ByteTrack hasn't confirmed a track yet (or is disabled), the original global cooldown logic is used as a fallback.

## Configuration

Add to `.env` (all optional, defaults shown):

```env
TRACKING_ENABLED=True              # Set False to disable entirely
TRACK_DEDUP_SECONDS=300            # Per-track cooldown (seconds)
BYTETRACK_TRACK_BUFFER=30          # Frames a lost track is kept before deletion
BYTETRACK_MATCH_THRESH=0.8         # IoU matching threshold
BYTETRACK_TRACK_HIGH_THRESH=0.25   # High-confidence association threshold
BYTETRACK_TRACK_LOW_THRESH=0.1     # Low-confidence association threshold
BYTETRACK_NEW_TRACK_THRESH=0.25    # Score required to start a new track
```

## Kill Switch

Set `TRACKING_ENABLED=False` in `.env` and restart. This:
- Prevents PersonTracker from being created
- All Detection.track_id remain None
- ViolationChecker uses the original global dedup logic
- Zero behavioral change from the pre-tracking system

## Performance Notes

- ByteTrack has **no appearance embedder** — association is pure motion (Kalman
  prediction) + IoU, so per-frame tracking cost is minimal and far lower than the
  DeepSORT MobileNet embedder it replaced (which added ~20–40 ms/frame on CPU).
  This removes the previous execution jitter.
- `BYTETracker.update()` runs in a thread pool (`run_in_executor`) alongside YOLO, so it never blocks the async event loop.
- One `BYTETracker` instance is created per camera (lazy-initialized on first frame), keeping track IDs isolated across simultaneous feeds.
- Lost tracks are retained for `BYTETRACK_TRACK_BUFFER` frames so a briefly
  occluded person re-acquires the same ID; `TRACK_DEDUP_SECONDS` still guards
  against duplicate violation records.

## Database Schema

Two columns added to the `violations` table:
- `track_id` (INTEGER, nullable) - ByteTrack track ID
- `person_bbox` (TEXT, nullable) - JSON `[x1, y1, x2, y2]` of the matched person bounding box
