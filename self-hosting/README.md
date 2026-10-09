# MoneyMatter – Self-Hosting

Run MoneyMatter on your own server with Docker Compose. The stack pulls
published Docker images (amd64) and exposes the whole app on **one host port** –
put whatever reverse proxy you already run in front of it (Nginx Proxy
Manager, npmplus, Caddy, Traefik), or nothing at all for a LAN / localhost
trial.

## Quickstart

```bash
git clone https://github.com/letehaha/moneymatter.git
cd moneymatter/self-hosting
cp .env.example .env   # then fill the REQUIRED section
docker compose up -d
```

Open `http://<host>:8080`. Full walkthrough:
[setup guide](docs/setup-guide.md).

## Documentation

- [Setup guide](docs/setup-guide.md) – prerequisites, quickstart, exposing
  the app publicly, building from source, backups.
- [Portainer](docs/portainer.md) – deploy the same stack from the Portainer
  UI instead of the CLI.
- [Reverse proxies](docs/reverse-proxies.md) – requirements any proxy must
  meet + recipes per proxy (Nginx Proxy Manager, Caddy).
- [Traefik overlay](docs/traefik-overlay.md) – bundled TLS termination with
  Let's Encrypt, for hosts without a reverse proxy.
- [Environment variable reference](docs/environment-reference.md) – every
  `.env` setting: required, optional features, frontend runtime, overlays.
- [Troubleshooting](docs/troubleshooting.md) – common issues and fixes.

## What's in this folder

| Path                         | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `docker-compose.yml`         | Base stack – pulls published images, one host port      |
| `docker-compose.traefik.yml` | Optional overlay: bundled Traefik + Let's Encrypt TLS   |
| `docker-compose.build.yml`   | Optional overlay: build the images from source          |
| `.env.example`               | Configuration template – copy to `.env` and fill in     |
| `backend/`, `frontend/`      | Dockerfiles + entrypoints for the published images      |
| `docs/`                      | Setup guide, proxy docs, env reference, troubleshooting |

## Where to get help

- Issues: https://github.com/letehaha/moneymatter/issues
- License: AGPL-3.0 – see `LICENSE`
