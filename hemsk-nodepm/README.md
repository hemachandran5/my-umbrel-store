# Node Process Manager (`hemsk-nodepm`) for umbrelOS

[![Architecture](https://img.shields.io/badge/Architecture-ARM64%20%7C%20AMD64-blue.svg)](https://nodejs.org)
[![umbrelOS](https://img.shields.io/badge/umbrelOS-2.0-purple.svg)](https://umbrel.com)
[![Node.js](https://img.shields.io/badge/Node.js-v22%20LTS-green.svg)](https://nodejs.org)
[![Supervisor](https://img.shields.io/badge/Supervisor-PM2-orange.svg)](https://pm2.keymetrics.io)
[![Persistence](https://img.shields.io/badge/Persistence-Guaranteed%20Zero--EACCES-emerald.svg)]()

A persistent **Node.js runtime, NPM package manager, and PM2 process supervisor** with a modern Web GUI built specifically for **umbrelOS (Raspberry Pi 4, `linux/arm64`)**.

---

## 🌟 Why This Exists: Solving the SQLite & Data Loss Problem

Standalone containerized AI gateways (such as OmniRoute and 9Router) previously failed on umbrelOS due to:
1. **`EACCES` Host-Container Permission Denial**: umbrelOS creates `${APP_DATA_DIR}/data` on the host owned by `root:root` (`0:0`, mode `755`). Non-root container users failed to write SQLite temporary files (`storage.sqlite.tmp-...`).
2. **Volatile In-Memory Fallback**: When disk writes were denied, gateways silently switched to an in-memory SQLite database in container RAM.
3. **Wipe on Reboot**: RAM was cleared upon container restarts and system reboots, deleting all API keys, providers, and settings.
4. **Disappearing Global Packages**: `npm install -g` by default writes to container overlay filesystems, losing packages during container upgrades.

### The Permanent Solution Implemented in `hemsk-nodepm`:
* **Zero-`EACCES` Root Container Execution**: Runs container as `user: "0:0"` (root), matching umbrelOS host volume ownership and guaranteeing write permissions for SQLite temp files and WAL journals.
* **Complete Storage Redirection**:
  - `NPM_CONFIG_PREFIX=/app/data/npm-global` & `/app/data/npm-global/bin` added to `PATH`.
  - `HOME=/app/data/home` (dotfiles like `~/.omniroute`, `~/.9router` persist to disk).
  - `PM2_HOME=/app/data/home/.pm2` (process dumps persist to disk).
* **PM2 Auto-Revive**: Saved processes (`pm2 save`) are automatically resurrected (`pm2 resurrect`) on container boot.
* **Graceful WAL Shutdown**: `stop_grace_period: 40s` allows SQLite transactions to flush before container exit.
* **Native C/C++ Build Essentials**: Includes `python3`, `make`, `g++`, `gcc`, and `libc6-dev` so packages requiring ARM64 compilation (`better-sqlite3`, `sqlite3`, `tls-client-node`, `sharp`) install without errors.

---

## 🚀 Web GUI Features (Port 20130)

1. **Supervised Processes**: Live CPU%, RAM, restarts, uptime, action buttons (Start, Stop, Restart, Delete, View Logs), and "+ New Process" modal.
2. **1-Click AI Gateway Presets**:
   - **OmniRoute** (Pre-configured Port: `20128`, Data: `/app/data/omniroute`).
   - **9Router** (Pre-configured Port: `20129`, Data: `/app/data/9router`).
   - **Free LLM API** (Pre-configured Port: `8080`).
3. **NPM Package Manager**:
   - Install any global package (`npm install -g <pkg>`) with a **real-time streaming console window**.
   - Clean **Uninstall** button removing packages from persistent storage.
   - One-click **Update** button.
4. **Persistence & Integrity Diagnostics**:
   - Live SQLite WAL mode write & commit probe.
   - Confirms zero `EACCES` errors and verifies disk readbacks.
5. **Quick Console**: Run commands (`pm2 status`, `node -v`, `df -h /app/data`, `ls -la /app/data`) right in the browser.

---

## 🌐 Network & Port Allocations

| Service / Port | Target | Description |
| :--- | :--- | :--- |
| **`20130`** | `Web GUI Dashboard` | Main user interface (routed via Umbrel proxy) |
| **`20128`** | `OmniRoute` | Unified OpenAI-compatible AI gateway |
| **`20129`** | `9Router` | Self-hosted AI proxy & load balancer |
| **`8080`** | `Free LLM API` | Generic free tier LLM proxy |
| **`3000`** | `Custom Daemon 1` | User custom Node service / bot / webhook |
| **`3001`** | `Custom Daemon 2` | User custom Node service / bot / webhook |

---

## 📦 How to Publish & Install on umbrelOS

### Step 1: Upload to your Community App Store on GitHub
1. Open your Community App Store repository on GitHub: `https://github.com/hemachandran5/my-umbrel-store`.
2. Upload the entire **`hemsk-nodepm`** directory into your store repository.
3. Commit and push to the `main` branch.

### Step 2: Build & Push the Docker Image (Automated via GitHub Actions)
The repository contains `.github/workflows/docker-publish.yml`.
When you push the `hemsk-nodepm` directory to GitHub:
1. GitHub Actions automatically cross-compiles the Docker image for `linux/arm64` and `linux/amd64`.
2. It pushes the image to:
   ```
   ghcr.io/hemachandran5/hemsk-nodepm:latest
   ```
3. In your GitHub repository under **Packages**, make sure the package visibility is set to **Public**.

> **Alternative (Local Pi Build)**:
> If you have SSH access to your Raspberry Pi, you can also build locally:
> ```bash
> cd /home/umbrel/umbrel/app-stores/my-umbrel-store/hemsk-nodepm
> docker build -t ghcr.io/hemachandran5/hemsk-nodepm:latest .
> ```

### Step 3: Install via umbrelOS Dashboard
1. Open your Umbrel dashboard: `http://umbrel.local` (or `http://192.168.29.211`).
2. Go to the **App Store**.
3. Search for **Node Process Manager**.
4. Click **Install**.

---

## 🛠️ Quick Start Guide

### Launching OmniRoute with 100% Guaranteed Persistence:
1. Open **Node Process Manager** from your Umbrel dashboard (`http://umbrel.local:20130`).
2. Click the **AI Gateway Presets** tab.
3. On the **OmniRoute** card, click **Install NPM** (watch the live installation stream complete).
4. Click **Start Daemon**.
5. Click **Open UI** or navigate to `http://umbrel.local:20128`.
6. Add your API keys and provider credentials. 
7. **Reboot your Raspberry Pi 4 anytime**: OmniRoute and all your database records will automatically revive!

### Installing Any Other NPM Package:
1. Go to the **NPM Packages** tab.
2. Type any package name (e.g., `tsx`, `serve`, `free-llm-api`, `discord.js`).
3. Click **Install Global Package** to watch real-time install logs.
4. Go to the **Processes** tab, click **+ New Process**, enter the command, and click **Start & Save to Autostart**.

### Clean Uninstallation:
1. Under **Processes**, click **Delete** next to the process to remove it from PM2 supervision.
2. Under **NPM Packages**, click **Uninstall ✕** next to the package to purge its binaries cleanly from persistent storage.

---

## 🧪 Verification & Diagnostics

Inside the container or from the Web GUI **Persistence & Diagnostics** tab, you can verify your storage integrity at any time.

To run the verification probe manually:
```bash
python3 /app/gui/verify-persistence.py
```
Expected output:
```
============================================================
 Node Process Manager Persistence & SQLite Integrity Probe
 Architecture: aarch64 | Time: 2026-09-23T...
============================================================
[PASS] DATA_DIR Mount                           : Points to /app/data
[PASS] NPM Global Prefix                        : Points to /app/data/npm-global
[PASS] HOME Directory                           : Points to /app/data/home
[PASS] PM2 State Directory                      : Points to /app/data/home/.pm2
[PASS] NPM Bin in PATH                          : PATH contains /app/data/npm-global/bin
[PASS] Host Mount Direct Write                  : Zero EACCES on file creation & deletion
[PASS] NPM Global Storage Write                 : Writable at /app/data/npm-global
[PASS] HOME Dotfile Storage Write               : Writable at /app/data/home
[PASS] SQLite Creation & WAL Mode               : Journal mode: WAL
[PASS] SQLite Transaction Commit                : Total persistent records in DB: 1
[PASS] PM2 Persistent Dump File                 : Found /app/data/home/.pm2/dump.pm2

============================================================
[SUCCESS] 100% PERSISTENCE VERIFIED!
All databases, global NPM packages, and PM2 states reside on physical host storage.
Your data and API keys will safely survive container recreations and reboots.
============================================================
```
