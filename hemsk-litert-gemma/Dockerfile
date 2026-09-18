# Multi-arch base image for Raspberry Pi 4 (linux/arm64) and desktop development (linux/amd64)
FROM python:3.11-slim-bookworm

LABEL maintainer="hemsk"
LABEL description="Google LiteRT-LM runtime with Gemma model for umbrelOS"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000 \
    DATA_DIR=/data \
    MODEL_REPO=litert-community/Gemma3-1B-IT \
    MODEL_FILE=gemma-3-1b-it.litertlm \
    BACKEND=cpu

# Install system utilities and OpenMP runtime for LiteRT ARM Neon multi-threading
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

# Copy application source
COPY app/ /app/

# Ensure persistent data directory exists
RUN mkdir -p /data/models

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:${PORT}/healthz || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
