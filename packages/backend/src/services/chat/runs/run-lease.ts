import { CHAT_MAX_RUNS_PER_THREAD, CHAT_MAX_RUNS_PER_USER } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { redisClient } from '@root/redis-client';

/**
 * What proves a run is alive, and what bounds how many run at once.
 *
 * - The lease (`chat:run:<id>:lease`, TTL 60 s, refreshed every 15 s) belongs to the process that
 *   executes the run. When it is gone the run is dead and the sweep marks its message interrupted.
 * - The run counters are sorted sets of run ids scored by their expiry time, one per user and one per
 *   thread. A counter entry is bumped with the lease, so a crashed run's entry ages out by itself
 *   even if nothing ever releases it.
 */

const LEASE_TTL_SECONDS = 60;
const LEASE_REFRESH_MS = 15_000;
/** How long a counter entry lives without a refresh; a few missed lease ticks. */
const SLOT_TTL_MS = 2 * 60 * 1000;

export const runLeaseKey = ({ runId }: { runId: string }): string => `chat:run:${runId}:lease`;
export const threadRunsKey = ({ threadId }: { threadId: string }): string => `chat:thread-runs:${threadId}`;
export const userRunsKey = ({ userId }: { userId: number }): string => `chat:user-runs:${userId}`;

/** Drops expired entries, then adds the run when the set has room. One script, so two requests cannot both fit. */
const ACQUIRE_SLOT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

const takeSlot = async ({ key, limit, runId }: { key: string; limit: number; runId: string }): Promise<boolean> => {
  const now = Date.now();
  const taken = await redisClient.eval(
    ACQUIRE_SLOT_SCRIPT,
    1,
    key,
    now,
    limit,
    now + SLOT_TTL_MS,
    runId,
    SLOT_TTL_MS * 2,
  );

  return taken === 1;
};

type RunSlotResult = 'ok' | 'threadBusy' | 'userBusy';

/** Claims the thread's single run slot and one of the user's run slots. */
export const acquireRunSlots = async ({
  userId,
  threadId,
  runId,
}: {
  userId: number;
  threadId: string;
  runId: string;
}): Promise<RunSlotResult> => {
  if (!(await takeSlot({ key: threadRunsKey({ threadId }), limit: CHAT_MAX_RUNS_PER_THREAD, runId }))) {
    return 'threadBusy';
  }

  if (!(await takeSlot({ key: userRunsKey({ userId }), limit: CHAT_MAX_RUNS_PER_USER, runId }))) {
    await redisClient.zrem(threadRunsKey({ threadId }), runId);
    return 'userBusy';
  }

  return 'ok';
};

export const releaseRunSlots = async ({
  userId,
  threadId,
  runId,
}: {
  userId: number;
  threadId: string;
  runId: string;
}): Promise<void> => {
  await redisClient.multi().zrem(threadRunsKey({ threadId }), runId).zrem(userRunsKey({ userId }), runId).exec();
};

/** Whether the thread has a run that has not ended; an entry nothing refreshes counts until it ages out. */
export const hasActiveRun = async ({ threadId }: { threadId: string }): Promise<boolean> =>
  (await redisClient.zcount(threadRunsKey({ threadId }), Date.now(), '+inf')) > 0;

export const hasRunLease = async ({ runId }: { runId: string }): Promise<boolean> =>
  (await redisClient.exists(runLeaseKey({ runId }))) === 1;

export interface RunLease {
  /** Stops refreshing and removes the lease. */
  stop: () => Promise<void>;
}

/** Sets the lease and keeps it, and the run's counter entries, alive until `stop`. */
export const startRunLease = async ({
  runId,
  userId,
  threadId,
}: {
  runId: string;
  userId: number;
  threadId: string;
}): Promise<RunLease> => {
  const refresh = async () => {
    const expiresAt = Date.now() + SLOT_TTL_MS;
    await redisClient
      .multi()
      .set(runLeaseKey({ runId }), '1', 'EX', LEASE_TTL_SECONDS)
      .zadd(threadRunsKey({ threadId }), 'XX', expiresAt, runId)
      .zadd(userRunsKey({ userId }), 'XX', expiresAt, runId)
      .exec();
  };

  await refresh();
  const timer = setInterval(() => {
    refresh().catch((error: Error) => logger.warn('Chat run lease refresh failed', { runId, error: error.message }));
  }, LEASE_REFRESH_MS);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await redisClient.del(runLeaseKey({ runId }));
    },
  };
};
