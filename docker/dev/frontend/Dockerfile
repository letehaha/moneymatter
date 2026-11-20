FROM node:24.22.1

# Build arg to control offline mode
ARG OFFLINE_MODE=false

WORKDIR /app

# Copy only what's needed to install dependencies
COPY package*.json ./
COPY tsconfig.json ./
COPY post-install.sh ./
COPY patches ./patches

# Install shared and frontend package.json files separately to leverage Docker cache
COPY packages/shared/package*.json ./packages/shared/
COPY packages/frontend/package*.json ./packages/frontend/

RUN chmod +x ./post-install.sh

# Install dependencies
# Note: There was previously a workaround for @rollup/rollup-linux-arm64-gnu
# optional dependency issue (https://github.com/npm/cli/issues/4828).
# Using npm ci with --legacy-peer-deps as a more secure alternative.
# In offline mode, skip installation (use cached layer from previous build)
RUN if [ "$OFFLINE_MODE" = "false" ]; then \
      npm ci --legacy-peer-deps || npm install; \
    else \
      echo "Offline mode: skipping npm install, using cached dependencies"; \
    fi

# Now copy the rest of the code
COPY packages/shared ./packages/shared
COPY packages/frontend ./packages/frontend
COPY docker/dev ./docker/dev

COPY docker/dev/frontend/docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["npm", "run", "-w", "packages/frontend", "dev"]
