# ==============================================================================
# MoneyMatter Combined Container (Frontend + Backend + Embedded Redis)
# Image: ghcr.io/elwin/moneymatter/combined:latest
# ==============================================================================

# 🏗️ Stage 1: Build Frontend SPA & Astro Landing
FROM --platform=$BUILDPLATFORM node:24.21.0 AS frontend-build

WORKDIR /app

ENV NODE_OPTIONS="--max-old-space-size=4096"

ARG VITE_SENTRY_RELEASE=
ARG VITE_APP_COMMIT_HASH=
ARG SENTRY_AUTH_TOKEN=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=

# Copy root manifest and build scripts
COPY package*.json ./
COPY post-install.sh ./
COPY patches ./patches
RUN chmod +x ./post-install.sh

# Install dependencies for frontend & landing workspaces
COPY packages/frontend/package*.json ./packages/frontend/
COPY packages/landing/package*.json ./packages/landing/
RUN npm ci

# Materialize build-time production env
RUN printf '%s\n' \
    "VITE_SENTRY_RELEASE=$VITE_SENTRY_RELEASE" \
    "VITE_APP_COMMIT_HASH=$VITE_APP_COMMIT_HASH" \
    "SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN" \
    "SENTRY_ORG=$SENTRY_ORG" \
    "SENTRY_PROJECT=$SENTRY_PROJECT" \
    > /app/.env.production

# Copy source code
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend
COPY packages/landing ./packages/landing

# Build SPA and Landing
WORKDIR /app/packages/frontend
RUN npm run build

WORKDIR /app/packages/landing
RUN npm run build


# 🏗️ Stage 2: Build Backend
FROM node:24.21.0-alpine AS backend-build

WORKDIR /app
RUN apk add --no-cache python3 make g++

COPY package*.json ./
COPY post-install.sh ./
RUN chmod +x ./post-install.sh
COPY packages/backend/package*.json ./packages/backend/
RUN npm ci

COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY self-hosting ./self-hosting

WORKDIR /app/packages/backend
RUN npm run build


# 🚀 Stage 3: Production Combined Runtime
FROM node:24.21.0-alpine AS production

LABEL org.opencontainers.image.title="MoneyMatter Combined" \
      org.opencontainers.image.description="MoneyMatter combined container with Frontend, Backend, and embedded Redis" \
      org.opencontainers.image.source="https://github.com/elwin/moneymatter"

# Install runtime dependencies: Nginx, Redis, Supervisor, Gettext (envsubst)
RUN apk add --no-cache \
    nginx \
    redis \
    supervisor \
    gettext \
    ca-certificates \
    curl \
    python3 \
    make \
    g++

WORKDIR /app

# Create non-root users and set up directory structure
RUN addgroup -g 1001 nodejs 2>/dev/null || true \
    && adduser -u 1001 -G nodejs -s /bin/sh -D nodejs 2>/dev/null || true \
    && mkdir -p /frontend /landing \
    && mkdir -p /etc/nginx/templates /etc/nginx/includes \
    && mkdir -p /run/nginx /var/log/nginx /var/lib/nginx \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log \
    && mkdir -p /usr/share/nginx/html \
    && printf '<html><body><h1>502 Bad Gateway</h1><p>The backend service is starting up or unavailable.</p></body></html>\n' > /usr/share/nginx/html/50x.html \
    && mkdir -p /data/redis /run/redis /var/log/redis \
    && chown -R redis:redis /data/redis /run/redis /var/log/redis

# Install production node_modules for backend
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs post-install.sh ./
RUN chmod +x ./post-install.sh
COPY --chown=nodejs:nodejs packages/backend/package*.json ./packages/backend/
RUN npm ci && apk del python3 make g++

# Copy built frontend & landing assets
COPY --from=frontend-build --chown=nginx:nginx /app/packages/frontend/dist /frontend
COPY --from=frontend-build --chown=nginx:nginx /app/packages/landing/dist /landing

# Copy built backend code and metadata
COPY --from=backend-build --chown=nodejs:nodejs /app/tsconfig.json ./
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/dist ./packages/backend/dist
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/package.json ./packages/backend/package.json
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/.sequelizerc ./packages/backend/.sequelizerc
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/config ./packages/backend/config
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/src/migrations ./packages/backend/src/migrations
COPY --from=backend-build --chown=nodejs:nodejs /app/packages/backend/src/resources ./packages/backend/src/resources

# Set up backend uploads directory
RUN mkdir -p /app/packages/backend/data/attachments \
    && chown -R nodejs:nodejs /app/packages/backend/data

# Copy combined configurations and scripts
COPY self-hosting/combined/nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY self-hosting/combined/redis.conf /etc/redis/redis.conf
COPY self-hosting/combined/supervisord.conf /etc/supervisord.conf
COPY self-hosting/combined/start-backend.sh /usr/local/bin/start-backend.sh
COPY self-hosting/combined/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/start-backend.sh /usr/local/bin/docker-entrypoint.sh

# Environment defaults
ENV NODE_ENV=production \
    IS_SELF_HOST=true \
    APPLICATION_REDIS_HOST=127.0.0.1 \
    APPLICATION_HOST=127.0.0.1 \
    APPLICATION_PORT=8081 \
    BACKEND_URL=http://127.0.0.1:8081 \
    LISTEN_PORT=80 \
    SKIP_LANDING=true

EXPOSE 80

VOLUME ["/app/packages/backend/data/attachments", "/data/redis"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
