# Reverse Proxies

A reverse proxy is the piece that sits between the internet and the app: it
owns your domain, handles HTTPS, and passes requests through. The whole app
lives on a single HTTP port (`http://<host>:8080` by default), so the setup is
always the same regardless of which proxy you use: forward your domain to that
one port and you're done – the app and its API come through together, there is
no second port to configure.

## Requirements (any proxy)

- **Don't buffer live updates.** The app keeps a long-lived connection open to
  stream live updates (Server-Sent Events). Most proxies handle this fine with
  default settings; if a setting like "buffering" or "websocket support"
  exists, make sure streaming isn't blocked, or live sync updates in the UI
  will freeze.
- **Pass the standard forwarding headers** (`Host`, `X-Forwarded-Proto`).
  Nearly every proxy does this out of the box; only check this if you built a
  config by hand.
- **Allow bigger uploads.** Importing a bank statement sends the whole file in
  one request – up to about 15 MB. Some proxies reject anything over 1 MB by
  default, which makes large imports fail with a "413" or "Request Entity Too
  Large" error. If your proxy has an upload size (or request size) limit, raise
  it to at least 15 MB.
- **Forward the whole domain, not a list of paths.** Everything the app needs
  is on that one port, but it is more than `/` and `/api/`: MCP clients also
  fetch `/mcp`, `/.well-known/oauth-*` and `/authorize`, `/token`, `/register`.
  If you hand-wrote per-path rules, those requests land on the wrong place and
  MCP silently connects to the hosted service instead of yours.
