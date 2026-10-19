import {
  API_ERROR_CODES,
  type BackupRestoreActiveStatus,
  type BackupRestoreProgress,
  type BackupRestoreSseProgress,
  type BackupRestoreStatusResponse,
  type BackupRestoreSummary,
  SSE_EVENT_TYPES,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { LockedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { SentryTraceData } from '@js/utils/sentry';
import { redisClient } from '@root/redis-client';
import {
  acquireBaseCurrencyLock,
  extendBaseCurrencyLockTtlIfOwned,
  releaseBaseCurrencyLockIfOwned,
} from '@services/currencies/base-currency-lock';
import { createImportJobQueue } from '@services/import-export/core/queue/create-import-job-queue';
import { isStalledPastLimitFailure } from '@services/import-export/core/queue/stalled-job-failure';
import { randomUUID } from 'node:crypto';

import { describeRestoreError } from './describe-restore-error';
import { restoreUserBackup } from './restore-backup.service';

interface BackupRestoreJobData extends SentryTraceData {
  userId: number;
  /** Base64-encoded backup zip. Re-parsed in the worker (deterministic) rather
   *  than shipping the fully-parsed archive through Redis. */
  fileContent: string;
}

// Extend the base-currency lock's TTL while a long restore runs so it can never
// lapse mid-restore and reopen the guarded routes. Restores finish well under the
// lock's own TTL, so this rarely fires — it's the safety net for a huge dataset.
const LOCK_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

// ponytail: tracks only processors running in this process. A multi-process
// deployment needs a shared marker such as a Redis key.
const jobIdsRunningInThisProcess = new Set<string>();

const INTERRUPTED_MESSAGE_KEY = 'common.jobInterruptedByServerUpdate';

const {
  queue: backupRestoreQueue,
  worker: backupRestoreWorker,
  enqueue,
} = createImportJobQueue<BackupRestoreJobData, BackupRestoreSummary, BackupRestoreSseProgress>({
  baseName: 'backup-restore',
  sseEventType: SSE_EVENT_TYPES.BACKUP_RESTORE_PROGRESS,
  logLabel: 'Backup Restore',
  interruptedMessageKey: INTERRUPTED_MESSAGE_KEY,
  processJob: async ({ job }) => {
    const { userId, fileContent } = job.data;
    const jobId = job.id!;

    // Hold the base-currency write-lock for the whole restore so base-currency
    // change / wipe / every other lock-guarded write can't start mid-restore and
    // race the wipe-and-reinsert. Taken here rather than at enqueue because the
    // shared queue scaffold self-aborts a job it finds already lock-held; by this
    // point that check has passed. If a base-currency change grabbed the lock in
    // the tiny enqueue→pickup window, acquisition fails and the restore aborts
    // cleanly (the change wins).
    const acquired = await acquireBaseCurrencyLock({ userId, jobId });
    if (!acquired) {
      throw new Error(t({ key: 'currencies.baseCurrencyChangeInProgress' }));
    }
    jobIdsRunningInThisProcess.add(jobId);

    const heartbeat = setInterval(() => {
      extendBaseCurrencyLockTtlIfOwned({ userId, jobId }).catch((err) => {
        logger.error({
          message: `[Backup Restore Worker] Lock TTL heartbeat failed for job ${jobId}`,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
      return await restoreUserBackup({
        userId,
        fileContent,
        // Persist the coarse phase on the job so /status polling reflects progress
        // without an SSE listener. Best-effort: a Redis hiccup must not fail the restore.
        onProgress: async (progress) => {
          try {
            await job.updateProgress(progress);
          } catch (err) {
            logger.warn(`[Backup Restore Worker] Progress update failed for job ${jobId}`, {
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        },
      });
    } catch (err) {
      throw describeRestoreError({ err });
    } finally {
      clearInterval(heartbeat);
      // A crashed worker skips this; the status endpoint reconciles the orphan.
      await releaseBaseCurrencyLockIfOwned({ userId, jobId }).catch((err) => {
        logger.error({
          message: `[Backup Restore Worker] Lock release failed for job ${jobId}`,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
      jobIdsRunningInThisProcess.delete(jobId);
    }
  },
});

export { backupRestoreQueue, backupRestoreWorker };

/**
 * Per-user pointer to the most recent restore job. The user-scoped status endpoint
 * (no job id in the URL) reads the jobId from here so a reloaded or second tab can
 * still find an in-flight restore. `-` separators keep it consistent with the jobId
 * (BullMQ forbids `:` in custom job ids); the main `redisClient` namespaces it per
 * Jest worker via `REDIS_KEY_PREFIX`.
 */
const buildLastRestoreJobPointerKey = (userId: number): string => `backup-restore-last-job-${userId}`;

/** Public entry point — the controller calls this after a successful preflight. */
export async function queueBackupRestore({
  userId,
  fileContent,
}: {
  userId: number;
  fileContent: string;
}): Promise<string> {
  // Reject a second restore for the same user while one is still in flight. The
  // worker's base-currency lock and the route's lock guard cover the running
  // window; this closes the enqueue→pickup gap where neither is in effect yet.
  const inflight = await backupRestoreQueue.getJobs(['active', 'waiting', 'delayed']);
  if (inflight.some((existing) => existing?.data?.userId === userId)) {
    throw new LockedError({
      code: API_ERROR_CODES.locked,
      message: t({ key: 'backup.restore.errors.alreadyInProgress' }),
    });
  }

  // Random suffix (no colons — BullMQ rejects them): two restores fired within
  // the same millisecond would otherwise collide on one id and BullMQ silently
  // drops the duplicate `add`.
  const jobId = `backup-restore-${userId}-${randomUUID()}`;

  // Point the user at this job before it starts so the user-scoped status endpoint
  // resolves it after a reload. Rolled back if the enqueue throws, so a stale pointer
  // can't make a never-started restore look in-flight.
  try {
    await redisClient.set(buildLastRestoreJobPointerKey(userId), jobId, 'EX', 24 * 3600);
    await enqueue({ userId, jobId, data: { userId, fileContent } });
  } catch (error) {
    await redisClient.del(buildLastRestoreJobPointerKey(userId)).catch((rollbackError) => {
      logger.error({
        message: `[Backup Restore] Pointer rollback failed after enqueue error for job ${jobId}`,
        error: rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)),
      });
    });
    throw error;
  }

  return jobId;
}

/**
 * Normalized snapshot of a restore job's BullMQ state, independent of the two
 * response shapes the public functions expose. Both `getBackupRestoreStatus` and
 * `getUserActiveRestoreStatus` project from this, so the two BullMQ read races —
 * "completed but the returnvalue summary isn't visible yet" and "failed but the
 * failedReason snapshot is still empty" — are handled here, in exactly one place.
 */
type RestoreJobStateSnapshot =
  | { kind: 'missing' }
  | { kind: 'completed'; summary: BackupRestoreSummary; progress?: BackupRestoreProgress }
  | { kind: 'failed'; error: string; errorDetail?: string; progress?: BackupRestoreProgress }
  | { kind: 'queued'; progress?: BackupRestoreProgress }
  | { kind: 'running'; progress?: BackupRestoreProgress };

/**
 * Read a restore job's current state, scoped to its owner. Resolves `missing`
 * when the job is gone or belongs to another user. Runs inside the status
 * request, so the failed branch translates here: the interrupted message for a
 * stalled job, otherwise a generic failure with BullMQ's English `failedReason`
 * kept apart as technical detail.
 */
async function readRestoreJobState({
  userId,
  jobId,
}: {
  userId: number;
  jobId: string;
}): Promise<RestoreJobStateSnapshot> {
  const job = await backupRestoreQueue.getJob(jobId);
  if (!job) return { kind: 'missing' };
  // Defense-in-depth: a job id / pointer must only ever resolve its own user's job.
  if (job.data.userId !== userId) return { kind: 'missing' };

  const state = await job.getState();
  const progress = (job.progress || undefined) as unknown as BackupRestoreProgress | undefined;

  if (state === 'completed') {
    const summary = job.returnvalue?.summary;
    // BullMQ flipped the job to completed but the returnvalue blob isn't visible
    // yet (write-vs-read race right after the handler resolves). Report it as still
    // running so a caller never hands the client an undefined summary — which would
    // read as "0 records restored", and for the watchdog would fire its wipe+reload.
    if (!summary) return { kind: 'running', progress };
    return { kind: 'completed', summary, progress };
  }
  if (state === 'failed') {
    // Re-fetch once: a job that flips active → failed between getJob and getState
    // can report `failed` while the first snapshot's failedReason is still empty.
    const settled = (await backupRestoreQueue.getJob(jobId)) ?? job;
    const failedReason = settled.failedReason || undefined;
    // Never release while this job's processor still runs here: BullMQ can fail a
    // live job as stalled, and a freed lock lets writes interleave with its open
    // transaction. A killed worker never reaches its `finally`, so its lock is freed here.
    if (!jobIdsRunningInThisProcess.has(jobId)) {
      await releaseBaseCurrencyLockIfOwned({ userId, jobId });
    }
    if (isStalledPastLimitFailure({ reason: failedReason })) {
      return { kind: 'failed', error: t({ key: INTERRUPTED_MESSAGE_KEY }), progress };
    }
    return { kind: 'failed', error: t({ key: 'backup.restore.errors.failed' }), errorDetail: failedReason, progress };
  }
  if (state === 'waiting' || state === 'delayed') {
    return { kind: 'queued', progress };
  }
  return { kind: 'running', progress };
}

/** Fallback polling path: current restore state for a job, scoped to its owner. */
export async function getBackupRestoreStatus({
  userId,
  jobId,
}: {
  userId: number;
  jobId: string;
}): Promise<BackupRestoreStatusResponse | null> {
  const snapshot = await readRestoreJobState({ userId, jobId });
  switch (snapshot.kind) {
    case 'missing':
      return null;
    case 'completed':
      return { jobId, status: 'completed', progress: snapshot.progress, summary: snapshot.summary };
    case 'failed':
      return {
        jobId,
        status: 'failed',
        progress: snapshot.progress,
        error: snapshot.error,
        errorDetail: snapshot.errorDetail,
      };
    case 'queued':
      return { jobId, status: 'pending', progress: snapshot.progress };
    case 'running':
      return { jobId, status: 'processing', progress: snapshot.progress };
  }
}

/**
 * Resolve the user's current restore from the per-user pointer key and the BullMQ
 * job it points at. Never 404s — the frontend calls this on every boot to drive
 * the blocking overlay — so "no job" and "job aged out" both return `idle`.
 *
 * State-based (unlike the by-jobId poll endpoint) so it plugs straight into the
 * shared blocking-job watchdog the base-currency change uses.
 */
export async function getUserActiveRestoreStatus({ userId }: { userId: number }): Promise<BackupRestoreActiveStatus> {
  const jobId = await redisClient.get(buildLastRestoreJobPointerKey(userId));
  // No pointer → never restored (or the pointer was cleared) → idle.
  if (!jobId) return { state: 'idle' };

  const snapshot = await readRestoreJobState({ userId, jobId });
  switch (snapshot.kind) {
    case 'missing':
      // Pointer lingered but the job aged out of retention (or belonged to another
      // user) → idle.
      return { state: 'idle' };
    case 'completed':
      return { state: 'completed', jobId, summary: snapshot.summary };
    case 'failed':
      return { state: 'failed', jobId, error: snapshot.error };
    case 'queued':
      return { state: 'queued', jobId };
    case 'running':
      return {
        state: 'running',
        jobId,
        phase: snapshot.progress?.phase,
        insertedRows: snapshot.progress?.insertedRows,
      };
  }
}
