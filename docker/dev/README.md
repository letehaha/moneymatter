# Development Docker Setup

This directory contains the Docker configuration for local development with hot module reloading (HMR).

## Services

- **backend**: Node.js backend API (port defined in .env)
- **frontend**: Vue.js frontend (port defined in .env)
- **db**: PostgreSQL 16 database
- **redis**: Redis 7 cache
- **currency-rates-api**: Self-hosted exchange rates service (ECB + NBU)
- **pgadmin**: PostgreSQL admin interface (port 8001)

## Quick Start (Online Mode)

1. Ensure you have `.env.development` file in the project root
2. Build and start services:
   ```bash
   npm run docker:dev
   ```

HMR is enabled by default through volume mounts. Changes to source code will automatically reload.

## Offline Mode

If you need to work without internet connection (e.g., on a plane, train, or with unreliable connection):

### First Time Setup (While Online)

Prepare everything for offline use:

```bash
npm run docker:dev:prepare-offline
```

This command:

- Builds Docker images with npm dependencies cached
- Pulls all required base images (postgres:16, redis:7, etc.)
- Caches Node.js base images (node:24.22.1)

### Using Offline

Once prepared, start Docker in offline mode:

```bash
npm run docker:dev:offline
```

This skips npm install/ci steps and uses the cached dependency layers from your previous build.

**Important**:

- HMR still works in offline mode! Source code changes are reflected immediately through volume mounts.
- Background jobs requiring internet (exchange rates, securities sync) are automatically disabled in offline mode.

## Rebuilding Dependencies

If you need to update dependencies (requires internet):

```bash
npm run docker:dev:rebuild
```

## Environment Variables

Required variables in `.env.development`:

- `APPLICATION_PORT`: Backend API port
- `PORT`: Frontend dev server port
- `APPLICATION_DB_USERNAME`: Database username
- `APPLICATION_DB_PASSWORD`: Database password
- `APPLICATION_DB_DATABASE`: Database name
- `APPLICATION_DB_PORT`: Database port (default: 5432)
- `PGADMIN_DEFAULT_EMAIL`: PgAdmin login email
- `PGADMIN_DEFAULT_PASSWORD`: PgAdmin login password
- `PGADMIN_LISTEN_PORT`: PgAdmin port (default: 8001)

## Common Commands

```bash
# Start services (rebuilds automatically)
npm run docker:dev

# Start services in offline mode (skip npm install)
npm run docker:dev:offline

# Prepare for offline work (run while online)
npm run docker:dev:prepare-offline

# Stop services
npm run docker:dev:down

# View logs
npm run docker:dev:logs

# Rebuild all images from scratch (clears cache)
npm run docker:dev:rebuild

# Remove all data (fresh start, removes volumes)
npm run docker:dev:clean

# Database migrations
npm run docker:dev:migrate
npm run docker:dev:migrate-undo
```

## Troubleshooting

### Port Conflicts

If services fail to start due to port conflicts, check which ports are in use:

```bash
lsof -i :3000  # or your configured port
```

### Database Issues

To reset the database:

```bash
npm run docker:dev:clean  # Removes volumes and stops services
npm run docker:dev        # Start fresh
```

### Offline Mode Not Working

Ensure you prepared images while online first:

```bash
npm run docker:dev:prepare-offline
```

### HMR Not Working

1. Check that volume mounts are correct in docker-compose.yml
2. Ensure you're not running with `--no-cache` flag
3. Verify file permissions on mounted volumes

## How It Works

The offline mode uses the `DOCKER_OFFLINE_MODE` environment variable that's read by docker-compose.yml:

```yaml
build:
  args:
    OFFLINE_MODE: ${DOCKER_OFFLINE_MODE:-false}
environment:
  - OFFLINE_MODE=${DOCKER_OFFLINE_MODE:-false}
```

When `DOCKER_OFFLINE_MODE=true`:

1. **Build time**: Dockerfiles skip npm install/ci steps and use cached dependency layers from previous builds
2. **Runtime**: Backend app checks `OFFLINE_MODE` env variable and skips background jobs that require internet:
   - `initializeHistoricalRates()` - Loading historical exchange rates
   - `loadCurrencyRatesJob` - Currency rates sync job
   - `securitiesDailySyncCron` - Securities data sync cron

This allows you to rebuild containers and run the application without internet access while keeping HMR fully functional.
