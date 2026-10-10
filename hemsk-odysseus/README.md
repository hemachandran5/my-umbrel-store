# Odysseus — hemsk Umbrel App Store

A custom-store package of Odysseus for `hemachandran5/my-umbrel-store`.

## App-store presentation

- **Name:** Odysseus
- **Tagline:** AI workspace for chat & research
- **Description:** Odysseus brings AI chat, web-assisted research, and contextual knowledge retrieval together in one self-hosted workspace. Connect a supported model provider or OpenAI-compatible endpoint, use SearXNG for web search, and keep your application services and vector database on your own server.
- **Icon:** `icon.png`, loaded from this repository's `main` branch via the raw GitHub URL in `umbrel-app.yml`.

The included icon is a custom Odysseus-themed store icon, not a claim that the artwork is the upstream project's official logo.

## Install into the custom app store

1. Upload the complete `hemsk-odysseus` folder to the root of the `main` branch of:
   `https://github.com/hemachandran5/my-umbrel-store`
2. Make sure all four files are committed: `umbrel-app.yml`, `docker-compose.yml`, `README.md`, and `icon.png`.
3. Refresh/reload your custom app store in Umbrel OS and open Odysseus.

The folder and manifest ID must stay `hemsk-odysseus` because the store ID is `hemsk`. The `app_proxy` targets `hemsk-odysseus_odysseus_1` on port `7000`.

## First launch

- Open Odysseus from the Umbrel dashboard.
- The Compose file does not contain a fixed administrator password. Check startup logs for the initial credential if the image generates one, then change it after login.
- Configure an LLM provider or OpenAI-compatible endpoint in Odysseus.
- Keep the application behind Umbrel's authenticated app proxy. Do not add a direct host-port mapping for the Odysseus container.

To inspect containers and logs over SSH:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker logs --tail 200 hemsk-odysseus_odysseus_1 2>&1 | grep -i -E 'password|admin|auth'
```

If the container uses another name, use the name shown by `docker ps`.

## Raspberry Pi 4 note

Use 64-bit Umbrel OS (`uname -m` should report `aarch64`). This package keeps the pinned upstream Big Bear container image references. The upstream manifest does not declare every image's architecture, so verify each image supports `linux/arm64` on your installation before relying on it.

## Upstream project

- Project: https://github.com/odysseus-dev/odysseus
- Original Big Bear Umbrel package: https://github.com/bigbeartechworld/big-bear-umbrel/tree/master/big-bear-umbrel-odysseus
