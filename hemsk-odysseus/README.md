# Odysseus for hemsk Umbrel App Store

This folder adapts Big Bear's Odysseus package for the app-store namespace in
`hemachandran5/my-umbrel-store` (`umbrel-app-store.yml` uses `id: hemsk`).

## Add it to the repository

1. Copy the entire `hemsk-odysseus` folder to the root of the `main` branch of
   `https://github.com/hemachandran5/my-umbrel-store`.
2. Commit and push the new folder.
3. In Umbrel, refresh/reload your custom app store and install **Odysseus**.

The app ID and folder name must remain `hemsk-odysseus`, because community app
IDs must use the store's `hemsk-` prefix. The `app_proxy` points to the service
container `hemsk-odysseus_odysseus_1` on port `7000`.

## First launch

- Open Odysseus from the Umbrel dashboard.
- The Compose file deliberately does not contain a fixed administrator
  password. Check the Odysseus startup logs for its initial credential if the
  image generates one at first boot, then change it in Odysseus settings.
- Configure an LLM provider or an OpenAI-compatible endpoint in Odysseus.
- Keep the application behind Umbrel's authenticated app proxy. Do not add a
  direct host-port mapping for the Odysseus container.

To inspect container names and logs over SSH:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker logs --tail 200 hemsk-odysseus_odysseus_1 2>&1 | grep -i -E 'password|admin|auth'
```

If the app container uses a different generated name, use the name shown by
`docker ps`.

## Raspberry Pi 4 compatibility note

Use 64-bit Umbrel OS (`uname -m` should report `aarch64`). This package keeps the
same pinned image references as the upstream Big Bear app, but the upstream app
manifest does not declare per-image architectures. Verify that the pinned
Odysseus image digest has a `linux/arm64` variant before relying on this package
for Raspberry Pi 4; a successful manifest parse does not prove image-platform
compatibility.

## Source

- Big Bear Umbrel package: https://github.com/bigbeartechworld/big-bear-umbrel/tree/master/big-bear-umbrel-odysseus
- Odysseus upstream: https://github.com/pewdiepie-archdaemon/odysseus
