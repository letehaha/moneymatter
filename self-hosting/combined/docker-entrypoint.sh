#!/bin/sh
set -eu

echo "=== MoneyMatter Combined Initialization ==="

# --- Validation: Guard against dummy secrets --------------------------------
for var in APPLICATION_JWT_SECRET APP_SESSION_ID_SECRET BETTER_AUTH_SECRET APPLICATION_DB_PASSWORD; do
  eval "value=\"\${$var:-}\""
  case "$value" in
    __REPLACE_ME__*)
      echo "ERROR: $var is still set to placeholder '__REPLACE_ME__'." >&2
      echo "Generate a real secret (e.g. openssl rand -base64 32) and pass it as an environment variable." >&2
      exit 1
      ;;
  esac
done

if [ -z "${APPLICATION_REDIS_HOST:-}" ] || [ "${APPLICATION_REDIS_HOST}" = "redis" ]; then
  export APPLICATION_REDIS_HOST="127.0.0.1"
fi
export APPLICATION_HOST="${APPLICATION_HOST:-127.0.0.1}"
export APPLICATION_PORT="${APPLICATION_PORT:-8081}"
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8081}"
export IS_SELF_HOST="${IS_SELF_HOST:-true}"
export LISTEN_PORT="${LISTEN_PORT:-80}"
export SKIP_LANDING="${SKIP_LANDING:-true}"
export API_HTTP="${API_HTTP:-}"
export API_VER="${API_VER:-/api/v1}"
export MCP_BASE_URL="${MCP_BASE_URL:-}"
export DOCS_URL="${DOCS_URL:-}"
export POSTHOG_KEY="${POSTHOG_KEY:-}"
export POSTHOG_HOST="${POSTHOG_HOST:-}"
export LOGO_DEV_TOKEN="${LOGO_DEV_TOKEN:-}"
export SENTRY_DSN="${SENTRY_DSN:-}"
export SENTRY_RELEASE="${SENTRY_RELEASE:-${DEFAULT_SENTRY_RELEASE:-}}"
export CSP_EXTRA_CONNECT="${CSP_EXTRA_CONNECT:-}"
export CSP_EXTRA_FORM_ACTION="${CSP_EXTRA_FORM_ACTION:-}"
export CSP_EXTRA_ANALYTICS="${CSP_EXTRA_ANALYTICS:-}"

# --- Prepare directories & permissions --------------------------------------
mkdir -p /app/packages/backend/data/attachments
chown -R nodejs:nodejs /app/packages/backend/data

mkdir -p /data/redis
chown -R redis:redis /data/redis

mkdir -p /run/nginx /var/log/nginx /var/lib/nginx
chown -R nginx:nginx /var/log/nginx /var/lib/nginx

# --- Frontend runtime config shim -------------------------------------------
js_escape() {
  printf '%s' "$1" | tr -d '\r\n' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

cat > /frontend/config.js <<EOF
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

# --- CSP + Nginx configuration ----------------------------------------------
[ -n "$CSP_EXTRA_CONNECT" ] || CSP_EXTRA_CONNECT="$API_HTTP"
[ -n "$CSP_EXTRA_FORM_ACTION" ] || CSP_EXTRA_FORM_ACTION="$API_HTTP"
[ -n "$CSP_EXTRA_ANALYTICS" ] || CSP_EXTRA_ANALYTICS="$POSTHOG_HOST"

LANDING_REDIRECT=""
[ "${SKIP_LANDING:-}" != "true" ] || LANDING_REDIRECT="return 302 /dashboard;"

export CSP_EXTRA_CONNECT CSP_EXTRA_FORM_ACTION CSP_EXTRA_ANALYTICS LANDING_REDIRECT LISTEN_PORT
envsubst '$CSP_EXTRA_CONNECT $CSP_EXTRA_FORM_ACTION $CSP_EXTRA_ANALYTICS $LANDING_REDIRECT $LISTEN_PORT' \
  < /etc/nginx/templates/nginx.conf.template \
  > /etc/nginx/nginx.conf

# --- /api reverse proxy configuration ---------------------------------------
API_PROXY_INCLUDE="/etc/nginx/includes/api-proxy.conf"
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
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
location = /health {
  proxy_pass ${BACKEND_URL};
  proxy_http_version 1.1;
  proxy_set_header Host \$host;
  proxy_set_header X-Real-IP \$remote_addr;
  proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto \$scheme;
}
EOF

# --- MCP + OAuth endpoints include ------------------------------------------
OAUTH_MCP_INCLUDE="/etc/nginx/includes/oauth-mcp.conf"
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
  proxy_buffering off;
  proxy_read_timeout 3600s;
}
location = /mcp/ {
  rewrite ^ /mcp last;
}
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

echo "Initialization complete. Starting services..."
exec "$@"
