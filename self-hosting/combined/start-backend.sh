#!/bin/sh
set -e

REDIS_HOST="${APPLICATION_REDIS_HOST:-127.0.0.1}"
if [ "$REDIS_HOST" = "redis" ] || [ -z "$REDIS_HOST" ]; then
  REDIS_HOST="127.0.0.1"
fi
export APPLICATION_REDIS_HOST="$REDIS_HOST"

echo "[Backend] Waiting for Redis at $REDIS_HOST:6379 to become available..."
MAX_REDIS_WAIT=30
COUNT=0
until redis-cli -h "$REDIS_HOST" ping >/dev/null 2>&1; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_REDIS_WAIT" ]; then
    echo "[Backend] Redis at $REDIS_HOST:6379 did not respond within $MAX_REDIS_WAIT attempts. Exiting."
    exit 1
  fi
  sleep 1
done
echo "[Backend] Redis is responsive."

cd /app/packages/backend

echo "[Backend] Running database migrations..."
MAX_TRIES=15
COUNT=0
until npm run migrate; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_TRIES" ]; then
    echo "[Backend] Database migration failed after $MAX_TRIES attempts. Check database connection settings."
    exit 1
  fi
  echo "[Backend] Database not ready yet or migration failed. Retrying in 2 seconds ($COUNT/$MAX_TRIES)..."
  sleep 2
done
echo "[Backend] Database migrations completed successfully."

echo "[Backend] Starting Node.js server..."
exec node --enable-source-maps dist/app.js
