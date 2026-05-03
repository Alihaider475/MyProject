from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import uuid

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.detector import PPEDetector
from app.core.frame_annotator import annotate_frame
from app.core.logging import get_logger
from app.db.models import Camera, Violation
from app.db.session import get_db

logger = get_logger(__name__)
router = APIRouter(prefix="/detect", tags=["detect"])

MAX_IMAGE_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_VIDEO_BYTES = 200 * 1024 * 1024  # 200 MB
VIDEO_SAMPLE_EVERY_N = 30             # analyse 1 frame every N frames (~1 fps for 30 fps video)

# Maps each PPE item → its corresponding "missing" violation class in the model.
PPE_PAIRS: dict[str, str] = {
    "Hardhat": "NO-Hardhat",
    "Mask": "NO-Mask",
    "Safety Vest": "NO-Safety Vest",
}


def _build_violations(class_counts: dict[str, int], detections: list) -> tuple[list[dict], int]:
    """Per-PPE-item compliance: violation / compliant / not assessed."""
    rows = []
    violation_total = 0
    for ppe_item, missing_class in PPE_PAIRS.items():
        missing_count = class_counts.get(missing_class, 0)
        present_count = class_counts.get(ppe_item, 0)

        if missing_count > 0:
            max_conf = max(
                (d.confidence for d in detections if d.class_name == missing_class),
                default=0.0,
            )
            status = "violation"
            violation_total += missing_count
        elif present_count > 0:
            max_conf = max(
                (d.confidence for d in detections if d.class_name == ppe_item),
                default=0.0,
            )
            status = "compliant"
        else:
            max_conf = 0.0
            status = "not_assessed"

        rows.append({
            "ppe_item": ppe_item,
            "violation_class": missing_class,
            "status": status,
            "violation_count": missing_count,
            "compliant_count": present_count,
            "max_confidence": round(float(max_conf), 3) if max_conf > 0 else None,
        })
    return rows, violation_total


async def _get_or_create_upload_camera(db: AsyncSession) -> int:
    """Return the id of the 'Image Upload' camera, creating it if needed."""
    result = await db.execute(
        select(Camera.id).where(Camera.source_uri == "upload").limit(1)
    )
    camera_id = result.scalar_one_or_none()
    if camera_id is None:
        cam = Camera(name="Image Upload", source_type="file", source_uri="upload")
        db.add(cam)
        await db.commit()
        await db.refresh(cam)
        camera_id = cam.id
    return camera_id


@router.get("/classes")
async def list_classes(request: Request):
    """All classes the loaded YOLO model can detect."""
    detector: PPEDetector = request.app.state.detector
    return {
        "model_path": detector.model.ckpt_path if hasattr(detector.model, "ckpt_path") else None,
        "confidence_threshold": detector.confidence,
        "classes": [
            {"class_id": cid, "class_name": name}
            for cid, name in sorted(detector.class_names.items())
        ],
    }


