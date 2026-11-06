import type { RecordId } from '@bt/shared/types';
import { logger } from '@js/utils';
import { namespace } from '@models/connection';
import { REDIS_KEY_PREFIX, redisClient } from '@root/redis-client';

import { SSE_EVENT_TYPES, sseManager } from '../../common/sse';

/**
 * Check if Redis client is ready for operations
 * Prevents "The client is closed" errors during test teardown
 */
function isRedisReady(): boolean {
  return redisClient.status === 'ready';
}

export enum SyncStatus {
  IDLE = 'idle',
  QUEUED = 'queued', // For Monobank jobs waiting in BullMQ queue
  SYNCING = 'syncing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface AccountSyncStatus {
  accountId: RecordId;
  status: SyncStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export const REDIS_KEYS = {
  userLastAutoSync: (userId: number | string): string => `user:${userId}:last-auto-sync`,
  accountSyncStatus: (accountId: number | string): string => `account:${accountId}:sync-status`,
  accountPriority: (accountId: number | string): string => `account:${accountId}:priority`,
};

const AUTO_SYNC_PERIOD = 12 * 60 * 60 * 1000;
// 24 hours for prod, and about infinity for other envs to avoid unneeded syncs
const STATUS_TTL = (process.env.NODE_ENV === 'production' ? 24 : 3600) * 60 * 60;
const STALE_SYNC_THRESHOLD = 20 * 60 * 1000; // 20 minutes - if PENDING/SYNCING for longer, consider stale

/**
 * Check if auto-sync is needed based on last sync time
 */
export async function shouldTriggerAutoSync(userId: number): Promise<boolean> {
  if (!isRedisReady()) return true; // Default to allowing sync if Redis unavailable

  const lastSyncTime = await redisClient.get(REDIS_KEYS.userLastAutoSync(userId));

  if (!lastSyncTime) {
    return true; // No previous sync recorded
  }

  const lastSyncTimestamp = parseInt(lastSyncTime, 10);
  const timeSinceLastSync = Date.now() - lastSyncTimestamp;

  return timeSinceLastSync >= AUTO_SYNC_PERIOD;
}

/**
 * Update user's last auto-sync timestamp
 */
export async function updateLastAutoSync(userId: number): Promise<void> {
  if (!isRedisReady()) return;
  await redisClient.set(REDIS_KEYS.userLastAutoSync(userId), Date.now().toString());
}

/**
 * Get last auto-sync timestamp for user
 */
export async function getLastAutoSync(userId: number): Promise<number | null> {
  if (!isRedisReady()) return null;
  const lastSyncTime = await redisClient.get(REDIS_KEYS.userLastAutoSync(userId));
  return lastSyncTime ? parseInt(lastSyncTime, 10) : null;
}

/**
 * Set sync status for an account and emit SSE event
 */
export async function setAccountSyncStatus({
  accountId,
  status,
  error = null,
  userId,
}: {
  accountId: RecordId;
  status: SyncStatus;
  error?: string | null;
  userId: number;
}): Promise<void> {
  await setAccountsSyncStatus({ accountIds: [accountId], status, error, userId });
}

/**
 * Set the same sync status for several accounts, then emit a single SSE event
 */
export async function setAccountsSyncStatus({
  accountIds,
  status,
  error = null,
  userId,
}: {
  accountIds: RecordId[];
  status: SyncStatus;
  error?: string | null;
  userId: number;
}): Promise<void> {
  if (!isRedisReady() || accountIds.length === 0) return;

  await Promise.all(accountIds.map((accountId) => writeAccountSyncStatus({ accountId, status, error })));

  if (status !== SyncStatus.IDLE && isRedisReady()) {
    await emitSyncStatus({ userId });
  }
}

async function emitSyncStatus({ userId }: { userId: number }): Promise<void> {
  // The full-status re-query costs several DB queries; skip it when nobody is listening.
  if (!sseManager.hasConnections(userId)) return;

  try {
    // Import dynamically to avoid circular dependency
    const { getUserAccountsSyncStatus } = await import('./get-user-sync-status');
    // Off the ambient transaction: after a failed sync statement it is aborted and every query on it throws.
    const fullStatus = await namespace.runPromise(async () => {
      namespace.set('transaction', null);
      return getUserAccountsSyncStatus(userId);
    });
    sseManager.sendToUser({
      userId,
      event: SSE_EVENT_TYPES.SYNC_STATUS_CHANGED,
      data: fullStatus,
    });
  } catch (err) {
    // Log but don't throw - Redis state is already updated, SSE is best-effort
    logger.error({ message: '[SSE] Failed to emit sync status event', error: err as Error });
  }
}

async function writeAccountSyncStatus({
  accountId,
  status,
  error,
}: {
  accountId: RecordId;
  status: SyncStatus;
  error: string | null;
}): Promise<void> {
  // startedAt is required to detect stale active syncs (isStaleStatus uses it).
  // Stamp it for QUEUED too — otherwise an account that never transitions out
  // of QUEUED never gets cleaned up by the staleness check and the UI keeps
  // showing it as in-progress until the Redis TTL expires.
  const statusData: AccountSyncStatus = {
    accountId,
    status,
    startedAt: isActiveSync(status) ? new Date().toISOString() : null,
    completedAt: [SyncStatus.COMPLETED, SyncStatus.FAILED].includes(status) ? new Date().toISOString() : null,
    error: error ?? null,
  };

  // startedAt is inherited only from a still-active run, so COMPLETED/FAILED keeps
  // that run's start and a terminal record never ages a freshly queued one.
  const existing = await getAccountSyncStatus(accountId);
  if (existing?.startedAt && isActiveSync(existing.status) && status !== SyncStatus.SYNCING) {
    statusData.startedAt = existing.startedAt;
  }

  // Re-check Redis connection after async operation (client may have closed during getAccountSyncStatus)
  if (!isRedisReady()) return;

  await redisClient.setex(REDIS_KEYS.accountSyncStatus(accountId), STATUS_TTL, JSON.stringify(statusData));
}

/**
 * Get sync status for an account
 * Automatically clears stale PENDING/SYNCING statuses
 */
export async function getAccountSyncStatus(accountId: RecordId): Promise<AccountSyncStatus | null> {
  const defaultStatus = createDefaultStatus(accountId);

  if (!isRedisReady()) return defaultStatus;

  const data = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));

  if (!data) {
    return defaultStatus;
  }

  const status: AccountSyncStatus = JSON.parse(data);

  if (isStaleStatus(status)) {
    logger.info(`Account ID:${accountId} was queued/syncing for too long. Status was reset.`);
    if (isRedisReady()) {
      await redisClient.del(REDIS_KEYS.accountSyncStatus(accountId));
    }
    return defaultStatus;
  }

  return status;
}

