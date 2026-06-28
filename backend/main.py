from __future__ import annotations

import asyncio
import pathlib
import sys
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

_PROJECT_ROOT = pathlib.Path(__file__).parent.parent
_DIST = _PROJECT_ROOT / "dist"

# Fix Windows console encoding for libraries (e.g. deepface) that log emoji characters.
# Skipped under pytest: it permanently replaces the global sys.stdout/stderr with a
# TextIOWrapper around pytest's per-test capture buffer, which pytest closes between
# tests — the next write then raises "ValueError: I/O operation on closed file" and
# corrupts test output/reporting for the rest of the session.
if sys.platform == "win32" and hasattr(sys.stdout, "buffer") and "pytest" not in sys.modules:
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from backend.middleware.cors import setup_cors

from backend.core.config import settings
from backend.core.logging import configure_root_logger, get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    configure_root_logger(settings.LOG_LEVEL)
    logger.info("Starting PPE Detection API (env=%s)", settings.APP_ENV)

    # Initialize database
    from backend.database.connection import init_db
    await init_db()
    logger.info("Database initialised")

    # Apply persisted runtime setting overrides (alert toggles) on top of .env
    # defaults — must run before the camera manager / alert dispatch starts.
    from backend.database.settings_store import load_runtime_settings, load_alert_config
    await load_runtime_settings()
    logger.info("Runtime settings overrides loaded from database")
    await load_alert_config()
    logger.info("Alert channel config loaded from database")

    # Initialize HTTP cache (Redis if REDIS_URL is set, fallback to in-memory)
    from fastapi_cache import FastAPICache
    from backend.utils.cache import stable_key_builder

    if settings.REDIS_URL:
        try:
            from fastapi_cache.backends.redis import RedisBackend
            from redis import asyncio as aioredis

            redis_client = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=False,
                protocol=2,
            )
            FastAPICache.init(RedisBackend(redis_client), prefix="fastapi-cache", key_builder=stable_key_builder)
            logger.info("FastAPI cache initialised with Redis backend: %s", settings.REDIS_URL.split("@")[-1] if "@" in settings.REDIS_URL else settings.REDIS_URL)
        except Exception as exc:
            logger.warning("Failed to initialize Redis cache, falling back to InMemoryBackend: %s", exc)
            from fastapi_cache.backends.inmemory import InMemoryBackend
            FastAPICache.init(InMemoryBackend(), key_builder=stable_key_builder)
            logger.info("FastAPI cache initialised with InMemory backend (fallback)")
    else:
        from fastapi_cache.backends.inmemory import InMemoryBackend
        FastAPICache.init(InMemoryBackend(), key_builder=stable_key_builder)
        logger.info("FastAPI cache initialised with InMemory backend")

    # Reset stale is_active flags left by a previous crash
    from sqlalchemy import update as sa_update
    from backend.database.models import Camera
    from backend.database.connection import AsyncSessionLocal
    async with AsyncSessionLocal() as _s:
        await _s.execute(sa_update(Camera).values(is_active=False))
        await _s.commit()
    logger.info("Reset stale is_active flags on startup")

    # Initialize person tracker (fast — no model download)
    tracker = None
    if settings.TRACKING_ENABLED:
        from backend.detection.tracker import PersonTracker
        tracker = PersonTracker(
            track_buffer=settings.BYTETRACK_TRACK_BUFFER,
            match_thresh=settings.BYTETRACK_MATCH_THRESH,
            track_high_thresh=settings.BYTETRACK_TRACK_HIGH_THRESH,
            track_low_thresh=settings.BYTETRACK_TRACK_LOW_THRESH,
            new_track_thresh=settings.BYTETRACK_NEW_TRACK_THRESH,
        )
        logger.info("ByteTrack person tracker initialized")

    # Start camera manager with detector=None — detector is assigned once the
    # background heavy-init task finishes loading the YOLO model.
    from backend.camera.manager import CameraManager
    app.state.detector = None
    app.state.model_ready = False
    app.state.model_status = "initializing"
    app.state.model_error = None
    app.state.camera_manager = CameraManager(None, tracker=tracker)
    await app.state.camera_manager.start()
    logger.info("Camera manager started (detector pending)")

    # Initialize WebRTC manager
    from backend.streaming.webrtc_handler import WebRTCManager
    app.state.webrtc_manager = WebRTCManager()
    logger.info("WebRTC manager initialized")

    # Load YOLO model, run warm-up, and preload face recognition in a background
    # task so the server starts accepting HTTP requests immediately (~2-5 s) instead
    # of waiting 30-60 s for model loading to complete.
    from backend.detection.detector import PPEDetector
    import numpy as np

    async def _heavy_init() -> None:
        loop = asyncio.get_running_loop()
        try:
            app.state.detector = await loop.run_in_executor(
                None, PPEDetector, settings.MODEL_PATH, settings.DETECTION_CONFIDENCE
            )
            logger.info("YOLO model loaded from %s", settings.MODEL_PATH)

            dummy = np.zeros((480, 640, 3), dtype=np.uint8)
            await loop.run_in_executor(None, app.state.detector.detect, dummy)
            logger.info("YOLO warm-up inference complete")

            # Wire the loaded detector into the camera manager
            app.state.camera_manager.detector = app.state.detector

            try:
                await loop.run_in_executor(None, app.state.camera_manager._face_recognizer.load_model)
                logger.info("Face recognition model preloaded")
            except Exception as exc:
                logger.warning(
                    "Face recognition preload failed (%s) — will retry on first use", exc
                )

            await app.state.camera_manager.reload_known_faces()
            logger.info("Known faces loaded into face recognizer")

            app.state.model_ready = True
            app.state.model_status = "ready"
            logger.info("Model ready — detection active")

        except asyncio.CancelledError:
            logger.info("Heavy init cancelled during shutdown")
            raise
        except Exception as exc:
            app.state.model_status = "error"
            app.state.model_error = str(exc)
            logger.error("Heavy init failed: %s", exc)

    heavy_task = asyncio.create_task(_heavy_init(), name="heavy-init")

    # Start periodic auto-identification of unassigned violations
    auto_id_task = None
    if settings.FINES_ENABLED and settings.AUTO_IDENTIFY_INTERVAL > 0:
        async def _periodic_auto_identify() -> None:
            await asyncio.sleep(30)  # initial delay
            while True:
                try:
                    from backend.detection.auto_identifier import auto_identify_unassigned

                    result = await auto_identify_unassigned(
                        app.state.detector,
                        app.state.camera_manager._face_recognizer,
                    )
                    if result["identified"] > 0:
                        logger.info(
                            "Auto-identified %d/%d unassigned violations",
                            result["identified"],
                            result["processed"],
                        )
                except Exception as exc:
                    logger.error("Periodic auto-identify error: %s", exc)
                await asyncio.sleep(settings.AUTO_IDENTIFY_INTERVAL)

        auto_id_task = asyncio.create_task(_periodic_auto_identify(), name="auto-identify")
        logger.info(
            "Auto-identify task started (interval=%ds)", settings.AUTO_IDENTIFY_INTERVAL
        )

    yield

    # Cancel background tasks cleanly
    for task, name in [(heavy_task, "heavy-init"), (auto_id_task, "auto-identify")]:
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.info("%s task cancelled", name)

    # Shutdown
    logger.info("Shutting down WebRTC manager...")
    await app.state.webrtc_manager.close_all()
    logger.info("Shutting down camera manager...")
    await app.state.camera_manager.stop()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Construction PPE Detection API",
        description="Real-time PPE compliance monitoring for construction sites",
        version="2.0.0",
        lifespan=lifespan,
    )

    setup_cors(app)

    # Dev-only API timing middleware
    @app.middleware("http")
    async def add_process_time_header(request, call_next):
        if settings.APP_ENV == "dev":
            import time as _time
            start_time = _time.perf_counter()
            response = await call_next(request)
            process_time = (_time.perf_counter() - start_time) * 1000
            logger.info(
                "[API-TIMING] %s %s completed in %.1fms (status=%d)",
                request.method,
                request.url.path,
                process_time,
                response.status_code,
            )
            return response
        return await call_next(request)

    from backend.routes.health import router as health_router
    from backend.routes.cameras import router as cameras_router
    from backend.routes.violations import router as violations_router
    from backend.routes.stream import router as stream_router
    from backend.routes.detect import router as detect_router
    from backend.routes.workers import router as workers_router
    from backend.routes.worker_self import router as worker_self_router
    from backend.routes.fines import router as fines_router
    from backend.routes.settings import router as settings_router
    from backend.routes.dashboard import router as dashboard_router
    from backend.routes.alert_logs import router as alert_logs_router
    from backend.routes.alert_config import router as alert_config_router
    from backend.routes.payroll_agent import router as payroll_agent_router
    from backend.routes.safety_actions import router as safety_actions_router
    from backend.routes.invite_tracker import router as invite_tracker_router

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(cameras_router, prefix="/api/v1")
    app.include_router(violations_router, prefix="/api/v1")
    app.include_router(stream_router, prefix="/api/v1")
    app.include_router(detect_router, prefix="/api/v1")
    app.include_router(workers_router, prefix="/api/v1", tags=["workers"])
    app.include_router(worker_self_router, prefix="/api/v1", tags=["worker-self"])
    app.include_router(fines_router, prefix="/api/v1")
    app.include_router(settings_router, prefix="/api/v1")
    app.include_router(dashboard_router, prefix="/api/v1")
    app.include_router(alert_logs_router, prefix="/api/v1")
    app.include_router(alert_config_router, prefix="/api/v1")
    app.include_router(payroll_agent_router, prefix="/api/v1")
    app.include_router(safety_actions_router, prefix="/api/v1")
    app.include_router(invite_tracker_router, prefix="/api/v1")

    # Serve React dashboard build output (must be last).
    # In development, the React app can also run from frontend/ via Vite.
    if _DIST.is_dir():
        from fastapi.responses import FileResponse

        # Serve Vite-built assets (JS/CSS chunks) with correct MIME types.
        if (_DIST / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

        # SPA catch-all: serve real files from dist/ if they exist, otherwise
        # return index.html so React Router can handle client-side navigation.
        @app.get("/{full_path:path}", response_class=FileResponse)
        async def serve_spa(full_path: str):
            file_path = _DIST / full_path
            if full_path and file_path.is_file():
                response = FileResponse(str(file_path))
                if full_path == "index.html":
                    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                return response
            response = FileResponse(str(_DIST / "index.html"))
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response
    else:
        logger.warning("React dashboard build not found at %s. Run `npm run build` in frontend/.", _DIST)

    return app


app = create_app()
