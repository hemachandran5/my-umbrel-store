# Multi-architecture base supporting linux/arm64 (Raspberry Pi 4) and linux/amd64
FROM node:22-bookworm-slim

LABEL maintainer="HEMACHANDRANSK"
LABEL description="umbrelOS Persistent Node.js & NPM Process Manager"

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=20130 \
    DATA_DIR=/app/data

# 1. Install native build essentials for ARM64 C/C++ compilation (better-sqlite3, tls-client-node, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    libc6-dev \
    git \
    curl \
    procps \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Install PM2 globally into /usr/local so host volume mounts over /app/data do NOT mask it
RUN npm install -g --prefix /usr/local pm2 && npm cache clean --force

# 3. Create app and mount directories
RUN mkdir -p /app/gui /app/data

# 4. Copy Web GUI dependencies and install
WORKDIR /app/gui
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# 5. Copy Web GUI application files
COPY server.js ./
COPY public/ ./public/

# 6. Copy Entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 7. Configure runtime storage redirects and PATH
ENV NPM_CONFIG_PREFIX=/app/data/npm-global \
    NPM_CONFIG_CACHE=/app/data/npm-cache \
    HOME=/app/data/home \
    PM2_HOME=/app/data/home/.pm2 \
    PATH=/app/data/npm-global/bin:/app/gui/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Expose Web GUI and pre-allocated service ports
EXPOSE 20130 20128 20129 8080 3000 3001

# Root user guarantees zero EACCES permission denials with host volumes
USER 0:0

ENTRYPOINT ["/bin/bash", "/app/entrypoint.sh"]
