from __future__ import annotations

import asyncio
import base64
import json
import os
import uuid
from datetime import datetime

import cv2
from sqlalchemy import select

from backend.alerts.dispatch_helpers import dispatch_alerts_background
from backend.core.config import settings
from backend.core.logging import get_logger
from backend.database.connection import AsyncSessionLocal
from backend.database.models import Camera, Violation, VideoJob
from backend.detection.detector import PPEDetector
from backend.detection.frame_annotator import annotate_frame
from backend.detection.frame_violations import build_violations, compress_and_save
from backend.detection.violation_checker import ViolationEvent
from backend.utils.cache import invalidate_backend_cache

logger = get_logger(__name__)


def _process_video_sync(tmp_path: str, detector: PPEDetector) -> dict:
    """Run YOLO over a sampled subset of frames in a video file.

    Runs inside a thread-pool executor (see ``run_video_job``) — never call this
    directly on the event loop.
    """
    cap = cv2.VideoCapture(tmp_path)
    if not cap.isOpened():
        raise ValueError("Could not open video file")

    # OpenCV reports 0 (or garbage) for fps/frame-count on some codecs/containers.
    # Guard both so the stride math and timestamp/progress logic can never divide
    # by zero or widen the stride against a bogus total.
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total < 0:
        total = 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total / fps if fps > 0 else 0

    # Widen (never narrow) the configured stride so a very long video can't
    # balloon into thousands of YOLO inferences — short videos sample at exactly
    # VIDEO_SAMPLE_EVERY_N, same as before this cap existed.
    sample_every_n = settings.VIDEO_SAMPLE_EVERY_N
    if settings.VIDEO_MAX_SAMPLED_FRAMES > 0 and total > 0:
        sample_every_n = max(sample_every_n, total // settings.VIDEO_MAX_SAMPLED_FRAMES)

    logger.info(
        "[VIDEO_PROCESS] opened=True fps=%.2f frame_count=%d duration=%.2fs "
        "resolution=%dx%d sample_every_n=%d",
        fps, total, duration, width, height, sample_every_n,
    )

    frame_results = []   # per-sampled-frame data
    global_counts = {}   # cumulative detections across all frames
    peak_counts = {}     # max per-frame count for each class (≈ unique objects on-screen)
    total_violations = 0
    thumbnail_b64 = None  # first violation frame thumbnail
    first_viol_frame_img = None

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                # End of video (or unreadable frame) — the ONLY exit from this
                # loop. Never spin after cap.read() reports no frame.
                logger.info(
                    "[VIDEO_PROCESS] end of video reached at frame_idx=%d "
                    "(sampled=%d)", frame_idx, len(frame_results),
                )
                break

            if frame_idx % sample_every_n != 0:
                frame_idx += 1
                continue

            # Use the smaller video-only input size — live camera detection is
            # untouched (it calls detect() without imgsz and keeps YOLO_IMGSZ).
            detections = detector.detect(frame, imgsz=settings.VIDEO_YOLO_IMGSZ)
            class_counts: dict[str, int] = {}
            for d in detections:
                class_counts[d.class_name] = class_counts.get(d.class_name, 0) + 1
                global_counts[d.class_name] = global_counts.get(d.class_name, 0) + 1

            # Track the highest count seen in any single frame for each class.
            # This is what the dashboard should show — "2 people in this video"
            # not "42 person-detections summed across 21 sampled frames".
            for cls, cnt in class_counts.items():
                if cnt > peak_counts.get(cls, 0):
                    peak_counts[cls] = cnt

            violations, viol_count = build_violations(
                detections, frame.shape[1], frame.shape[0]
            )
            total_violations += viol_count
            timestamp_sec = frame_idx / fps

            # JPEG/base64 encoding is the most expensive part of this loop after
            # YOLO inference itself. Most sampled frames have no violation and
            # the frontend timeline only needs a real thumbnail for frames that
            # do (clean frames render a placeholder) — so skip the encode for
            # them entirely. The video's overall thumbnail still needs *some*
            # frame image even if nothing violates, so the very first sampled
            # frame is always encoded as a fallback.
            frame_b64 = None
            if viol_count > 0 or frame_idx == 0:
                hardhat = class_counts.get("Hardhat", 0)
                vest = class_counts.get("Safety Vest", 0)
                person = class_counts.get("Person", 0)
                annotated = annotate_frame(frame, detections, hardhat, vest, person, False)
                _, jpeg_bytes = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
                frame_b64 = base64.b64encode(jpeg_bytes.tobytes()).decode("ascii")

                if viol_count > 0 and first_viol_frame_img is None:
                    first_viol_frame_img = jpeg_bytes.tobytes()

            frame_results.append({
                "frame_index": frame_idx,
                "timestamp_sec": round(timestamp_sec, 2),
                "total_detections": len(detections),
                "class_counts": class_counts,
                "person_count": class_counts.get("Person", 0),
                "violation_total": viol_count,
                "violations": violations,
                "annotated_frame_base64": frame_b64,
            })

            logger.debug(
                "[VIDEO_PROCESS] frame_index=%d / total=%d sampled=%d "
                "detections=%d violations=%d",
                frame_idx, total, len(frame_results), len(detections), viol_count,
            )

            frame_idx += 1
    finally:
        # Always release the capture even if detection raises mid-loop, so the
        # temp file handle/decoder is never leaked on the failure path.
        cap.release()

    logger.info(
        "[VIDEO_PROCESS] completed sampled=%d violations=%d",
        len(frame_results), total_violations,
    )

    if first_viol_frame_img:
        thumbnail_b64 = base64.b64encode(first_viol_frame_img).decode("ascii")
    elif frame_results:
        thumbnail_b64 = frame_results[0]["annotated_frame_base64"]

    return {
        "fps": round(fps, 2),
        "total_frames": total,
        "width": width,
        "height": height,
        "duration_sec": round(duration, 2),
        "sampled_frames": len(frame_results),
        "sample_interval": sample_every_n,
        "global_class_counts": global_counts,    # cumulative — kept for backwards compat
        "peak_class_counts": peak_counts,         # max in any one frame — what users want
        "total_violations": total_violations,
        "frame_results": frame_results,
        "thumbnail_base64": thumbnail_b64,
    }


async def _get_or_create_video_camera(db) -> int:
    """Return the id of the 'Video Upload' camera, creating it if needed."""
    result = await db.execute(
        select(Camera.id).where(Camera.source_uri == "video_upload").limit(1)
    )
    camera_id = result.scalar_one_or_none()
    if camera_id is None:
        cam = Camera(name="Video Upload", source_type="file", source_uri="video_upload")
        db.add(cam)
        await db.commit()
        await db.refresh(cam)
        camera_id = cam.id
    return camera_id


async def _set_job_status(db, job_id: int, **fields) -> None:
    result = await db.execute(select(VideoJob).where(VideoJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        logger.error("VideoJob %s vanished mid-processing", job_id)
        return
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = datetime.utcnow()
    await db.commit()


async def run_video_job(job_id: int, tmp_path: str, filename: str, detector: PPEDetector) -> None:
    """Background body for a submitted video-upload job.

    Scheduled via FastAPI ``BackgroundTasks`` from ``backend/routes/detect.py`` —
    runs AFTER the HTTP response has already been sent, so it opens its own DB
    session rather than reusing the request-scoped one (which may be closed by
    the time this runs), and keeps the CPU-bound frame loop off the event loop
    via ``run_in_executor`` exactly like the previous synchronous route did.
    """
    loop = asyncio.get_running_loop()

    logger.info("[VIDEO_JOB] %s started: filename=%s", job_id, filename)

    async with AsyncSessionLocal() as db:
        try:
            await _set_job_status(db, job_id, status="processing")
            logger.info("[VIDEO_JOB] %s status=processing", job_id)

            data = await loop.run_in_executor(None, _process_video_sync, tmp_path, detector)

            saved_violation_ids: list[int] = []
            if data["total_violations"] > 0:
                camera_id = await _get_or_create_video_camera(db)
                upload_dir = os.path.join(settings.FRAMES_DIR, "video_uploads")
                os.makedirs(upload_dir, exist_ok=True)
                safe_name = (filename or "upload").replace("/", "_").replace("\\", "_")

                # Deduplicate across frames: a clip with a breach in many sampled
                # frames must NOT write one row per frame (that produced the 40-50
                # duplicate rows). Aggregate per type for the summary alert AND keep
                # the single highest-confidence frame per type as its evidence, then
                # write exactly one row per type AFTER the loop.
                agg_counts: dict[str, int] = {}      # {violation_type: total across all frames}
                agg_conf: dict[str, float] = {}      # {violation_type: max confidence seen}
                best_evidence: dict[str, dict] = {}  # {violation_type: {conf, frame_b64, frame_index}}
                for fr in data["frame_results"]:
                    if fr["violation_total"] == 0:
                        continue
                    for row in fr["violations"]:
                        if row["status"] != "violation" or row["violation_count"] <= 0:
                            continue
                        vclass = row["violation_class"]
                        agg_counts[vclass] = agg_counts.get(vclass, 0) + row["violation_count"]
                        conf = row["max_confidence"] or 0.0
                        if conf > agg_conf.get(vclass, 0.0):
                            agg_conf[vclass] = conf
                        cur = best_evidence.get(vclass)
                        if cur is None or conf > cur["conf"]:
                            best_evidence[vclass] = {
                                "conf": conf,
                                "frame_b64": fr["annotated_frame_base64"],
                                "frame_index": fr["frame_index"],
                            }
                            logger.info(
                                "[VIDEO_DEDUPE] type=%s action=tracked_best conf=%.3f", vclass, conf
                            )

                # Persist one row per type (highest-confidence first), capped.
                types_to_save = sorted(
                    best_evidence, key=lambda k: agg_conf.get(k, 0.0), reverse=True
                )
                cap = settings.MAX_VIDEO_VIOLATIONS_PER_UPLOAD
                if cap > 0:
                    types_to_save = types_to_save[:cap]

                created: list[Violation] = []
                first_frame_path: str | None = None
                for vclass in types_to_save:
                    ev = best_evidence[vclass]
                    frame_filename = f"{uuid.uuid4().hex}_{ev['frame_index']}_{safe_name}.jpg"
                    frame_abs_path = os.path.join(upload_dir, frame_filename)
                    frame_bytes = base64.b64decode(ev["frame_b64"])
                    await loop.run_in_executor(None, compress_and_save, frame_abs_path, frame_bytes)
                    relative_frame_path = f"video_uploads/{frame_filename}"
                    if first_frame_path is None:
                        first_frame_path = relative_frame_path
                    violation = Violation(
                        camera_id=camera_id,
                        violation_type=vclass,
                        confidence=agg_conf.get(vclass, 0.0),
                        frame_path=relative_frame_path,
                    )
                    db.add(violation)
                    created.append(violation)

                # Flush to populate PKs while the session is alive, capture the ids,
                # then commit — the old "last N rows for this camera" slice assumed
                # one row per detected violation and broke once we dedupe.
                await db.flush()
                saved_violation_ids = [v.id for v in created]
                await db.commit()

                # Summary endpoints are cached ~30s; clear them so Dashboard /
                # Violations reflect the new rows without waiting for the TTL.
                await invalidate_backend_cache()
                logger.info("[CACHE_INVALIDATE] reason=video_upload_completed")

                # Fire ONE summary alert for the whole video — aggregated type counts.
                if saved_violation_ids and agg_counts:
                    primary_type = max(agg_counts, key=lambda k: agg_counts[k])
                    event = ViolationEvent(
                        camera_id=camera_id,
                        violation_type=primary_type,
                        confidence=agg_conf.get(primary_type, 0.0),
                        frame_path=first_frame_path,
                        violation_id=saved_violation_ids[0],
                        violation_counts=agg_counts,
                    )
                    dispatch_alerts_background(
                        event, name=f"video-upload-alerts-{saved_violation_ids[0]}"
                    )
                    logger.info(
                        "Video upload alert scheduled: violation_id=%s types=%s",
                        saved_violation_ids[0], agg_counts,
                    )

            logger.info(
                "Video detect '%s': %d sampled frames, %d violations",
                filename, data["sampled_frames"], data["total_violations"]
            )

            result_payload = {
                "filename": filename,
                "video_info": {
                    "fps": data["fps"],
                    "total_frames": data["total_frames"],
                    "width": data["width"],
                    "height": data["height"],
                    "duration_sec": data["duration_sec"],
                },
                "sampled_frames": data["sampled_frames"],
                "sample_interval": data["sample_interval"],
                "global_class_counts": data["global_class_counts"],
                "peak_class_counts": data["peak_class_counts"],
                "total_violations": data["total_violations"],
                "frame_results": data["frame_results"],
                "thumbnail_base64": data["thumbnail_base64"],
                "saved_violation_ids": saved_violation_ids,
            }

            await _set_job_status(db, job_id, status="done", result_json=json.dumps(result_payload))
            logger.info("[VIDEO_JOB] %s status=done", job_id)

        except Exception as exc:
            logger.error("[VIDEO_PROCESS_FAILED] job=%s error=%s", job_id, exc, exc_info=True)
            # Record the terminal "error" state on a FRESH session — the request
            # session above may be in a broken/rolled-back state after the failure
            # (e.g. a mid-transaction DB error), and reusing it could let the write
            # silently fail, leaving the job stuck in "processing"/"queued" forever.
            try:
                async with AsyncSessionLocal() as err_db:
                    await _set_job_status(
                        err_db, job_id, status="error", error_message=str(exc)
                    )
                logger.info("[VIDEO_JOB] %s status=error recorded", job_id)
            except Exception:
                logger.error(
                    "[VIDEO_JOB] %s FAILED to record error status — job may hang",
                    job_id, exc_info=True,
                )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
