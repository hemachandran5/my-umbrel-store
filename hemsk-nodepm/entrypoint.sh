#!/usr/bin/env bash
set -eo pipefail

echo "=========================================================="
echo " Starting umbrelOS Persistent Node Process Manager"
echo " Target Architecture: $(uname -m)"
echo " Local Time:          $(date)"
echo "=========================================================="

DATA_DIR="${DATA_DIR:-/app/data}"
NPM_GLOBAL_DIR="${NPM_CONFIG_PREFIX:-${DATA_DIR}/npm-global}"
NPM_BIN_DIR="${NPM_GLOBAL_DIR}/bin"
HOME_DIR="${HOME:-${DATA_DIR}/home}"
PM2_HOME="${PM2_HOME:-${HOME_DIR}/.pm2}"

# 1. Guarantee physical directory tree on persistent host mount
mkdir -p "${NPM_BIN_DIR}"
mkdir -p "${NPM_GLOBAL_DIR}/lib"
mkdir -p "${DATA_DIR}/npm-cache"
mkdir -p "${HOME_DIR}"
mkdir -p "${PM2_HOME}"
mkdir -p "${DATA_DIR}/processes"
mkdir -p "${DATA_DIR}/omniroute"
mkdir -p "${DATA_DIR}/9router"

# Set liberal permissions to eliminate any EACCES permission denials
chmod -R 777 "${DATA_DIR}" 2>/dev/null || true

# 2. Export environment variables
export PATH="${NPM_BIN_DIR}:${PATH}:/usr/local/bin:/usr/bin:/bin"
export NPM_CONFIG_PREFIX="${NPM_GLOBAL_DIR}"
export NPM_CONFIG_CACHE="${DATA_DIR}/npm-cache"
export HOME="${HOME_DIR}"
export PM2_HOME="${PM2_HOME}"

echo "[Storage] Persistent DATA_DIR:  ${DATA_DIR}"
echo "[Storage] NPM Global Prefix:    ${NPM_GLOBAL_DIR}"
echo "[Storage] NPM Binary Path:      ${NPM_BIN_DIR}"
echo "[Storage] HOME Directory:       ${HOME_DIR}"
echo "[Storage] PM2 State Directory:  ${PM2_HOME}"

# 3. Start or resurrect PM2 daemon
echo "[PM2] Initializing PM2 process supervisor..."
pm2 ping

if [ -f "${PM2_HOME}/dump.pm2" ]; then
  echo "[PM2] Found persistent dump.pm2. Resurrecting saved background processes..."
  pm2 resurrect || echo "[PM2] Warning: Could not resurrect all processes."
else
  echo "[PM2] No previous dump.pm2 found. Fresh startup."
fi

# 4. Graceful Shutdown Signal Handler
cleanup() {
  echo ""
  echo "=========================================================="
  echo "[Shutdown] Caught termination signal (SIGTERM/SIGINT)!"
  echo "[Shutdown] Saving PM2 process states to persistent disk..."
  pm2 save || true

  echo "[Shutdown] Giving SQLite databases & daemons time to flush WAL..."
  pm2 stop all || true
  sleep 3

  if [ -n "${SERVER_PID:-}" ]; then
    kill -TERM "${SERVER_PID}" 2>/dev/null || true
  fi

  echo "[Shutdown] Clean shutdown complete. Goodbye."
  echo "=========================================================="
  exit 0
}

trap cleanup SIGTERM SIGINT

# 5. Start Web GUI Server in background and wait
echo "[Web GUI] Launching Process Manager Web Dashboard on port ${PORT:-20130}..."
node /app/gui/server.js &
SERVER_PID=$!

# Wait for process while allowing signal trapping
wait "${SERVER_PID}"