/**
 * Get sync status for multiple accounts - uses MGET for batch Redis lookup
 */
export async function getMultipleAccountsSyncStatus(accountIds: RecordId[]): Promise<AccountSyncStatus[]> {
  if (accountIds.length === 0) return [];

  if (!isRedisReady()) {
    return accountIds.map(createDefaultStatus);
  }

  const keys = accountIds.map((id) => REDIS_KEYS.accountSyncStatus(id));
  const results = await redisClient.mget(...keys);

  const statuses: AccountSyncStatus[] = [];
  const keysToDelete: string[] = [];

  for (let i = 0; i < accountIds.length; i++) {
    const accountId = accountIds[i]!;
    const data = results[i];
    const defaultStatus = createDefaultStatus(accountId);

    if (!data) {
      statuses.push(defaultStatus);
      continue;
    }

    try {
      const status: AccountSyncStatus = JSON.parse(data);

      if (isStaleStatus(status)) {
        keysToDelete.push(keys[i]!);
        logger.info(`Account ID:${accountId} was queued/syncing for too long. Status was reset.`);
        statuses.push(defaultStatus);
        continue;
      }

      statuses.push(status);
    } catch {
      statuses.push(defaultStatus);
    }
  }

  // Batch delete stale keys (if any)
  if (keysToDelete.length > 0 && isRedisReady()) {
    await redisClient.del(...keysToDelete);
  }

  return statuses;
}

