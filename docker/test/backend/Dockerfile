FROM node:24.22.1

WORKDIR /app

# Copy package.json and package-lock.json files. This allows Docker to cache the
# npm dependencies as long as these files don't change.
COPY package*.json ./
COPY post-install.sh ./
COPY packages/backend/package*.json ./packages/backend/
COPY packages/shared/package*.json ./packages/shared/

# Copy TS configs
COPY tsconfig*.json ./
COPY packages/backend/tsconfig*.json ./packages/backend/
COPY packages/shared/tsconfig*.json ./packages/shared/

# Install dependencies
COPY post-install.sh ./
COPY docker ./docker
RUN chmod +x ./post-install.sh
RUN npm ci --include=dev

# Copy source codes
COPY packages/backend ./packages/backend
COPY packages/shared ./packages/shared

# Run this command to keep container alive. Without it will be demounted right after deps installation
CMD ["tail", "-f", "/dev/null"]
