from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image as PILImage

from backend.camera.source import CameraSource
from backend.core.config import settings
from backend.detection.detector import PPEDetector
from backend.detection.face_recognizer import FaceRecognizer
from backend.detection.frame_annotator import annotate_frame
from backend.core.logging import get_logger
from backend.detection.violation_checker import ViolationChecker

logger = get_logger(__name__)


def _save_compressed(path: str, bgr_frame, max_width: int = 800) -> bool:
    try:
        img = PILImage.fromarray(cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB))
        w, h = img.size
        if w > max_width:
            img = img.resize((max_width, int(h * max_width / w)), PILImage.LANCZOS)
        img.save(path, "JPEG", quality=85, optimize=True)
        return True
    except Exception:
        return False


def _point_in_polygon(px: float, py: float, polygon: list) -> bool:
    """Ray-casting algorithm — returns True if (px, py) is inside the polygon."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _bgr_to_css(bgr: tuple[int, int, int]) -> str:
    b, g, r = bgr
    return f"#{r:02x}{g:02x}{b:02x}"


@dataclass
class _CameraEntry:
    camera_id: int
    source: CameraSource
    task: asyncio.Task | None = None
    latest_frame: bytes | None = None  # JPEG bytes for MJPEG stream
    latest_counts: dict = field(default_factory=dict)
    alert_sent_until: float = 0.0  # show overlay until this timestamp
    webrtc_queues: list = field(default_factory=list)
    latest_detections_payload: list = field(default_factory=list)


class CameraManager:
    def __init__(self, detector: PPEDetector, tracker=None) -> None:
        self.detector = detector
        self._tracker = tracker
        self._entries: dict[int, _CameraEntry] = {}
        self._camera_confidence: dict[int, float] = {}
        self._camera_roi: dict[int, list | None] = {}
        self._checker = ViolationChecker(
            cooldown_seconds=settings.ALERT_COOLDOWN_SECONDS,
            persist_seconds=settings.VIOLATION_PERSIST_SECONDS,
            track_dedup_seconds=settings.TRACK_DEDUP_SECONDS,
        )
        self._ws_subscribers: dict[int, list[asyncio.Queue]] = {}
        self._face_recognizer = FaceRecognizer()
        self._face_recog_frame_counter: dict[int, int] = {}

    async def reload_known_faces(self) -> None:
        from backend.database.connection import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            await self._face_recognizer.load_known_faces(session)

    async def start(self) -> None:
        # Cameras are started only when the user explicitly clicks Start in the UI.
        # No auto-restore on startup — prevents the webcam light turning on unexpectedly.
        pass

    async def stop(self) -> None:
        # Mark every camera inactive in the DB before releasing hardware,
        # so a clean shutdown never leaves stale is_active=True flags.
        try:
            from backend.database.connection import AsyncSessionLocal
            from backend.database.models import Camera
            from sqlalchemy import update

            async with AsyncSessionLocal() as session:
                await session.execute(update(Camera).values(is_active=False))
                await session.commit()
        except Exception as exc:
            logger.warning("Could not clear is_active flags on shutdown: %s", exc)

        for entry in list(self._entries.values()):
            if entry.task:
                entry.task.cancel()
                try:
                    await entry.task
                except asyncio.CancelledError:
                    pass
                # _process_loop's finally block releases the source and pops _entries
            else:
                await entry.source.release()
        self._entries.clear()  # safety net

    def _build_source(self, source_type: str, source_uri: str) -> CameraSource:
        if source_type == "webcam":
            from backend.camera.webcam_source import WebcamSource
            return WebcamSource(int(source_uri))
        elif source_type == "rtsp":
            from backend.camera.rtsp_source import RTSPSource
            return RTSPSource(source_uri)
        elif source_type == "file":
            from backend.camera.file_source import FileSource
            return FileSource(source_uri)
        else:
            raise ValueError(f"Unknown source_type: {source_type!r}")

    async def _launch_camera(
        self, camera_id: int, source_type: str, source_uri: str
    ) -> bool:
        # If already running, reject
        existing = self._entries.get(camera_id)
        if existing and existing.task and not existing.task.done():
            logger.warning("Camera %d already running", camera_id)
            return False

        # Clean up stale entry (task finished but source not released)
        if existing:
            try:
                await existing.source.release()
            except Exception:
                pass
            self._entries.pop(camera_id, None)

        source = self._build_source(source_type, source_uri)
        connected = await source.connect()
        if not connected:
            return False

        entry = _CameraEntry(camera_id=camera_id, source=source)
        self._entries[camera_id] = entry
        entry.task = asyncio.create_task(
            self._process_loop(entry), name=f"camera-{camera_id}"
        )
        logger.info("Camera %d processing started", camera_id)
        return True

    async def start_camera(
        self, camera_id: int, source_type: str, source_uri: str,
        confidence: float | None = None,
        roi: list | None = None,
    ) -> bool:
        if confidence is not None:
            self._camera_confidence[camera_id] = confidence
        self._camera_roi[camera_id] = roi
        return await self._launch_camera(camera_id, source_type, source_uri)

    def set_confidence(self, camera_id: int, confidence: float) -> None:
        """Update detection threshold for a running camera. Takes effect on the next frame."""
        self._camera_confidence[camera_id] = confidence

    def set_roi(self, camera_id: int, roi: list | None) -> None:
        """Update the detection zone polygon for a camera. Takes effect on the next frame."""
        self._camera_roi[camera_id] = roi

    async def stop_camera(self, camera_id: int) -> bool:
        entry = self._entries.get(camera_id)
        if entry is None:
            return False
        if entry.task:
            entry.task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(entry.task), timeout=6.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass
            # If task didn't clean up in time, force-release
            if camera_id in self._entries:
                try:
                    await entry.source.release()
                except Exception:
                    pass
                self._entries.pop(camera_id, None)
        else:
            await entry.source.release()
            self._entries.pop(camera_id, None)
        self._checker.reset(camera_id)
        if self._tracker:
            self._tracker.reset(camera_id)
        self._camera_confidence.pop(camera_id, None)
        self._camera_roi.pop(camera_id, None)
        logger.info("Camera %d stopped", camera_id)
        return True

    async def _process_loop(self, entry: _CameraEntry) -> None:
        camera_id = entry.camera_id
        loop = asyncio.get_running_loop()

        try:
            from backend.alerts.dispatcher import AlertDispatcher
            from backend.alerts.db_handler import DatabaseHandler

            handlers = [DatabaseHandler()]
            if settings.FINES_ENABLED:
                from backend.alerts.fine_handler import FineHandler
                handlers.append(FineHandler())
            if settings.SENDER_EMAIL:
                from backend.alerts.email_handler import EmailHandler
                handlers.append(EmailHandler())
            if settings.WEBHOOK_URL:
                from backend.alerts.webhook_handler import WebhookHandler
                handlers.append(WebhookHandler(settings.WEBHOOK_URL))
            if settings.MQTT_BROKER:
                from backend.alerts.mqtt_handler import MQTTHandler
                handlers.append(MQTTHandler())
            dispatcher = AlertDispatcher(handlers)

            last_detections: list = []
            last_hardhat_count = 0
            last_mask_count = 0
            last_vest_count = 0
            last_person_count = 0

            # Non-blocking detection: fire-and-forget future pattern
            detection_future = None
            detection_frame = None  # frame that was sent to YOLO
            # Hold reference to background tasks so they don't get GC'd
            _bg_tasks: set = set()
            frame_skip_counter = 0  # gate YOLO to every 3rd frame

            while True:
                try:
                    frame = await entry.source.read_frame()
                    if frame is None:
                        await asyncio.sleep(0.05)
                        continue

                    # --- Harvest completed detection (non-blocking check) ---
                    if detection_future is not None and detection_future.done():
                        try:
                            detections = detection_future.result()
                        except Exception:
                            detections = []
                        detection_future = None
                        det_frame = detection_frame

                        # Filter detections to ROI zone
                        roi = self._camera_roi.get(camera_id)
                        if roi and len(roi) >= 3:
                            frame_h, frame_w = det_frame.shape[:2]
                            detections = [
                                d for d in detections
                                if _point_in_polygon(
                                    ((d.x1 + d.x2) / 2) / frame_w,
                                    ((d.y1 + d.y2) / 2) / frame_h,
                                    roi,
                                )
                            ]

                        # Enrich Person detections with track IDs (non-blocking)
                        if self._tracker is not None:
                            detections = await loop.run_in_executor(
                                None, self._tracker.track, camera_id, detections, det_frame
                            )

                        last_detections = detections
                        last_hardhat_count = sum(1 for d in detections if d.class_name == "Hardhat")
                        last_mask_count = sum(1 for d in detections if d.class_name == "Mask")
                        last_vest_count = sum(1 for d in detections if d.class_name == "Safety Vest")
                        last_person_count = sum(1 for d in detections if d.class_name == "Person")

                        # Run violation check INLINE (synchronous, fast) so timing is accurate
                        violations = self._checker.check(camera_id, detections)

                        entry.latest_counts = {
                            "hardhat_count": last_hardhat_count,
                            "mask_count": last_mask_count,
                            "vest_count": last_vest_count,
                            "person_count": last_person_count,
                            "total_detections": len(detections),
                            "violation_count": len(violations),
                        }

                        entry.latest_detections_payload = [
                            {
                                "label": d.class_name,
                                "confidence": round(d.confidence, 3),
                                "bbox": [d.x1, d.y1, d.x2, d.y2],
                                "color": _bgr_to_css(d.color),
                            }
                            for d in last_detections
                        ]

                        # Offload slow work (face recog, save frame, dispatch) to background
                        if violations or self._should_run_face_recog(camera_id):
                            task = asyncio.create_task(
                                self._handle_post_detection(
                                    camera_id, entry, dispatcher, det_frame, detections, violations
                                ),
                                name=f"post-detect-{camera_id}",
                            )
                            _bg_tasks.add(task)
                            task.add_done_callback(_bg_tasks.discard)

                    # --- Submit new detection every 3rd frame (producer-consumer: stream all, YOLO 1-in-3) ---
                    frame_skip_counter += 1
                    if detection_future is None and frame_skip_counter % 3 == 0:
                        conf = self._camera_confidence.get(camera_id, self.detector.confidence)
                        detection_future = loop.run_in_executor(
                            None, self.detector.detect, frame, conf
                        )
                        detection_frame = frame

                    # --- Always annotate + stream with cached detections (never blocks) ---
                    frame_for_stream = frame
                    if settings.STREAM_WIDTH > 0 and settings.STREAM_HEIGHT > 0:
                        frame_for_stream = cv2.resize(frame, (settings.STREAM_WIDTH, settings.STREAM_HEIGHT))

                    # Broadcast clean (unannotated) frame to WebRTC subscribers
                    _, clean_jpeg = cv2.imencode(
                        ".jpg", frame_for_stream,
                        [cv2.IMWRITE_JPEG_QUALITY, settings.STREAM_JPEG_QUALITY],
                    )
                    clean_bytes = clean_jpeg.tobytes()
                    for wq in list(entry.webrtc_queues):
                        if wq.full():
                            try:
                                wq.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        try:
                            wq.put_nowait(clean_bytes)
                        except asyncio.QueueFull:
                            pass

                    show_alert = time.time() < entry.alert_sent_until
                    annotated = annotate_frame(
                        frame, last_detections,
                        last_hardhat_count, last_vest_count, last_person_count,
                        show_alert,
                    )
                    if settings.STREAM_WIDTH > 0 and settings.STREAM_HEIGHT > 0:
                        annotated = cv2.resize(annotated, (settings.STREAM_WIDTH, settings.STREAM_HEIGHT))
                    _, jpeg = cv2.imencode(
                        ".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, settings.STREAM_JPEG_QUALITY]
                    )
                    entry.latest_frame = jpeg.tobytes()

                    # Push detection event to WebSocket subscribers (includes bbox data)
                    await self._broadcast(camera_id, {
                        **entry.latest_counts,
                        "detections": entry.latest_detections_payload,
                    })

                    # Pace the loop to STREAM_TARGET_FPS
                    if settings.STREAM_TARGET_FPS > 0:
                        await asyncio.sleep(1.0 / settings.STREAM_TARGET_FPS)
                    else:
                        await asyncio.sleep(0)

                except Exception as frame_exc:
                    logger.error("Camera %d frame error (will retry): %s", camera_id, frame_exc)
                    await asyncio.sleep(1.0)

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.exception("Error in camera %d processing loop: %s", camera_id, exc)
        finally:
            logger.info("Camera %d process loop exited — releasing source", camera_id)
            await entry.source.release()
            self._entries.pop(camera_id, None)

    async def _handle_post_detection(
        self,
        camera_id: int,
        entry: _CameraEntry,
        dispatcher,
        frame: np.ndarray,
        detections: list,
        violations: list,
    ) -> None:
        """Background: save violation to DB immediately, then face recog + fine as follow-up."""
        loop = asyncio.get_running_loop()
        try:
            # Face recognition — throttled (runs regardless of violations)
            counter = self._face_recog_frame_counter.get(camera_id, 0) + 1
            self._face_recog_frame_counter[camera_id] = counter
            if not violations:
                # Still run face recognition for future violation frames
                face_interval = max(1, int(settings.FACE_RECOG_FRAME_INTERVAL or 10))
                if counter % face_interval == 0:
                    person_dets = [d for d in detections if d.class_name == "Person"]
                    for pd in person_dets:
                        wid = await loop.run_in_executor(
                            None,
                            self._face_recognizer.identify_face,
                            frame,
                            (pd.x1, pd.y1, pd.x2, pd.y2),
                        )
                        if wid is not None:
                            break
                return

            # --- STEP 1: Save frame + violation to DB IMMEDIATELY (no face recog yet) ---
            frame_dir = os.path.join(settings.FRAMES_DIR, f"camera_{camera_id}")
            os.makedirs(frame_dir, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
            fname = f"violation_{ts}.jpg"
            disk_path = os.path.join(frame_dir, fname)
            # Save compressed full frame
            written = await loop.run_in_executor(None, _save_compressed, disk_path, frame, 800)
            if not written:
                logger.warning("Camera %d: failed to write frame to %s", camera_id, disk_path)
            else:
                # Also save a highly compressed 160px thumbnail
                thumb_disk_path = os.path.join(frame_dir, f"thumb_{fname}")
                await loop.run_in_executor(None, _save_compressed, thumb_disk_path, frame, 160)
            rel_path = f"camera_{camera_id}/{fname}"
            entry.alert_sent_until = time.time() + 3.0

            # Save violations to DB without worker_id (appears instantly on dashboard)
            for violation in violations:
                violation.frame_path = rel_path if written else None
            # Dispatch to DB handler only first (fast — just INSERT)
            for violation in violations:
                await dispatcher.dispatch_db_only(violation)

            # Notify WebSocket subscribers that a new violation was saved so the
            # dashboard can refresh immediately without waiting for the next poll.
            saved_now = [v for v in violations if v.violation_id is not None]
            if saved_now:
                await self._broadcast(camera_id, {
                    **entry.latest_counts,
                    "detections": entry.latest_detections_payload,
                    "type": "violation_saved",
                })

            # --- STEP 2: Face recognition (slow) ---
            worker_id = None
            person_dets = [d for d in detections if d.class_name == "Person"]
            for pd in person_dets:
                wid = await loop.run_in_executor(
                    None,
                    self._face_recognizer.identify_face,
                    frame,
                    (pd.x1, pd.y1, pd.x2, pd.y2),
                )
                if wid is not None:
                    worker_id = wid
                    break

            # --- STEP 3: Update violation with worker + apply fine ---
            if worker_id is None:
                logger.info(
                    "Camera %d: worker unidentified — violation(s) saved with worker_id=null",
                    camera_id,
                )
            else:
                logger.info("Camera %d: violation matched to worker %d", camera_id, worker_id)
                from backend.detection.fine_calculator import get_fine_amount
                from backend.database.connection import AsyncSessionLocal
                from backend.database.models import Violation as ViolationModel
                for v in violations:
                    v.worker_id = worker_id
                    if v.violation_id:
                        async with AsyncSessionLocal() as session:
                            # None when no active fine config — violation is still
                            # assigned to the worker, just without a fine amount.
                            v.fine_amount = await get_fine_amount(session, v.violation_type)
                            db_v = await session.get(ViolationModel, v.violation_id)
                            if db_v:
                                db_v.worker_id = worker_id
                                db_v.fine_amount = v.fine_amount
                                await session.commit()

            # --- STEP 4: Dispatch to remaining handlers (email, webhook, fine, etc.) ---
            # Only dispatch violations that were actually saved (violation_id is set).
            # violation_id=None means DatabaseHandler suppressed the record because
            # an identical violation already exists within the cooldown window.
            saved_violations = [v for v in violations if v.violation_id is not None]
            for violation in saved_violations:
                await dispatcher.dispatch_non_db(violation)

            # Auto-identify for violations where worker still unknown
            for violation in saved_violations:
                if violation.worker_id is None and violation.violation_id:
                    asyncio.create_task(
                        self._auto_identify_violation(violation.violation_id),
                        name=f"auto-id-{violation.violation_id}",
                    )
        except Exception as exc:
            logger.error("Camera %d post-detection error: %s", camera_id, exc)

    async def _auto_identify_violation(self, violation_id: int) -> None:
        """Background task: attempt to identify the worker for a single violation."""
        try:
            await asyncio.sleep(1)  # brief delay to ensure frame is flushed to disk
            from backend.detection.auto_identifier import auto_identify_single
            await auto_identify_single(violation_id, self.detector, self._face_recognizer)
        except Exception as exc:
            logger.debug("Auto-identify for violation %d failed: %s", violation_id, exc)

    async def _broadcast(self, camera_id: int, data: dict) -> None:
        queues = self._ws_subscribers.get(camera_id, [])
        for q in list(queues):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass

    def subscribe_webrtc(self, camera_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        entry = self._entries.get(camera_id)
        if entry:
            entry.webrtc_queues.append(q)
        return q

    def unsubscribe_webrtc(self, camera_id: int, q: asyncio.Queue) -> None:
        entry = self._entries.get(camera_id)
        if entry and q in entry.webrtc_queues:
            entry.webrtc_queues.remove(q)

    def subscribe(self, camera_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=10)
        self._ws_subscribers.setdefault(camera_id, []).append(q)
        return q

    def unsubscribe(self, camera_id: int, q: asyncio.Queue) -> None:
        subs = self._ws_subscribers.get(camera_id, [])
        if q in subs:
            subs.remove(q)

    def get_latest_frame(self, camera_id: int) -> bytes | None:
        entry = self._entries.get(camera_id)
        return entry.latest_frame if entry else None

    def is_running(self, camera_id: int) -> bool:
        entry = self._entries.get(camera_id)
        return entry is not None and entry.task is not None and not entry.task.done()
