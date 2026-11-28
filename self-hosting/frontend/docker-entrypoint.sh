#!/bin/sh
# Renders per-container runtime configuration, then hands off to nginx.
#
# Every setting comes from the container's runtime env; unset behaves the same
# as empty (empty API_HTTP selects same-origin `/api/v1` mode). The single
# exception is SENTRY_RELEASE: it falls back to the value baked at build time
# (DEFAULT_SENTRY_RELEASE) because the release must match the source maps CI
# uploaded for this exact bundle — a per-deployment override would detach
# Sentry events from their source maps.
set -eu

# --- Effective values -------------------------------------------------------

API_HTTP="${API_HTTP:-}"
API_VER="${API_VER:-/api/v1}"
# Set only by the self-hosting compose file. Anything but the exact string
# "true" — including unset, as on the hosted deployment — means not self-hosted.
IS_SELF_HOST="${IS_SELF_HOST:-}"
MCP_BASE_URL="${MCP_BASE_URL:-}"
DOCS_URL="${DOCS_URL:-}"
POSTHOG_KEY="${POSTHOG_KEY:-}"
POSTHOG_HOST="${POSTHOG_HOST:-}"
LOGO_DEV_TOKEN="${LOGO_DEV_TOKEN:-}"
SENTRY_DSN="${SENTRY_DSN:-}"
SENTRY_RELEASE="${SENTRY_RELEASE:-${DEFAULT_SENTRY_RELEASE:-}}"
CSP_EXTRA_CONNECT="${CSP_EXTRA_CONNECT:-}"
CSP_EXTRA_FORM_ACTION="${CSP_EXTRA_FORM_ACTION:-}"
CSP_EXTRA_ANALYTICS="${CSP_EXTRA_ANALYTICS:-}"
# nginx runs unprivileged here; hosts that keep ports below 1024 root-only
# (Synology Container Manager) need a high port such as 8080.
LISTEN_PORT="${LISTEN_PORT:-80}"

# --- Validation -------------------------------------------------------------

# A non-empty API URL must carry a scheme; without it the browser rejects it as
# a CSP source and every API call fails silently in the console. Empty is valid
# and selects same-origin mode (relative /api/v1, proxied by nginx).
case "$API_HTTP" in
  "" ) : ;;
  http://* | https://* ) : ;;
  * )
    echo "ERROR: API_HTTP must be empty (same-origin mode) or start with http:// or https:// (got: $API_HTTP)" >&2
    exit 1
    ;;
esac

# BACKEND_URL feeds nginx proxy_pass. A trailing slash gives proxy_pass a URI
# part, which makes nginx replace the matched /api/ prefix instead of passing
# it through — strip it so /api/v1/... reaches the backend intact.
if [ -n "${BACKEND_URL-}" ]; then
  case "$BACKEND_URL" in
    http://* | https://* ) : ;;
    * )
      echo "ERROR: BACKEND_URL must start with http:// or https:// (got: $BACKEND_URL)" >&2
      exit 1
      ;;
  esac
  BACKEND_URL="${BACKEND_URL%/}"
fi

# --- Runtime config shim ----------------------------------------------------

# Escape a value for embedding inside a JS double-quoted string literal.
# CR/LF are stripped first: a raw newline in an env value would produce an
# unterminated string literal and break all of config.js.
js_escape() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > /app/config.js <<EOF
window.__APP_CONFIG__ = {
  API_HTTP: "$(js_escape "$API_HTTP")",
  API_VER: "$(js_escape "$API_VER")",
  IS_SELF_HOST: "$(js_escape "$IS_SELF_HOST")",
  MCP_BASE_URL: "$(js_escape "$MCP_BASE_URL")",
  DOCS_URL: "$(js_escape "$DOCS_URL")",
  POSTHOG_KEY: "$(js_escape "$POSTHOG_KEY")",
  POSTHOG_HOST: "$(js_escape "$POSTHOG_HOST")",
  LOGO_DEV_TOKEN: "$(js_escape "$LOGO_DEV_TOKEN")",
  SENTRY_DSN: "$(js_escape "$SENTRY_DSN")",
  SENTRY_RELEASE: "$(js_escape "$SENTRY_RELEASE")",
};
EOF

