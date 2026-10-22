# 🏗️ Stage 1️⃣: Build
FROM node:24.22.1-alpine AS build-stage

WORKDIR /app

# Install build dependencies for native modules (node-gyp)
RUN apk add --no-cache python3 make g++

# Copy root-level package files
COPY package*.json ./
COPY post-install.sh ./
RUN chmod +x ./post-install.sh

# Copy backend package files
COPY packages/backend/package*.json ./packages/backend/

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy the rest of the code needed for build
COPY tsconfig.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY self-hosting ./self-hosting

# Build the backend
WORKDIR /app/packages/backend
RUN npm run build

# 🚀 Stage 2️⃣: Production
FROM node:24.22.1-alpine AS production

WORKDIR /app

# Install build dependencies for native modules (node-gyp)
RUN apk add --no-cache python3 make g++

# Create non-root user for security
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D nodejs

# COPY --chown sets ownership during the copy itself, avoiding a slow
# `chown -R /app` over the ~50k-file node_modules tree at the end.
# node_modules created by `npm ci` below stays root-owned but world-readable,
# which is all the nodejs runtime needs.
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs post-install.sh ./
RUN chmod +x ./post-install.sh

COPY --chown=nodejs:nodejs packages/backend/package*.json ./packages/backend/
RUN npm ci

# Remove build dependencies to reduce image size
RUN apk del python3 make g++

COPY --from=build-stage --chown=nodejs:nodejs /app/tsconfig.json ./

# Copy built backend code and shared files
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/dist ./packages/backend/dist
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/package.json ./packages/backend/package.json

# Copy .sequelizerc and config folder
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/.sequelizerc ./packages/backend/.sequelizerc
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/tsconfig.json ./packages/backend/tsconfig.json
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/config ./packages/backend/config
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/src/migrations ./packages/backend/src/migrations
COPY --from=build-stage --chown=nodejs:nodejs /app/packages/backend/src/resources ./packages/backend/src/resources

# Copy and prepare entrypoint script
COPY self-hosting/backend/docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Set working directory to backend
WORKDIR /app/packages/backend

# A named volume inherits the ownership of the image directory it is mounted
# over; without this the mountpoint is created root-owned and uploads fail.
RUN mkdir -p data/attachments && chown -R nodejs:nodejs data

# Switch to non-root user
USER nodejs

# Set environment to production
ENV NODE_ENV=production

# Sentry release tracking (passed as build arg)
ARG SENTRY_RELEASE
ENV SENTRY_RELEASE=$SENTRY_RELEASE

ENTRYPOINT ["/docker-entrypoint.sh"]

# Run the compiled app
CMD ["node", "--enable-source-maps", "dist/app.js"]
