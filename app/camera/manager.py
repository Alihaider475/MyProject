from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import cv2
import numpy as np

from app.camera.source import CameraSource
from app.core.config import settings
from app.core.detector import PPEDetector
from app.core.frame_annotator import annotate_frame
from app.core.logging import get_logger
from app.core.violation_checker import ViolationChecker

logger = get_logger(__name__)


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


@dataclass
class _CameraEntry:
    camera_id: int
    source: CameraSource
    task: asyncio.Task | None = None
    latest_frame: bytes | None = None  # JPEG bytes for MJPEG stream
    latest_counts: dict = field(default_factory=dict)
    alert_sent_until: float = 0.0  # show overlay until this timestamp


class CameraManager:
    def __init__(self, detector: PPEDetector) -> None:
        self.detector = detector
        self._entries: dict[int, _CameraEntry] = {}
        self._camera_confidence: dict[int, float] = {}
        self._camera_roi: dict[int, list | None] = {}
        self._checker = ViolationChecker(
            cooldown_seconds=settings.ALERT_COOLDOWN_SECONDS,
            persist_seconds=settings.VIOLATION_PERSIST_SECONDS,
        )
        self._ws_subscribers: dict[int, list[asyncio.Queue]] = {}

    async def start(self) -> None:
        # Cameras are started only when the user explicitly clicks Start in the UI.
        # No auto-restore on startup — prevents the webcam light turning on unexpectedly.
        pass

    async def stop(self) -> None:
        # Mark every camera inactive in the DB before releasing hardware,
        # so a clean shutdown never leaves stale is_active=True flags.
        try:
            from app.db.session import AsyncSessionLocal
            from app.db.models import Camera
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
            from app.camera.webcam_source import WebcamSource
            return WebcamSource(int(source_uri))
        elif source_type == "rtsp":
            from app.camera.rtsp_source import RTSPSource
            return RTSPSource(source_uri)
        elif source_type == "file":
            from app.camera.file_source import FileSource
            return FileSource(source_uri)
        else:
            raise ValueError(f"Unknown source_type: {source_type!r}")

    async def _launch_camera(
        self, camera_id: int, source_type: str, source_uri: str
    ) -> bool:
        if camera_id in self._entries and self._entries[camera_id].task and not self._entries[camera_id].task.done():
            logger.warning("Camera %d already running", camera_id)
            return False

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
                await entry.task
            except asyncio.CancelledError:
                pass
            # _process_loop's finally block releases the source and removes from _entries
        else:
            # Source connected but loop never started — release manually
            await entry.source.release()
            self._entries.pop(camera_id, None)
        self._checker.reset(camera_id)
        self._camera_confidence.pop(camera_id, None)
        self._camera_roi.pop(camera_id, None)
        logger.info("Camera %d stopped", camera_id)
        return True

    async def _process_loop(self, entry: _CameraEntry) -> None:
        camera_id = entry.camera_id
        loop = asyncio.get_running_loop()

        try:
            from app.alerts.dispatcher import AlertDispatcher
            from app.alerts.db_handler import DatabaseHandler

            handlers = [DatabaseHandler()]
            if settings.SENDER_EMAIL:
                from app.alerts.email_handler import EmailHandler
                handlers.append(EmailHandler())
            if settings.WEBHOOK_URL:
                from app.alerts.webhook_handler import WebhookHandler
                handlers.append(WebhookHandler(settings.WEBHOOK_URL))
            if settings.MQTT_BROKER:
                from app.alerts.mqtt_handler import MQTTHandler
                handlers.append(MQTTHandler())
            if settings.PLC_HOST:
                from app.alerts.plc_handler import PLCHandler
                handlers.append(PLCHandler())
            dispatcher = AlertDispatcher(handlers)

            while True:
                try:
                    frame = await entry.source.read_frame()
                    if frame is None:
                        await asyncio.sleep(0.05)
                        continue

                    # Run YOLO in thread pool so we don't block the event loop
                    conf = self._camera_confidence.get(camera_id, self.detector.confidence)
                    detections = await loop.run_in_executor(None, self.detector.detect, frame, conf)

                    # Filter detections to ROI zone if one is configured
                    roi = self._camera_roi.get(camera_id)
                    if roi and len(roi) >= 3:
                        frame_h, frame_w = frame.shape[:2]
                        detections = [
                            d for d in detections
                            if _point_in_polygon(
                                ((d.x1 + d.x2) / 2) / frame_w,
                                ((d.y1 + d.y2) / 2) / frame_h,
                                roi,
                            )
                        ]

                    hardhat_count = sum(1 for d in detections if d.class_name == "Hardhat")
                    mask_count = sum(1 for d in detections if d.class_name == "Mask")
                    vest_count = sum(1 for d in detections if d.class_name == "Safety Vest")
                    person_count = sum(1 for d in detections if d.class_name == "Person")

                    entry.latest_counts = {
                        "hardhat_count": hardhat_count,
                        "mask_count": mask_count,
                        "vest_count": vest_count,
                        "person_count": person_count,
                        "total_detections": len(detections),
                    }

                    # Check for violations — returns list (one per PPE type)
                    violations = self._checker.check(camera_id, detections)

                    if violations:
                        frame_dir = os.path.join(settings.FRAMES_DIR, f"camera_{camera_id}")
                        os.makedirs(frame_dir, exist_ok=True)
                        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
                        fname = f"violation_{ts}.jpg"
                        disk_path = os.path.join(frame_dir, fname)
                        written = await loop.run_in_executor(None, cv2.imwrite, disk_path, frame)
                        if not written:
                            logger.warning("Camera %d: failed to write frame to %s", camera_id, disk_path)
                        rel_path = f"camera_{camera_id}/{fname}"
                        entry.alert_sent_until = time.time() + 3.0
                        for violation in violations:
                            violation.frame_path = rel_path if written else None
                            await dispatcher.dispatch(violation)

                    # Annotate frame for MJPEG stream
                    show_alert = time.time() < entry.alert_sent_until
                    annotated = annotate_frame(
                        frame, detections, hardhat_count, vest_count, person_count, show_alert
                    )
                    if settings.STREAM_WIDTH > 0 and settings.STREAM_HEIGHT > 0:
                        annotated = cv2.resize(annotated, (settings.STREAM_WIDTH, settings.STREAM_HEIGHT))
                    _, jpeg = cv2.imencode(
                        ".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, settings.STREAM_JPEG_QUALITY]
                    )
                    entry.latest_frame = jpeg.tobytes()

                    # Push detection event to WebSocket subscribers
                    await self._broadcast(camera_id, entry.latest_counts)

                    # Pace the loop to STREAM_TARGET_FPS so we don't pin one CPU core per camera
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

    async def _broadcast(self, camera_id: int, data: dict) -> None:
        queues = self._ws_subscribers.get(camera_id, [])
        for q in list(queues):
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                pass

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