# --- CSP + nginx config -----------------------------------------------------

# connect-src / form-action default to the API host so a self-hoster who only
# sets API_HTTP still gets a working CSP. The analytics slot defaults to the
# PostHog host so its requests aren't blocked when analytics is configured.
[ -n "$CSP_EXTRA_CONNECT" ] || CSP_EXTRA_CONNECT="$API_HTTP"
[ -n "$CSP_EXTRA_FORM_ACTION" ] || CSP_EXTRA_FORM_ACTION="$API_HTTP"
[ -n "$CSP_EXTRA_ANALYTICS" ] || CSP_EXTRA_ANALYTICS="$POSTHOG_HOST"

# Plaid is an opt-in SPA policy addition; neither credentials nor wildcards go to nginx.
CSP_PLAID_SCRIPT=""
CSP_PLAID_FRAME=""
CSP_PLAID_CONNECT=""
if [ "$IS_SELF_HOST" = "true" ]; then
  PLAID_ENV="$(printf '%s' "${PLAID_ENV:-}" | tr -d '[:space:]')"
  case "$PLAID_ENV" in
    "" ) : ;;
    sandbox) CSP_PLAID_CONNECT="https://sandbox.plaid.com/" ;;
    production) CSP_PLAID_CONNECT="https://production.plaid.com/" ;;
    * ) echo "WARNING: PLAID_ENV must be sandbox or production (got: $PLAID_ENV); Plaid stays disabled" >&2 ;;
  esac
  if [ -n "$CSP_PLAID_CONNECT" ]; then
    CSP_PLAID_SCRIPT="https://cdn.plaid.com/link/v2/stable/link-initialize.js"
    CSP_PLAID_FRAME="https://cdn.plaid.com/"
  fi
fi

# 302, not 301: browsers cache a 301 indefinitely, which would keep redirecting
# after the operator turns SKIP_LANDING back off.
LANDING_REDIRECT=""
[ "${SKIP_LANDING:-}" != "true" ] || LANDING_REDIRECT="return 302 /dashboard;"

# envsubst only touches the named placeholders; every other `$var` in the
# template is an nginx runtime variable and must be left intact.
export CSP_EXTRA_CONNECT CSP_EXTRA_FORM_ACTION CSP_EXTRA_ANALYTICS LANDING_REDIRECT LISTEN_PORT
export CSP_PLAID_SCRIPT CSP_PLAID_FRAME CSP_PLAID_CONNECT
envsubst '$CSP_EXTRA_CONNECT $CSP_EXTRA_FORM_ACTION $CSP_EXTRA_ANALYTICS $CSP_PLAID_SCRIPT $CSP_PLAID_FRAME $CSP_PLAID_CONNECT $LANDING_REDIRECT $LISTEN_PORT' \
  < /etc/nginx/templates/nginx.conf.template \
  > /etc/nginx/nginx.conf

# --- Conditional /api reverse proxy -----------------------------------------

# Only emit the proxy block when BACKEND_URL is set (same-origin deployments).
# An unconditional proxy_pass to an unresolvable host crashes nginx at startup,
# so deployments that talk to the API cross-origin get an empty include.
API_PROXY_INCLUDE="/etc/nginx/includes/api-proxy.conf"
if [ -n "${BACKEND_URL-}" ]; then
  cat > "$API_PROXY_INCLUDE" <<EOF
