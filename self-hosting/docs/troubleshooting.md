# Troubleshooting

Common issues when running the self-hosting stack. Setup guide:
[setup-guide.md](setup-guide.md).

## `502` from `/api`

The frontend proxies `/api/` to the backend; a 502 means the backend isn't
answering yet. On first boot the backend runs migrations before binding its
HTTP port (its healthcheck stays red for up to ~60s). If it persists, check the
backend:

```bash
docker compose logs backend
```

A crash-looping backend is usually a bad `.env` – see the two
entries below.

## Reverse proxy in Docker: `502` / `Bad Gateway`

If your reverse proxy runs as a container (Nginx Proxy Manager, a dockerized
Caddy or Traefik) and shows `502` or `Bad Gateway`, it usually can't reach the
app: a proxy container can't get to `http://<server-ip>:8080` or
`http://127.0.0.1:8080` (inside a container, `127.0.0.1` is the container
itself). Put the proxy on the app's `budget-tracker` Docker network and forward to
`http://budget-tracker:80` instead – see
[reverse-proxies.md](reverse-proxies.md#proxy-running-in-docker-on-the-same-server).

## Worked before, `502` right after updating the app (nginx in Docker)

Plain nginx looks up the app's address once, at its own start. When an update
(`docker compose pull` + `up -d`) recreates the app's containers, the app can
come back on a new internal address – nginx keeps talking to the old one and
serves `502` until it is restarted.

Quick fix: restart the proxy container (`docker restart <nginx-container>`).
Permanent fix: the `resolver` lines in the
[nginx-in-Docker snippet](reverse-proxies.md#nginx-running-in-docker) make
nginx re-look-up the address by itself. Nginx Proxy Manager, Caddy, and
Traefik do this out of the box and don't have this problem.

## Imports fail on large files (`413` / "Request Entity Too Large")

Importing a bank statement sends the whole file in one upload – up to about
15 MB. Many reverse proxies reject anything over 1 MB by default, so a big
import fails with a `413` or "Request Entity Too Large" error (sometimes it just
looks like the upload silently did nothing). The fix is to raise your proxy's
upload size limit to at least 15 MB.

Plain nginx – add this inside your `server` (or `location`) block, then reload
nginx (`nginx -s reload`):

```nginx
client_max_body_size 15m;
```

Nginx Proxy Manager: add the same line in the Proxy Host's **Advanced** tab.
Caddy needs no change – it has no upload size limit.

## Backend exits immediately: `__REPLACE_ME__` secret

The backend refuses to start while `APPLICATION_JWT_SECRET`,
`APP_SESSION_ID_SECRET`, `BETTER_AUTH_SECRET`, or `APPLICATION_DB_PASSWORD` is
still `__REPLACE_ME__`. Fill all four with `openssl rand -base64 32` output.

## "AUTH_ORIGIN must be set in production"

The backend hard-throws on this on boot. Set `AUTH_ORIGIN` in `.env` to the
URL you open the app at (e.g. `http://localhost:8080`, or your domain) and
restart the backend.

## Login succeeds but immediately logs out / login loops

Typically seen when opening the app via a LAN IP or a custom host. Two causes:

- **`AUTH_ORIGIN` / `BETTER_AUTH_URL` don't match the address bar.** Both must
  carry the _exact_ URL you open the app at (scheme, host, and port – e.g.
  `http://192.168.1.20:8080`). Anything else is an origin mismatch and auth
  requests get rejected. Update both in `.env`, then `up -d`.
- **Proxy serves https but `BETTER_AUTH_URL` still says `http://`.** The
  session cookie's security level follows the scheme of `BETTER_AUTH_URL`, and
  the http value is also an origin mismatch. Set both vars to the public
  `https://` URL, then `up -d`.

## iOS app: sign-in with Apple, Google or GitHub fails

The app reached the server under a different address than `BETTER_AUTH_URL`.
Each of these sign-ins is bound to that value:

- **Apple** answers `403` with code `APPLE_NONCE_SERVER_MISMATCH` (visible in
  the backend log as `better-auth 403`).
- **Google / GitHub** end with the app saying the server's address doesn't
  match its configuration.

Set `BETTER_AUTH_URL` (and `AUTH_ORIGIN`) in `.env` to the exact URL you type
into the app – same scheme, host and port, e.g. `https://budget.example.com` –
then `up -d`. A proxy that serves the app on a second host name needs the app
pointed at the one in `BETTER_AUTH_URL`. For Google and GitHub also check that
`<BETTER_AUTH_URL>/api/v1/auth/callback/<provider>` is registered as a redirect
URI. More: [Connect the iOS app](ios-app.md).

## Backend logs "ECONNREFUSED" to db

Postgres can take 10–30s on first boot to initialise its data files. The
backend's `depends_on: db: { condition: service_healthy }` normally handles
this – if you've customised the compose file, make sure that clause is intact.

## "CSP blocked: connect-src" in the browser console

In the default same-origin setup the CSP is derived automatically and needs no
tuning. If you serve the API from a separate origin (`API_HTTP` set) or add a
third-party host, list it in `CSP_EXTRA_CONNECT` / `CSP_EXTRA_ANALYTICS`, then
`up -d`. No rebuild – the CSP is rendered from env at container start.

## Enable Banking: URL "uses unsupported scheme"

Enable Banking only accepts `https` redirect URLs, so an instance served over
plain `http://<server-ip>:8080` can't be registered as is. Put the app behind
HTTPS – any reverse proxy with TLS ([reverse-proxies.md](reverse-proxies.md)),
or the bundled [Traefik overlay](traefik-overlay.md), which pairs with nip.io
if you have no domain. Then set the callback in `.env`:

```bash
ENABLE_BANKING_REDIRECT_URL=https://budget.example.com/bank-callback
```

register the exact same URL in your Enable Banking application, and run
`docker compose up -d --force-recreate backend`.

**LAN-only instance (no public HTTPS).** The redirect URL is only where your
browser lands after the bank login – Enable Banking never calls it directly. So:

1. Register `https://localhost:8080/bank-callback` (use your own host and
   port) in Enable Banking, set the same value as `ENABLE_BANKING_REDIRECT_URL`,
   and recreate the backend as above.
2. After approving in the bank, the browser lands on `https://...` and fails to
   load. Change `https` to `http` in the address bar, keep the whole
   `?code=...&state=...` part, and press Enter. The callback page finishes the
   connection.

## Stale config after changing env vars

The frontend's runtime config (`/config.js`, which carries `API_HTTP`,
analytics keys, etc.) is served with `no-store`, so a plain reload picks up the
new values after `up -d`. If the UI still looks stale, hard-refresh
(Ctrl/Cmd-Shift-R) to bust the cached SPA bundle.

## Healthcheck / liveness

The backend exposes `GET /health` (used by the compose healthcheck). Check it
from inside the network:

```bash
docker compose exec backend \
  wget -qO - http://localhost:8081/health
```

## Exchange rates missing / `currency-rates-api` logs DNS errors

`currency-rates-api` fetches live rates from external sources (ECB, NBU), so it
needs **outbound internet access**. If you customized the compose network,
don't mark it `internal: true` – the rates container will log resolution
errors continuously and rate syncing stalls. The shipped `budget-tracker` network is
a regular bridge and works as-is.

## Frontend build OOMs (build-from-source overlay only)

The frontend build is memory-heavy. Add 2 GB of swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Traefik overlay: Let's Encrypt "unable to generate a certificate"

ACME TLS-ALPN-01 needs **port 443 reachable** from the internet, and your
domain's A record must resolve to the host. Verify:

```bash
sudo ss -tlnp | grep ':443'   # traefik should be listed
dig +short budget.example.com # should print the host's public IP
```

If your provider has a separate firewall panel, allow 80/443 inbound there too.

## Traefik overlay: resetting Let's Encrypt state (rate-limit recovery)

ACME has a 5-failures-per-hour cap. If you tripped it (usually bad DNS), wait an
hour, then clear the cert volume and re-up:

```bash
docker compose -f docker-compose.yml \
  -f docker-compose.traefik.yml down
docker volume rm budget-tracker-prod_traefik_letsencrypt
docker compose -f docker-compose.yml \
  -f docker-compose.traefik.yml up -d
```
