from __future__ import annotations

import os
from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.logging import configure_root_logger, get_logger

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    configure_root_logger(settings.LOG_LEVEL)
    logger.info("Starting PPE Detection API (env=%s)", settings.APP_ENV)

    # Ensure violation frames directory exists
    os.makedirs(settings.FRAMES_DIR, exist_ok=True)

    # Initialize database
    from app.db.session import init_db
    await init_db()
    logger.info("Database initialised")

    # Reset stale is_active flags left by a previous crash
    from sqlalchemy import update as sa_update
    from app.db.models import Camera
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as _s:
        await _s.execute(sa_update(Camera).values(is_active=False))
        await _s.commit()
    logger.info("Reset stale is_active flags on startup")

    # Load YOLO model once and store on app state
    from app.core.detector import PPEDetector
    app.state.detector = PPEDetector(settings.MODEL_PATH, settings.DETECTION_CONFIDENCE)
    logger.info("YOLO model loaded from %s", settings.MODEL_PATH)

    # Start camera manager
    from app.camera.manager import CameraManager
    app.state.camera_manager = CameraManager(app.state.detector)
    await app.state.camera_manager.start()
    logger.info("Camera manager started")

    yield

    # Shutdown
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api.routes.health import router as health_router
    from app.api.routes.cameras import router as cameras_router
    from app.api.routes.violations import router as violations_router
    from app.api.routes.stream import router as stream_router
    from app.api.routes.detect import router as detect_router

    app.include_router(health_router, prefix="/api/v1")
    app.include_router(cameras_router, prefix="/api/v1")
    app.include_router(violations_router, prefix="/api/v1")
    app.include_router(stream_router, prefix="/api/v1")
    app.include_router(detect_router, prefix="/api/v1")

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
        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str) -> FileResponse:
            file_path = os.path.join("dist", full_path)
            if full_path and os.path.isfile(file_path):
                return FileResponse(file_path)
            return FileResponse(os.path.join("dist", "index.html"))
    else:
        logger.warning("React dashboard build not found at dist/. Run `npm run build` in frontend/.")

    return app


app = create_app()