location /api/ {
  proxy_pass ${BACKEND_URL};
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
  proxy_set_header X-Forwarded-Host \$host;
  proxy_set_header Connection "";
  # Backend streams Server-Sent Events; buffering would stall them.
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
EOF
else
  : > "$API_PROXY_INCLUDE"
fi

# --- MCP endpoint + OAuth discovery metadata --------------------------------

# MCP clients read /.well-known/oauth-authorization-server and
# /.well-known/oauth-protected-resource to learn which authorization server to
# talk to, then call /mcp. Both root and path-aware forms are served
# (RFC 8414 3.1, RFC 9728 3.1) because clients differ in which they request.
#
# Same-origin deployments proxy them to the backend, which builds the documents
# from MCP_BASE_URL and so names this deployment. Split-domain deployments have
# no backend to proxy to here and serve the static mirrors baked into
# /app/.well-known/ instead. The mirrors ship with the hosted deployment's
# URLs, so when MCP_BASE_URL is set they are rewritten to it — otherwise a
# client that asks this origin would be sent to the hosted service.
OAUTH_MCP_INCLUDE="/etc/nginx/includes/oauth-mcp.conf"
if [ -n "${BACKEND_URL-}" ]; then
  cat > "$OAUTH_MCP_INCLUDE" <<EOF
location = /mcp {
  proxy_pass ${BACKEND_URL};
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
  proxy_set_header X-Forwarded-Host \$host;
  proxy_set_header Connection "";
  # MCP responses stream over SSE; buffering would stall them.
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
# Clients differ on whether the pasted MCP URL keeps a trailing slash; without
# this a "/mcp/" connector lands on the SPA fallback and fails confusingly.
location = /mcp/ {
  rewrite ^ /mcp last;
}

# Claude.ai ignores the endpoints advertised in the metadata and calls
# /authorize, /token and /register on the origin root. The backend answers
# those with 307s to their real /api/v1/auth/oauth2/* paths.
location = /authorize {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
location = /token {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
location = /register {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}

location = /.well-known/oauth-authorization-server {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
location = /.well-known/oauth-authorization-server/mcp {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
# RFC 8414 3.1 path-aware form: the AS issuer carries the /api/v1/auth path,
# so clients look here (well-known segment after the host, then issuer path).
location = /.well-known/oauth-authorization-server/api/v1/auth {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
location = /.well-known/oauth-protected-resource {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
location = /.well-known/oauth-protected-resource/mcp {
  proxy_pass ${BACKEND_URL};
  proxy_set_header Host \$host;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF
else
  # The mirror files (packages/frontend/public/.well-known/) name the hosted
  # backend under two hosts: api. for the authorization server, mcp. for the
  # resource. A self-host has one backend origin, so both collapse to MCP_BASE_URL.
  if [ -n "$MCP_BASE_URL" ] && [ "${MCP_BASE_URL%/}" != "https://mcp.moneymatter.app" ]; then
    for doc in /app/.well-known/oauth-authorization-server /app/.well-known/oauth-protected-resource; do
      sed -e "s|https://mcp\.moneymatter\.app|${MCP_BASE_URL%/}|g" -e "s|https://api\.moneymatter\.app|${MCP_BASE_URL%/}|g" "$doc" > "$doc.tmp"
      mv "$doc.tmp" "$doc"
    done
  fi

  cat > "$OAUTH_MCP_INCLUDE" <<'EOF'
location = /.well-known/oauth-authorization-server {
  root /app;
  default_type "application/json";
  add_header Access-Control-Allow-Origin "*" always;
  add_header Cache-Control "public, max-age=3600" always;
  add_header X-Content-Type-Options "nosniff" always;
}
location = /.well-known/oauth-authorization-server/mcp {
  root /app;
  try_files /.well-known/oauth-authorization-server =404;
  default_type "application/json";
  add_header Access-Control-Allow-Origin "*" always;
  add_header Cache-Control "public, max-age=3600" always;
  add_header X-Content-Type-Options "nosniff" always;
}
location = /.well-known/oauth-protected-resource {
  root /app;
  default_type "application/json";
  add_header Access-Control-Allow-Origin "*" always;
  add_header Cache-Control "public, max-age=3600" always;
  add_header X-Content-Type-Options "nosniff" always;
}
location = /.well-known/oauth-protected-resource/mcp {
  root /app;
  try_files /.well-known/oauth-protected-resource =404;
  default_type "application/json";
  add_header Access-Control-Allow-Origin "*" always;
  add_header Cache-Control "public, max-age=3600" always;
  add_header X-Content-Type-Options "nosniff" always;
}
EOF
fi

exec "$@"
