# Frontend Deployment Flow

This document explains how the frontend application is built and containerized for deployment.

## Overview

The frontend uses a **two-stage Docker build** to create an optimized production image with nginx serving static files.

## Architecture

```
User Request
    ↓
Reverse Proxy (handles SSL, domain routing)
    ↓
Frontend Docker Container (port 80)
    ↓
Nginx Web Server
    ↓
Static Files (built application)
```

## Docker Build Process

### Build Stage (Node.js)

**Dockerfile location:** `self-hosting/frontend/Dockerfile`

1. **Base image:** `node:24.22.1`
2. **Install dependencies:** `npm ci` (clean install from package-lock.json)
3. **Copy source code:** All frontend source files and shared packages
4. **Build application:** `npm run build` in `packages/frontend`
5. **Output:** Static files in `packages/frontend/dist`

### Production Stage (Nginx)

1. **Base image:** `nginx:1.27-alpine`
2. **Copy built files:** SPA from build stage → `/app`, Astro landing → `/landing`
3. **Copy nginx config as a template:** `packages/frontend/nginx.conf` → `/etc/nginx/templates/nginx.conf.template` (rendered at container start, see below)
4. **Copy the entrypoint:** `self-hosting/frontend/docker-entrypoint.sh`
5. **Runs as the non-root `nginx` user**
6. **Result:** Minimal production image (~50MB vs ~1GB with Node.js)

**Why two stages?**

- **Smaller image size:** Only nginx + static files, no Node.js or build tools
- **Better security:** No development dependencies in production
- **Faster deployments:** Less data to transfer and start

## Runtime Configuration

The image is configured **at container start**, not only at build time, so one
published image can be deployed with different settings without a rebuild.
`self-hosting/frontend/docker-entrypoint.sh` runs before nginx and:

1. **Writes `/app/config.js`** exposing `window.__APP_CONFIG__` — `API_HTTP`,
   `API_VER`, `MCP_BASE_URL`, `DOCS_URL`, PostHog, logo.dev, and Sentry values read from the
   container's env. Both bundles read it at runtime: nginx serves it from an
   exact-match `/config.js` location rooted at `/app`, which resolves from the
   landing routes too, so the SPA and the Astro landing share one config. An
   empty `API_HTTP` selects **same-origin** mode (relative `/api/v1`).
   `config.js` is served `no-store`, so a reload picks up changes.
2. **Renders the CSP into `nginx.conf`** via `envsubst`, filling
   `CSP_EXTRA_CONNECT` / `CSP_EXTRA_FORM_ACTION` / `CSP_EXTRA_ANALYTICS`.
   The first two default to `API_HTTP`, which is the only cross-origin host the
   SPA fetches (`MCP_BASE_URL` is displayed for copy-paste, never requested), so
   most deployments can leave them unset. `CSP_EXTRA_ANALYTICS` defaults to
   `POSTHOG_HOST` alone — **a deployment using Sentry must set it explicitly**
   to a value covering the Sentry ingest host, or `connect-src` blocks every
   error report. The same pass fills `LANDING_REDIRECT` inside `location = /`:
   `return 302 /dashboard;` when `SKIP_LANDING=true` (the self-host compose
   default), empty otherwise so the hosted deployment keeps serving the landing.
3. **Emits a conditional `/api` reverse-proxy block** when `BACKEND_URL` is set,
   so nginx proxies `/api/` to the backend on the internal network (same-origin
   deployments). SSE is passed through unbuffered.

The container's runtime env is the **only** source of deployment configuration
— nothing deployment-specific is baked into the image, so `docker run` without
env produces a neutral same-origin setup. The single exception is
`SENTRY_RELEASE`: it defaults to the value baked at build time
(`DEFAULT_SENTRY_RELEASE`) because the release must match the source maps CI
uploaded for that exact bundle. Build args are limited to build identity
(`VITE_SENTRY_RELEASE`, `VITE_APP_COMMIT_HASH`) and Sentry source-map upload
credentials.

## Nginx Configuration

**File location:** `packages/frontend/nginx.conf`

```nginx
server {
  listen       80;
  server_name  _;  # Default catch-all
  location / {
    root   /app;
    index  index.html;
    try_files $uri $uri/ /index.html;  # SPA routing support
  }
}
```

**Key points:**

- `listen 80`: Nginx listens internally on port 80 (container port)
- `server_name _`: Default catch-all server (accepts any hostname)
- `try_files $uri $uri/ /index.html`: Enables client-side routing for single-page apps

The snippet above is the SPA-serving core; the shipped `nginx.conf` is a
**template** that also carries the CSP header (with `envsubst` placeholders) and
`include`s the runtime-generated `/api` reverse-proxy block. Both are filled in
by the entrypoint before nginx starts — see [Runtime Configuration](#runtime-configuration).

**Note:** When fronting this container with a reverse proxy (Nginx Proxy Manager, Caddy, the bundled Traefik overlay, …), the `server_name` directive doesn't matter since routing happens at the proxy layer. The container is also fine to expose directly on its published port with no proxy.