@router.post("/image")
async def detect_image(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Run detection on an uploaded image and return detections + annotated preview."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"Expected an image, got {file.content_type!r}")

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail=f"Image too large (>{MAX_IMAGE_BYTES // 1024 // 1024} MB)")

    loop = asyncio.get_running_loop()
    nparr = np.frombuffer(raw, np.uint8)
    frame = await loop.run_in_executor(None, cv2.imdecode, nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image (corrupt or unsupported format)")

    detector: PPEDetector = request.app.state.detector
    detections = await loop.run_in_executor(None, detector.detect, frame)

    class_counts: dict[str, int] = {}
    for d in detections:
        class_counts[d.class_name] = class_counts.get(d.class_name, 0) + 1

    hardhat = class_counts.get("Hardhat", 0)
    vest = class_counts.get("Safety Vest", 0)
    person = class_counts.get("Person", 0)

    annotated = await loop.run_in_executor(
        None, annotate_frame, frame, detections, hardhat, vest, person, False
    )
    _, jpeg = await loop.run_in_executor(
        None, lambda: cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    )
    img_b64 = base64.b64encode(jpeg.tobytes()).decode("ascii")

    # Classes that exist in the model but were NOT detected in this image
    all_classes = set(detector.class_names.values())
    detected_classes = set(class_counts.keys())
    missing_classes = sorted(all_classes - detected_classes)

    # Per-PPE-item compliance breakdown
    violations, violation_total = _build_violations(class_counts, detections)
    person_count = class_counts.get("Person", 0)

    logger.info(
        "Image detect: %d detections (%s) | %d violations",
        len(detections),
        ", ".join(f"{k}={v}" for k, v in class_counts.items()) or "none",
        violation_total,
    )

    saved_violation_ids: list[int] = []
    if violation_total > 0:
        camera_id = await _get_or_create_upload_camera(db)

        # Save annotated frame to disk
        upload_dir = os.path.join(settings.FRAMES_DIR, "image_uploads")
        os.makedirs(upload_dir, exist_ok=True)
        safe_name = (file.filename or "upload").replace("/", "_").replace("\\", "_")
        frame_filename = f"{uuid.uuid4().hex}_{safe_name}"
        if not frame_filename.lower().endswith(".jpg"):
            frame_filename += ".jpg"
        frame_abs_path = os.path.join(upload_dir, frame_filename)
        await asyncio.get_running_loop().run_in_executor(
            None, lambda: open(frame_abs_path, "wb").write(jpeg.tobytes())
        )
        relative_frame_path = f"image_uploads/{frame_filename}"

        for row in violations:
            if row["status"] == "violation":
                v = Violation(
                    camera_id=camera_id,
                    violation_type=row["violation_class"],
                    confidence=row["max_confidence"] or 0.0,
                    frame_path=relative_frame_path,
                )
                db.add(v)

        await db.commit()

        # Collect IDs after commit
        result_ids = await db.execute(
            select(Violation.id)
            .where(Violation.camera_id == camera_id)
            .where(Violation.frame_path == relative_frame_path)
        )
        saved_violation_ids = list(result_ids.scalars().all())

    return {
        "filename": file.filename,
        "image_size": {"width": frame.shape[1], "height": frame.shape[0]},
        "total_detections": len(detections),
        "class_counts": class_counts,
        "missing_classes": missing_classes,
        "person_count": person_count,
        "violation_total": violation_total,
        "violations": violations,
        "detections": [
            {
                "class_id": d.class_id,
                "class_name": d.class_name,
                "confidence": round(float(d.confidence), 3),
                "bbox": [d.x1, d.y1, d.x2, d.y2],
            }
            for d in sorted(detections, key=lambda x: -x.confidence)
        ],
        "annotated_image_base64": img_b64,
        "saved_violation_ids": saved_violation_ids,
    }


async def _get_or_create_video_camera(db: AsyncSession) -> int:
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


@router.post("/video")
async def detect_video(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Run PPE detection on an uploaded video file (frame-sampled) and return results."""
    allowed_types = {"video/mp4", "video/avi", "video/x-msvideo", "video/quicktime",
                     "video/x-matroska", "video/webm", "video/mpeg"}
    if not file.content_type or file.content_type.split(";")[0].strip() not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Expected a video file (mp4/avi/mov/mkv/webm), got {file.content_type!r}"
        )

    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(raw) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Video too large (>{MAX_VIDEO_BYTES // 1024 // 1024} MB)"
        )

    # Write to a temp file so OpenCV can open it
    suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        loop = asyncio.get_running_loop()
        detector: PPEDetector = request.app.state.detector

        def _process_video() -> dict:
            cap = cv2.VideoCapture(tmp_path)
            if not cap.isOpened():
                raise ValueError("Could not open video file")

            fps      = cap.get(cv2.CAP_PROP_FPS) or 30.0
            total    = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width    = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total / fps if fps > 0 else 0

            frame_results   = []   # per-sampled-frame data
            global_counts   = {}
            total_violations = 0
            thumbnail_b64   = None  # first violation frame thumbnail
            first_viol_frame_img = None

            frame_idx = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % VIDEO_SAMPLE_EVERY_N != 0:
                    frame_idx += 1
                    continue

                detections = detector.detect(frame)
                class_counts: dict[str, int] = {}
                for d in detections:
                    class_counts[d.class_name] = class_counts.get(d.class_name, 0) + 1
                    global_counts[d.class_name] = global_counts.get(d.class_name, 0) + 1

                violations, viol_count = _build_violations(class_counts, detections)
                total_violations += viol_count
                timestamp_sec = frame_idx / fps

                # Build annotated thumbnail (small)
                hardhat = class_counts.get("Hardhat", 0)
                vest    = class_counts.get("Safety Vest", 0)
                person  = class_counts.get("Person", 0)
                from app.core.frame_annotator import annotate_frame
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

                frame_idx += 1

            cap.release()

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
                "global_class_counts": global_counts,
                "total_violations": total_violations,
                "frame_results": frame_results,
                "thumbnail_base64": thumbnail_b64,
            }

        data = await loop.run_in_executor(None, _process_video)

        if data["total_violations"] > 0:
            camera_id = await _get_or_create_video_camera(db)
            upload_dir = os.path.join(settings.FRAMES_DIR, "video_uploads")
            os.makedirs(upload_dir, exist_ok=True)
            safe_name = (file.filename or "upload").replace("/", "_").replace("\\", "_")

            saved_violation_ids: list[int] = []
            for fr in data["frame_results"]:
                if fr["violation_total"] == 0:
                    continue
                # Save the annotated frame jpeg
                frame_filename = f"{uuid.uuid4().hex}_{fr['frame_index']}_{safe_name}.jpg"
                frame_abs_path = os.path.join(upload_dir, frame_filename)
                frame_bytes = base64.b64decode(fr["annotated_frame_base64"])
                with open(frame_abs_path, "wb") as fh:
                    fh.write(frame_bytes)
                relative_frame_path = f"video_uploads/{frame_filename}"

                for row in fr["violations"]:
                    if row["status"] == "violation":
                        v = Violation(
                            camera_id=camera_id,
                            violation_type=row["violation_class"],
                            confidence=row["max_confidence"] or 0.0,
                            frame_path=relative_frame_path,
                        )
                        db.add(v)

            await db.commit()

            result_ids = await db.execute(
                select(Violation.id).where(Violation.camera_id == camera_id)
            )
            saved_violation_ids = list(result_ids.scalars().all())[-data["total_violations"]:]
        else:
            saved_violation_ids = []

        logger.info(
            "Video detect '%s': %d sampled frames, %d violations",
            file.filename, data["sampled_frames"], data["total_violations"]
        )

        return {
            "filename": file.filename,
            "video_info": {
                "fps": data["fps"],
                "total_frames": data["total_frames"],
                "width": data["width"],
                "height": data["height"],
                "duration_sec": data["duration_sec"],
            },
            "sampled_frames": data["sampled_frames"],
            "sample_interval": VIDEO_SAMPLE_EVERY_N,
            "global_class_counts": data["global_class_counts"],
            "total_violations": data["total_violations"],
            "frame_results": data["frame_results"],
            "thumbnail_base64": data["thumbnail_base64"],
            "saved_violation_ids": saved_violation_ids,
        }

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