/**
 * Clear sync status for an account
 */
export async function clearAccountSyncStatus(accountId: string): Promise<void> {
  if (!isRedisReady()) return;
  await redisClient.del(REDIS_KEYS.accountSyncStatus(accountId));
}

/**
 * Set priority score for an account (higher = more priority)
 */
export async function setAccountPriority(accountId: string, priority: number): Promise<void> {
  if (!isRedisReady()) return;
  await redisClient.setex(REDIS_KEYS.accountPriority(accountId), STATUS_TTL, priority.toString());
}

/**
 * Clear stale sync statuses from Redis on startup
 * Only resets QUEUED/SYNCING statuses (which are invalid after restart)
 * Preserves COMPLETED/FAILED/IDLE statuses and user last-sync timestamps
 */
export async function clearAllSyncStatuses(): Promise<void> {
  if (!isRedisReady()) {
    logger.info('[Sync Status] Skipping cleanup - Redis not ready');
    return;
  }

  // Wrap into `*..*` wildcard just in case
  const accountStatusKeys = await redisClient.keys(`*${REDIS_KEYS.accountSyncStatus('*')}*`);

  let clearedCount = 0;
  let resetCount = 0;

  for (const rawKey of accountStatusKeys) {
    // Strip the keyPrefix from keys returned by keys() to avoid double-prefixing
    const key =
      REDIS_KEY_PREFIX && rawKey.startsWith(REDIS_KEY_PREFIX) ? rawKey.slice(REDIS_KEY_PREFIX!.length) : rawKey;
    // Check Redis connection before each operation to handle teardown gracefully
    if (!isRedisReady()) {
      logger.info('[Sync Status] Stopping cleanup - Redis connection closed');
      break;
    }

    try {
      const data = await redisClient.get(key);
      if (!data) continue;

      const status: AccountSyncStatus = JSON.parse(data);

      // Only reset statuses that indicate active syncing
      // These are invalid after a restart since the actual sync process is gone
      if (isActiveSync(status.status)) {
        // Reset to IDLE instead of deleting - preserves the key structure
        const resetStatus: AccountSyncStatus = {
          ...status,
          status: SyncStatus.IDLE,
          startedAt: null,
          completedAt: null,
          error: 'Sync interrupted by server restart',
        };

        if (isRedisReady()) {
          await redisClient.setex(key, STATUS_TTL, JSON.stringify(resetStatus));
          resetCount++;
        }
      }
      // Keep COMPLETED, FAILED, and IDLE statuses - they're still valid
    } catch {
      // If we can't parse it, delete it (only if Redis is still ready)
      if (isRedisReady()) {
        await redisClient.del(key);
        clearedCount++;
      }
    }
  }

  if (resetCount > 0 || clearedCount > 0) {
    logger.info(
      `[Sync Status] Startup cleanup: reset ${resetCount} active syncs to IDLE, cleared ${clearedCount} invalid keys`,
    );
  }

  // Note: We DON'T touch userLastAutoSync or accountPriority keys
  // These are historical data and remain valid across restarts
}

/**
 * Create a default IDLE status for an account
 */
function createDefaultStatus(accountId: RecordId): AccountSyncStatus {
  return {
    accountId,
    status: SyncStatus.IDLE,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

/**
 * Check if status represents an active sync operation
 */
function isActiveSync(status: SyncStatus): boolean {
  return status === SyncStatus.QUEUED || status === SyncStatus.SYNCING;
}

/**
 * Check if a sync status is stale (active for too long)
 */
function isStaleStatus(status: AccountSyncStatus): boolean {
  if (isActiveSync(status.status) && status.startedAt) {
    const startedTime = new Date(status.startedAt).getTime();
    const elapsed = Date.now() - startedTime;
    return elapsed > STALE_SYNC_THRESHOLD;
  }
  return false;
}
