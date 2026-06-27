# syntax=docker/dockerfile:1
#
# SafeSite AI — single production image.
# Stage 1 builds the React/Vite SPA; stage 2 runs the FastAPI backend, which
# serves both the JSON API and the compiled SPA from /app/dist (see
# backend/main.py serve_spa catch-all).

# ---------------------------------------------------------------------------
# Stage 1 — build the frontend
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend-build

WORKDIR /frontend

# Install deps first for layer caching.
COPY frontend/package*.json ./
RUN npm ci

# Build the SPA. vite.config.js has outDir '../dist', so output lands at /dist.
# Public VITE_* vars (Supabase URL + anon key) are read from frontend/.env at
# build time and inlined into the bundle.
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — backend runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS backend

# OpenCV / YOLO / DeepFace / video-decode native libs (kept minimal).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install CPU-only PyTorch first so the heavy CUDA wheels are never pulled.
# The torch>=2.5.1 pin in requirements is satisfied by these CPU wheels.
RUN pip install --no-cache-dir \
        torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Then the rest of the production dependencies.
COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

# Application code, YOLO model weights, and the compiled SPA.
COPY backend/ backend/
COPY data/models/ data/models/
COPY --from=frontend-build /dist/ dist/

# Non-root user with a writable home so DeepFace/Ultralytics can cache weights.
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/data/violation_frames \
    && chown -R appuser:appuser /app /home/appuser

# Cache locations (both under the writable, persistable home).
ENV HOME=/home/appuser \
    DEEPFACE_HOME=/home/appuser/.deepface

USER appuser

EXPOSE 8000

# Single process: CameraManager, the tracker, and WebSocket/MJPEG streams hold
# in-memory state, so multiple workers would duplicate model loads and break
# stream/socket affinity.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
