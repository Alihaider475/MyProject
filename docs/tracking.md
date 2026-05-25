# DeepSORT Person Tracking Integration

## What It Does

The PPE detection system uses DeepSORT to assign persistent track IDs to each person in a camera feed. This enables per-person violation deduplication instead of per-camera deduplication.

**Before:** If 3 workers lack hardhats in the same camera, only 1 violation fires (cooldown suppresses the other 2).

**After:** Each tracked person gets their own violation + cooldown timer, so 3 workers without hardhats produce 3 separate violations.

## Deduplication Rules

| Scenario | Dedup Key | Cooldown |
|----------|-----------|----------|
| Tracking active (track_id set) | `(camera_id, track_id, violation_type)` | `TRACK_DEDUP_SECONDS` (300s) |
| Tracking inactive (no track_ids) | `(camera_id, violation_type)` | `ALERT_COOLDOWN_SECONDS` (60s) |

The system automatically detects whether tracking is active based on whether any Person detections have a `track_id`. If DeepSORT hasn't confirmed a track yet (or is disabled), the original global cooldown logic is used as a fallback.

## Configuration

Add to `.env` (all optional, defaults shown):

```env
TRACKING_ENABLED=True          # Set False to disable entirely
TRACK_DEDUP_SECONDS=300        # Per-track cooldown (seconds)
DEEPSORT_MAX_AGE=30            # Frames before a lost track is deleted
DEEPSORT_N_INIT=3              # Frames before a track is confirmed
DEEPSORT_MAX_COSINE_DISTANCE=0.3  # Re-ID matching threshold
DEEPSORT_EMBEDDER=mobilenet    # Appearance model (mobilenet, torchreid, clip_RN50)
```

## Kill Switch

Set `TRACKING_ENABLED=False` in `.env` and restart. This:
- Prevents PersonTracker from being created
- All Detection.track_id remain None
- ViolationChecker uses the original global dedup logic
- Zero behavioral change from the pre-tracking system

## Performance Notes

- DeepSORT's `update_tracks()` runs in a thread pool (`run_in_executor`) alongside YOLO, so it never blocks the async event loop.
- One DeepSort instance is created per camera (lazy-initialized on first frame).
- The appearance embedder (default: MobileNet) adds ~5-10ms per frame on GPU, ~20-40ms on CPU.
- Track states are automatically pruned after `TRACK_DEDUP_SECONDS * 2` to prevent memory leaks.

## Database Schema

Two columns added to the `violations` table:
- `track_id` (INTEGER, nullable) - DeepSORT track ID
- `person_bbox` (TEXT, nullable) - JSON `[x1, y1, x2, y2]` of the matched person bounding box
