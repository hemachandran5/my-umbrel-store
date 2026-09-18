# Build & Deployment Guide: LiteRT Gemma on Umbrel OS

This guide details how to build the Docker image, publish it to your container registry, and deploy **LiteRT Gemma** onto your Raspberry Pi 4 via your custom Umbrel App Store.

---

## 1. Directory Structure

```
hemsk-litert-gemma/
├── umbrel-app.yml         # Umbrel app manifest
├── docker-compose.yml     # Container orchestration & port mapping
├── icon.svg               # App Store vector icon
├── Dockerfile             # Multi-arch container definition (linux/arm64)
├── build_and_deploy.md    # This deployment guide
└── app/
    ├── main.py            # FastAPI server with LiteRT-LM & OpenAI API
    ├── requirements.txt   # Python package dependencies
    └── static/
        └── index.html     # Responsive Web Chat UI
```

---

## 2. Building the Docker Container

You can build the container image completely in the cloud on GitHub without installing Docker locally!

### Method A: Fully Automated in GitHub (Recommended)

A GitHub Actions workflow is already included at `.github/workflows/build-litert-gemma.yml`.

1. Push your repository (`my-umbrel-store`) with `hemsk-litert-gemma/` and `.github/workflows/` to GitHub.
2. GitHub Actions will automatically start an ARM64 build using QEMU & Docker Buildx.
3. Once finished, the image is automatically published to:
   `ghcr.io/hemachandran5/litert-gemma:latest`
4. **Important**: Go to your GitHub profile -> **Packages** -> `litert-gemma` -> **Package settings** -> Change package visibility to **Public** so Umbrel can pull it freely without login credentials.

---

### Method B: Build Locally on your PC with Docker Buildx

From your computer terminal in `hemsk-litert-gemma`:

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/hemachandran5/litert-gemma:latest --push .
```

---

### Method C: Build directly on the Raspberry Pi

If you have SSH access to your Umbrel server (`ssh umbrel@umbrel.local`):

```bash
scp -r ./hemsk-litert-gemma umbrel@umbrel.local:~/hemsk-litert-gemma
ssh umbrel@umbrel.local
cd ~/hemsk-litert-gemma
docker build -t ghcr.io/hemachandran5/litert-gemma:latest .
```

---

## 3. Adding to your Custom Umbrel App Store

You already have the custom store repository set up at:  
`https://github.com/hemachandran5/my-umbrel-store`

1. Copy the `hemsk-litert-gemma` directory into your cloned `my-umbrel-store` git repository:
   ```bash
   cp -r "c:\Users\HEMACHANDRANSK\Downloads\Antigravity Projects\Umbrel OS Raspberry pi Nas Server\hemsk-litert-gemma" path/to/my-umbrel-store/
   ```

2. Commit and push the changes:
   ```bash
   cd path/to/my-umbrel-store
   git add hemsk-litert-gemma
   git commit -m "Add LiteRT Gemma AI app for Raspberry Pi 4"
   git push origin main
   ```

---

## 4. Installing the App on Umbrel

Once pushed to your GitHub store, Umbrel will discover the new app:

### Option 1: Via the Umbrel Web Dashboard
1. Open your Umbrel dashboard (`http://umbrel.local` or `http://192.168.29.211`).
2. Go to the **App Store**.
3. Locate **LiteRT Gemma** under your community store.
4. Click **Install**.

### Option 2: Via Antigravity Umbrel MCP
You can also ask Antigravity to install it directly using the Umbrel MCP tool:
```json
{
  "appId": "hemsk-litert-gemma"
}
```

---

## 5. First Boot & Persistent Model Storage

* On first launch, the container checks `/data/models` (mapped to `${APP_DATA_DIR}/data` on your Raspberry Pi storage).
* If `gemma-3-1b-it.litertlm` is not found, the container automatically downloads it in the background from Hugging Face (`litert-community/Gemma3-1B-IT`).
* Because the model is stored on the persistent volume `${APP_DATA_DIR}/data`, subsequent container restarts or updates load instantly without re-downloading.

---

## 6. Integrating with OmniRoute

Since you already have **OmniRoute** (`hemsk-omniroute`) on your Umbrel server on port `20128`:

1. Open OmniRoute at `http://umbrel.local:20128`.
2. Add a custom OpenAI-compatible provider:
   * **Provider Name**: `LiteRT Gemma (Local Pi 4)`
   * **Base URL**: `http://192.168.29.211:20135/v1` (or `http://litert_gemma_server_1:8000/v1` if using Docker network)
   * **API Key**: `not-needed`
   * **Model**: `gemma-3-1b-it`
3. Now all your local coding assistants (Antigravity, Cursor, Cline, OpenCode) can route queries to your on-device Gemma model through OmniRoute!
