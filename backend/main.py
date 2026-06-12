from __future__ import annotations

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

# Fix Windows console encoding for libraries (e.g. deepface) that log emoji characters
if sys.platform == "win32" and hasattr(sys.stdout, "buffer"):
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

    # Ensure violation frames directory exists
    os.makedirs(settings.FRAMES_DIR, exist_ok=True)

    # Initialize database
    from backend.database.connection import init_db
    await init_db()
    logger.info("Database initialised")

    # Apply persisted runtime setting overrides (alert toggles) on top of .env
    # defaults — must run before the camera manager / alert dispatch starts.
    from backend.database.settings_store import load_runtime_settings
    await load_runtime_settings()
    logger.info("Runtime settings overrides loaded from database")

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

    # Load YOLO model in a thread so we don't block the event loop during startup
    from backend.detection.detector import PPEDetector
    import numpy as np

    loop = asyncio.get_running_loop()
    app.state.detector = await loop.run_in_executor(
        None, PPEDetector, settings.MODEL_PATH, settings.DETECTION_CONFIDENCE
    )
    logger.info("YOLO model loaded from %s", settings.MODEL_PATH)

    # Warm-up inference — JIT-compiles kernels and pre-allocates memory so the
    # first real detection doesn't pay a cold-start penalty
    dummy = np.zeros((480, 640, 3), dtype=np.uint8)
    await loop.run_in_executor(None, app.state.detector.detect, dummy)
    logger.info("YOLO warm-up inference complete")

    # Initialize person tracker (if enabled)
    tracker = None
    if settings.TRACKING_ENABLED:
        from backend.detection.tracker import PersonTracker
        tracker = PersonTracker(
            max_age=settings.DEEPSORT_MAX_AGE,
            n_init=settings.DEEPSORT_N_INIT,
            max_cosine_distance=settings.DEEPSORT_MAX_COSINE_DISTANCE,
            embedder=settings.DEEPSORT_EMBEDDER,
        )
        logger.info("DeepSORT person tracker initialized (embedder=%s)", settings.DEEPSORT_EMBEDDER)

    # Start camera manager
    from backend.camera.manager import CameraManager
    app.state.camera_manager = CameraManager(app.state.detector, tracker=tracker)
    await app.state.camera_manager.start()
    logger.info("Camera manager started")

    # Initialize WebRTC manager
    from backend.streaming.webrtc_handler import WebRTCManager
    app.state.webrtc_manager = WebRTCManager()
    logger.info("WebRTC manager initialized")

    # Load enrolled worker faces into memory
    await app.state.camera_manager.reload_known_faces()
    logger.info("Known faces loaded into face recognizer")

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

    # Cancel auto-identify task
    if auto_id_task is not None:
        auto_id_task.cancel()
        try:
            await auto_id_task
        except asyncio.CancelledError:
            pass

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
    from backend.routes.fines import router as fines_router
    from backend.routes.settings import router as settings_router
    from backend.routes.dashboard import router as dashboard_router
    from backend.routes.alert_logs import router as alert_logs_router

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(cameras_router, prefix="/api/v1")
    app.include_router(violations_router, prefix="/api/v1")
    app.include_router(stream_router, prefix="/api/v1")
    app.include_router(detect_router, prefix="/api/v1")
    app.include_router(workers_router, prefix="/api/v1", tags=["workers"])
    app.include_router(fines_router, prefix="/api/v1")
    app.include_router(settings_router, prefix="/api/v1")
    app.include_router(dashboard_router, prefix="/api/v1")
    app.include_router(alert_logs_router, prefix="/api/v1")

    # Serve violation frame images
    os.makedirs(settings.FRAMES_DIR, exist_ok=True)
    app.mount("/frames", StaticFiles(directory=settings.FRAMES_DIR), name="frames")

    # Serve React dashboard build output (must be last).
    # In development, the React app can also run from frontend/ via Vite.
    if os.path.isdir("dist"):
        from fastapi.responses import FileResponse

        # Serve Vite-built assets (JS/CSS chunks) with correct MIME types.
        if os.path.isdir("dist/assets"):
            app.mount("/assets", StaticFiles(directory="dist/assets"), name="assets")

        # SPA catch-all: serve real files from dist/ if they exist, otherwise
        # return index.html so React Router can handle client-side navigation.
        @app.get("/{full_path:path}", response_class=FileResponse)
        async def serve_spa(full_path: str):
            file_path = os.path.join("dist", full_path)
            if full_path and os.path.isfile(file_path):
                response = FileResponse(file_path)
                if full_path == "index.html":
                    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                return response
            response = FileResponse(os.path.join("dist", "index.html"))
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            return response
    else:
        logger.warning("React dashboard build not found at dist/. Run `npm run build` in frontend/.")

    return app


app = create_app()
