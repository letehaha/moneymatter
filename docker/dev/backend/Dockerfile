FROM node:24.21.0

# Build arg to control offline mode
ARG OFFLINE_MODE=false

WORKDIR /app

# CLIs the backend drives for the Claude Code and Codex subscription providers.
# Pinned in this Dockerfile and in self-hosting/backend/Dockerfile: bump both together.
# CODEX_DISABLED_FEATURES (and its test fixture) is tied to the pinned Codex version.
ARG CLAUDE_CODE_VERSION=2.1.292
ARG CODEX_VERSION=0.160.1
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} @openai/codex@${CODEX_VERSION} \
    && npm cache clean --force \
    && claude --version \
    && codex --version

# Copy package files first for better caching
COPY package*.json ./
COPY post-install.sh ./
COPY packages/backend/package*.json ./packages/backend/
COPY packages/shared/package*.json ./packages/shared/

# Copy TS configs
COPY tsconfig*.json ./
COPY packages/backend/tsconfig*.json ./packages/backend/
COPY packages/shared/tsconfig*.json ./packages/shared/

# Install dependencies
# In offline mode, skip installation (use cached layer from previous build)
RUN chmod +x ./post-install.sh
RUN if [ "$OFFLINE_MODE" = "false" ]; then \
      npm ci; \
    else \
      echo "Offline mode: skipping npm ci, using cached dependencies"; \
    fi

# Copy source code
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared

ENV NODE_ENV=development

COPY docker/dev/backend/docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]

CMD ["npm", "run", "-w", "packages/backend", "dev"]
