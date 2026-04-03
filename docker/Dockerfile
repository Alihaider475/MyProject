FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (layer cache)
COPY requirements/prod.txt requirements/base.txt requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

# Copy application code
COPY app/ app/
COPY Model/ Model/
COPY alembic.ini* ./

# Violation frames volume
RUN mkdir -p violation_frames

# Run as non-root
RUN useradd -u 1000 -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