- **Close the direct port.** Your proxy serves the app over HTTPS, but the
  plain-HTTP port `8080` is still open to anyone until you close it –
  see [setup-guide.md](setup-guide.md#3-behind-your-own-reverse-proxy), step 3.

And on the app side: `BETTER_AUTH_URL` and `AUTH_ORIGIN` in `.env` must be
set to the URL people type in the browser (e.g. `https://budget.example.com`)
– see [setup-guide.md](setup-guide.md#3-behind-your-own-reverse-proxy),
step 2.

## Cloudflare Tunnel

A Cloudflare Tunnel (`cloudflared`) needs no open port at all: run the
`cloudflared` container on the app's `budget-tracker` Docker network and point
the tunnel's public hostname at `http://budget-tracker:80`, the same address
the other containerized proxies use (see
[Proxy running in Docker on the same server](#proxy-running-in-docker-on-the-same-server)).
Put Cloudflare Access in front if you want a sign-in before the app is even
reachable.

Nothing else to set for the client address either: the tunnel container sits
on a private Docker address, which the backend trusts by default. See
[Client IP address](#client-ip-address).

## Client IP address

The backend stores the address a session was created from (Settings → Security
→ Active Sessions) and counts sign-in attempts per address. Behind a proxy it
reads that address from `X-Forwarded-For`, but only when the request really
arrives from a proxy it trusts. A request from any other address has the
header ignored, so nobody can claim a different address by sending their own.

Proxies on private addresses are trusted by default: the same host
(`127.0.0.1`), or the app's Docker network (`172.16.0.0/12` and the other
private ranges). That covers every setup on this page, including Cloudflare
Tunnel, Nginx Proxy Manager, Caddy and Traefik running in Docker, so you
usually don't set anything. When the addresses come out wrong, the symptom is
"Unknown location" on every session, or sessions that all show the proxy's
own address.

If a proxy in front of the app sits on a **public** address (for example a
proxy on another server), add it to the defaults in `.env`, then run
`docker compose up -d`:

```
TRUSTED_PROXIES=loopback,linklocal,uniquelocal,203.0.113.10
```

Always keep `loopback,linklocal,uniquelocal` in the list: the bundled frontend
container reaches the backend from a private Docker address, and the backend
also calls itself over loopback. Without them every session shows the
frontend container's address. The value is a comma-separated list of IP
addresses and CIDR ranges. A typo fails the start with a message naming the bad
entry, rather than trusting the wrong host. Don't list addresses you don't
control.

## Nginx Proxy Manager

Add a **Proxy Host**: forward to `http://<host>:8080`, and enable
**Websockets Support** in the details tab. Request a Let's Encrypt cert on the
SSL tab. The app and API share the origin, so there's nothing else to route.

If a large import ever fails with a **413** / "Request Entity Too Large" error,
open the Proxy Host's **Advanced** tab, add the line below, and save:

```
client_max_body_size 15m;
```

If you connect an MCP client (Claude, ChatGPT) and the sign-in page returns a
**403**, turn **Block Common Exploits** off on the Proxy Host. Nginx Proxy
Manager's exploit filter rejects the OAuth authorization URL because of its
query string.

Nginx Proxy Manager is almost always run as a container itself. If yours is,
don't forward to `http://<host>:8080` – reach the app over the Docker network
instead. See
[Proxy running in Docker on the same server](#proxy-running-in-docker-on-the-same-server)
for the exact field values.

## Caddy

```caddy
budget.example.com {
    reverse_proxy <host>:8080
}
```

Caddy needs nothing else – it gets the HTTPS certificate automatically and
its defaults handle streaming, headers, and large uploads correctly (Caddy has
no upload size limit).

## Traefik (your own)

This is for when you already run your own Traefik. (No Traefik yet? The stack
ships a preconfigured one instead – see [traefik-overlay.md](traefik-overlay.md).)

Traefik usually discovers services through Docker labels, but the app's
compose file ships without any – so tell Traefik about the app with a small
config file instead. Save this as a new file (e.g. `budget-tracker.yml`) in
the folder your Traefik reads dynamic config from:

```yaml
http:
  routers:
    budget-tracker:
      rule: Host(`budget.example.com`)
      entryPoints: [websecure]
      service: budget-tracker
      tls:
        certResolver: letsencrypt
  services:
    budget-tracker:
      loadBalancer:
        servers:
          - url: 'http://<host>:8080'
```

Swap in your own domain, and match `entryPoints` and `certResolver` to the
names your Traefik already uses (`websecure` and `letsencrypt` are the common
ones – yours are in your `traefik.yml`).

Never set up such a folder? It's called the _file provider_: two lines in your
static config (`traefik.yml`) turn it on, and Traefik picks up every `.yml`
you drop into the folder:

```yaml
providers:
  file:
    directory: /etc/traefik/dynamic
```

If Traefik runs in Docker, that folder must also be mounted into the container
(a `volumes:` line in its compose file) – and don't forward to `<host>:8080`:
plug Traefik into the app's network and set the server `url` to
`http://budget-tracker:80` instead. See
[Proxy running in Docker on the same server](#proxy-running-in-docker-on-the-same-server).

Nothing else to tune: Traefik has no upload size limit and passes the app's
live updates (streaming) through with default settings.

## Plain nginx

For an nginx you installed yourself (apt install, certbot, etc.). Add a new
site file (e.g. `/etc/nginx/sites-enabled/budget-tracker.conf`):

```nginx
server {
    listen 80;
    server_name budget.example.com;

    # Importing a bank statement sends the whole file in one request.
    # Without this line nginx caps requests at 1 MB and big imports fail
    # with a 413 error.
    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Reload nginx (`sudo systemctl reload nginx`), then add HTTPS the way you
usually do – e.g. `sudo certbot --nginx -d budget.example.com` (certbot edits
the block above for you).

### nginx running in Docker

Same idea, two changes. The address becomes `http://budget-tracker:80` – after
plugging the nginx container into the app's network, see
[Proxy running in Docker on the same server](#proxy-running-in-docker-on-the-same-server).
And the `location` block needs two extra lines so nginx re-finds the app after
updates:

```nginx
server {
    listen 80;
    server_name budget.example.com;

    client_max_body_size 15m;

    location / {
        # Ask Docker's DNS for the app's current address instead of
        # remembering the one from nginx's own start. Without these two
        # lines, an app update that recreates the containers can leave
        # nginx pointing at the old address – every request answers 502
        # until nginx is restarted.
        resolver 127.0.0.11 valid=30s;
        set $app http://budget-tracker:80;

        proxy_pass $app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Proxy running in Docker on the same server

Most people run their reverse proxy as a container too – Nginx Proxy Manager
almost always, and often a dockerized Caddy or Traefik. That changes just one
thing: how the proxy reaches the app. The rest (HTTPS, your domain) is the same.

Containers can only find each other by name if they share the same Docker
network. Think of a Docker network as a small private LAN – a virtual switch
that a group of containers are plugged into. The app's containers all sit on a
network named `budget-tracker`. Your proxy container starts on its own separate
network, so out of the box it can't see the app at all.

**Don't point the proxy at `http://<server-ip>:8080` from inside the container.**
It looks like it should work, but it's the wrong path: inside a container,
`127.0.0.1` means the container itself (not the host), so `http://127.0.0.1:8080`
never reaches the app. The server's LAN IP can sometimes work but is fragile –
it breaks the moment the IP or the open port changes. The reliable route is the
Docker network below.

**Forward to `http://budget-tracker:80`.** Once your proxy is plugged into the
`budget-tracker` network, it can reach the app's frontend container by its name –
`budget-tracker` – on port `80`. That is the container's own internal port, not the
published `8080`. So the address you forward to is simply `http://budget-tracker:80`:
no host, no IP, no `8080`.

### Plugging the proxy into the network

There are two ways to attach your proxy container to the `budget-tracker` network.

**Quick test (temporary).** If the proxy is already running and you just want to
try it right now:

```bash
docker network connect budget-tracker <proxy-container-name>
```

Replace `<proxy-container-name>` with your proxy's container name (`docker ps`
lists it). This takes effect immediately. The catch: the attachment is dropped
whenever that container is **recreated** – for example the next time you run
`docker compose up` on the proxy after updating its image. Fine for a
five-minute test, not for a permanent setup.

**Permanent (recommended).** If your proxy has its own `docker-compose.yml`,
declare the `budget-tracker` network in that file and attach the proxy service to it.
This survives image updates and restarts. Example for Nginx Proxy Manager
(match the service name to your own file):

```yaml
services:
  npm:
    # ...your existing config...
    networks:
      - default
      - budget-tracker

networks:
  budget-tracker:
    external: true
```

`external: true` means "this network already exists – reuse the app's one
instead of creating a new network". Keep `default` in the list as well, or the
proxy loses the network it was already using. Then run `docker compose up -d` on
the proxy stack.

**Start order matters.** The app stack has to be up first, because it is the one
that creates the `budget-tracker` network. If the proxy starts first, it fails with
`network budget-tracker declared as external, but could not be found`. Fix: start the
app first (`docker compose up -d` from `self-hosting/`), then start the proxy.

### Nginx Proxy Manager field values

With Nginx Proxy Manager attached to the `budget-tracker` network, open your Proxy
Host and set the **Details** tab like this:

| Field              | Value            |
| ------------------ | ---------------- |
| Scheme             | `http`           |
| Forward Hostname   | `budget-tracker` |
| Forward Port       | `80`             |
| Websockets Support | enabled          |

Request the Let's Encrypt certificate on the **SSL** tab as usual. Nothing else
to configure – the app and API share the origin.

### After switching to the network route

Your proxy now reaches the app over the Docker network, so it no longer needs
the published host port at all. Close port `8080` to the internet by setting
`HTTP_PORT=127.0.0.1:8080` in `.env` and running `docker compose up -d` again –
see [setup-guide.md](setup-guide.md#3-behind-your-own-reverse-proxy), step 3.
That `127.0.0.1` setting is safe to keep here precisely because your proxy isn't
using the host port anymore.

No reverse proxy yet? The stack can handle HTTPS itself with a bundled
Traefik – see [traefik-overlay.md](traefik-overlay.md).
