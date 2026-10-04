import { SSEEventPayload, SSEEventType } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import { SentryTraceData, withQueueProcessSpan, withQueuePublishSpan } from '@js/utils/sentry';
import ImportBatches from '@models/import-batches.model';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { sseManager } from '@services/common/sse';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { Job, Queue, Worker } from 'bullmq';

import { isStalledPastLimitFailure } from './stalled-job-failure';

/**
 * Shared BullMQ + SSE scaffold for the file-import queues (Wallet, YNAB). Each
 * importer enqueues a single user-triggered job that writes rows in the
 * background and fans progress out over SSE; the wiring (Redis connection,
 * test-namespaced queue name, Queue/Worker creation, retention, throttled
 * progress, completion/failure SSE) is identical across importers, so it lives
 * here and is parameterized by the few bits that differ.
 *
 * The Worker is created here at module scope (this factory is called once at the
 * top level of each importer's queue module). It must NEVER be created inside a
 * `withTransaction()` / request handler: Sequelize v7 propagates the active
 * transaction via AsyncLocalStorage, so a Worker constructed inside a
 * transaction context would have its own queries throw "commit has been called".
 */

/** Job result every import worker resolves to: the importer-specific summary
 *  plus the total row count to report on completion. */
interface ImportJobResult<TSummary> {
  summary: TSummary;
  totalCount: number;
}

/** Per-row progress callback handed to the importer's execute service. Each
 *  committed transaction/transfer ticks it with the cumulative count. */
type ImportProgressCallback = (processedCount: number, totalCount: number) => void | Promise<void>;

/** Builds the three SSE payload variants for an importer. Each is optional in
 *  the factory params: when omitted, the factory falls back to defaults that
 *  emit the standard `{ jobId, status, processedCount, totalCount }` shape (plus
 *  `summary` on completed, `error` on failed). */
interface ImportPayloadBuilders<TSummary, TProgress extends SSEEventPayload> {
  /** Build the `running` SSE payload. Called for the initial tick and each
   *  throttled progress emit; the discriminated payload type stays importer-owned. */
  buildRunningPayload: (params: { jobId: string; processedCount: number; totalCount: number }) => TProgress;
  /** Build the terminal `completed` SSE payload from the stored job result. */
  buildCompletedPayload: (params: { jobId: string; totalCount: number; summary: TSummary }) => TProgress;
  /** Build the `failed` SSE payload, carrying the partial progress reached. */
  buildFailedPayload: (params: {
    jobId: string;
    processedCount: number;
    totalCount: number;
    error: string;
  }) => TProgress;
}

/** Default payload builders emitting the standard import-progress shape shared by
 *  every importer. Providers whose `TProgress` is the conventional
 *  `{ jobId, status, processedCount, totalCount }`-derived discriminated union
 *  can rely on these instead of hand-writing identical callbacks.
 *
 *  Each builder constructs a plain object literal in the exact shape of the
 *  corresponding union member and casts it to `TProgress`: a generic `TProgress`
 *  cannot prove a constructed literal matches the caller's discriminated union,
 *  so the cast bridges back to the declared type — the same technique the
 *  `enqueue` span and `getImportProgress` `queued` path use below. The runtime
 *  values are byte-identical to the per-importer callbacks they replace. */
function makeDefaultImportPayloadBuilders<TSummary, TProgress extends SSEEventPayload>(): ImportPayloadBuilders<
  TSummary,
  TProgress
> {
  return {
    buildRunningPayload: ({ jobId, processedCount, totalCount }) =>
      ({
        jobId,
        status: 'running',
        processedCount,
        totalCount,
      }) as unknown as TProgress,
    buildCompletedPayload: ({ jobId, totalCount, summary }) =>
      ({
        jobId,
        status: 'completed',
        processedCount: totalCount,
        totalCount,
        summary,
      }) as unknown as TProgress,
    buildFailedPayload: ({ jobId, processedCount, totalCount, error }) =>
      ({
        jobId,
        status: 'failed',
        processedCount,
        totalCount,
        error,
      }) as unknown as TProgress,
  };
}

interface CreateImportJobQueueParams<
  TJobData extends SentryTraceData,
  TSummary,
  TProgress extends SSEEventPayload,
> extends Partial<ImportPayloadBuilders<TSummary, TProgress>> {
  /** Stable queue base name (e.g. `csv-import`). Namespaced by Jest worker id
   *  in tests so parallel runs don't cross-fire jobs into each other's workers. */
  baseName: string;
  /** SSE event name the frontend listens on for this importer's progress. */
  sseEventType: SSEEventType;
  /** Human label used in log lines (e.g. `CSV Import`). */
  logLabel: string;
  /** Importer body: parse + write rows, ticking `onProgress` per committed row.
   *  Resolves to the summary the worker stores as the job result. */
  processJob: (params: { job: Job<TJobData>; onProgress: ImportProgressCallback }) => Promise<TSummary>;
  /** i18n key of the error shown when a server restart kills the job mid-run.
   *  The default tells the user to undo the partial import before retrying, so a
   *  job that rolls back as a whole must pass its own key. */
  interruptedMessageKey?: string;
}

interface ImportJobQueueBundle<TJobData extends SentryTraceData, TSummary, TProgress extends SSEEventPayload> {
  queue: Queue<TJobData, ImportJobResult<TSummary>>;
  worker: Worker<TJobData, ImportJobResult<TSummary>>;
  /** Resolved queue name (test-namespaced). Reused by the enqueue span. */
  queueName: string;
  /** Push a progress payload to the job owner over SSE. */
  sendProgress: (params: { userId: number; payload: TProgress }) => void;
  /** Pull the throttled `{processedCount, totalCount}` blob the worker persists
   *  via `job.updateProgress`. Zeros when nothing has been recorded yet. */
  readJobProgress: (job: Job<TJobData>) => { processedCount: number; totalCount: number };
  /** Enqueue a job and emit the initial `queued` SSE event. The `queued` payload
   *  is built from the factory's `queued`-shape default. */
  enqueue: (params: { userId: number; jobId: string; data: TJobData }) => Promise<void>;
  /** Fallback polling path: build the current `TProgress` for a job, scoped to its
   *  owner. Returns `null` when the job is missing or belongs to another user. */
  getImportProgress: (params: { userId: number; jobId: string }) => Promise<TProgress | null>;
  /** Map BullMQ's stalled-job `failedReason` to the translated interrupted
   *  message. Any other reason, an empty one included, passes through unchanged. */
  describeFailure: <TReason extends string | undefined>(params: { reason: TReason }) => TReason | string;
}

/** ioredis raises a bare `new Error('Connection is closed.')` (no `code`) when a
 *  command runs against a connection that is shutting down — chiefly during test
 *  teardown and CI idle disconnects, not real failures. ioredis itself detects
 *  this state by strict-equality on this exact message, so the queues mirror that
 *  to suppress only the idle-disconnect noise; any error whose message merely
 *  contains the phrase (e.g. a wrapped application error) still surfaces. The
 *  constant is duplicated here because ioredis does not re-export it from the
 *  package root. */
const CONNECTION_CLOSED_ERROR_MSG = 'Connection is closed.';

function isConnectionClosedError(err: Error): boolean {
  return err.message === CONNECTION_CLOSED_ERROR_MSG;
}

/** Dynamic progress throttling: emit SSE at most every 25 rows so we don't swamp
 *  the channel on large imports. The final `completed` event always carries the
 *  true `processedCount` and summary. */
const PROGRESS_SSE_THROTTLE = 25;

/** Pull the throttled `{processedCount, totalCount}` blob the worker persists via
 *  `job.updateProgress`. Zeros when nothing has been recorded yet (e.g. the job
 *  died before the first tick). */
function readJobProgress(job: Job): { processedCount: number; totalCount: number } {
  const progress = (job.progress ?? {}) as { processedCount?: number; totalCount?: number };
  return {
    processedCount: progress.processedCount ?? 0,
    totalCount: progress.totalCount ?? 0,
  };
}

export function createImportJobQueue<
  TJobData extends SentryTraceData & { userId: number },
  TSummary,
  TProgress extends SSEEventPayload,
>({
  baseName,
  sseEventType,
  logLabel,
  processJob,
  interruptedMessageKey = 'importExport.importInterruptedByServerUpdate',
  buildRunningPayload: providedBuildRunningPayload,
  buildCompletedPayload: providedBuildCompletedPayload,
  buildFailedPayload: providedBuildFailedPayload,
}: CreateImportJobQueueParams<TJobData, TSummary, TProgress>): ImportJobQueueBundle<TJobData, TSummary, TProgress> {
  // Fall back to the standard payload shape for any builder the importer didn't
  // override. Every shipping importer uses the conventional shape and overrides
  // none, so these defaults drive the SSE payloads emitted below.
  const defaultBuilders = makeDefaultImportPayloadBuilders<TSummary, TProgress>();
  const buildRunningPayload = providedBuildRunningPayload ?? defaultBuilders.buildRunningPayload;
  const buildCompletedPayload = providedBuildCompletedPayload ?? defaultBuilders.buildCompletedPayload;
  const buildFailedPayload = providedBuildFailedPayload ?? defaultBuilders.buildFailedPayload;

  const connection = {
    host: process.env.APPLICATION_REDIS_HOST,
    maxRetriesPerRequest: null,
    connectTimeout: 20000,
    keepAlive: 10000,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
  };

  // BullMQ queue name. Namespaced by Jest worker id so parallel test runs don't
  // cross-fire jobs into each other's workers.
  const queueName =
    process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
      ? `${baseName}-${process.env.JEST_WORKER_ID}`
      : baseName;

  const queue = new Queue<TJobData, ImportJobResult<TSummary>>(queueName, {
    connection,
    defaultJobOptions: {
      attempts: 1, // Single-shot user-triggered import; do not auto-retry partial commits.
      removeOnComplete: { age: 24 * 3600 }, // Keep for a day so /status can still fetch.
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  queue.on('error', (err) => {
    if (!isConnectionClosedError(err)) {
      logger.error({ message: `[${logLabel} Queue] Queue error`, error: err });
    }
  });

  function sendProgress({ userId, payload }: { userId: number; payload: TProgress }) {
    sseManager.sendToUser({ userId, event: sseEventType, data: payload });
  }

  const worker = new Worker<TJobData, ImportJobResult<TSummary>>(
    queueName,
    async (job: Job<TJobData>) => {
      return withQueueProcessSpan({
        queueName,
        job,
        fn: async () => {
          const { userId } = job.data;

          // A base-currency recalculation holds this user's lock: it drains
          // in-flight writers before snapshotting rows, so an import committing
          // transactions now would land amounts against the wrong base. Fail the
          // job (attempts: 1, no retry) with a message the import UI surfaces. The
          // enqueue route is already lock-guarded; this only catches jobs queued
          // in the brief window before the lock landed.
          if (await isBaseCurrencyChangeLocked({ userId })) {
            throw new Error(t({ key: 'currencies.baseCurrencyChangeInProgress' }));
          }

          sendProgress({
            userId,
            payload: buildRunningPayload({ jobId: job.id!, processedCount: 0, totalCount: 0 }),
          });

          let lastEmittedAt = 0;
          let lastTotal = 0;
          const summary = await runWithBalanceRevalueBatch(() =>
            processJob({
              job,
              onProgress: async (processedCount, totalCount) => {
                lastTotal = totalCount;
                // Progress reporting is best-effort: a committed row must not be
                // failed and the job must not abort because persisting progress or
                // pushing the SSE update threw (Redis hiccup, dropped SSE channel).
                // Swallow and log so the import keeps writing rows.
                try {
                  // Persist progress on the job itself so /status polling works even
                  // with no SSE listener (e.g. user closed the tab).
                  await job.updateProgress({ processedCount, totalCount });
                  if (processedCount - lastEmittedAt >= PROGRESS_SSE_THROTTLE || processedCount === totalCount) {
                    lastEmittedAt = processedCount;
                    sendProgress({
                      userId,
                      payload: buildRunningPayload({ jobId: job.id!, processedCount, totalCount }),
                    });
                  }
                } catch (err) {
                  logger.error({
                    message: `[${logLabel} Worker] Progress update failed for job ${job.id}`,
                    error: err instanceof Error ? err : new Error(String(err)),
                  });
                }
              },
            }),
          );

          return { summary, totalCount: lastTotal };
        },
      });
    },
    {
      connection,
      concurrency: 2,
      // Stall recovery is not governed by `attempts`, and re-running a job that
      // wrote rows would replay the whole payload: nothing deduplicates them.
      maxStalledCount: 0,
    },
  );

  worker.on('completed', (job, result) => {
    sendProgress({
      userId: job.data.userId,
      payload: buildCompletedPayload({ jobId: job.id!, totalCount: result.totalCount, summary: result.summary }),
    });
  });

  const describeFailure = <TReason extends string | undefined>({ reason }: { reason: TReason }): TReason | string =>
    isStalledPastLimitFailure({ reason }) ? t({ key: interruptedMessageKey }) : reason;

  worker.on('failed', (job, err) => {
    // Every deploy that restarts the process mid-job ends here, so it is not an error.
    if (isStalledPastLimitFailure({ reason: err.message })) {
      logger.warn(`[${logLabel} Worker] Job failed as stalled: its worker died or lost the job lock`, {
        jobId: job?.id,
        userId: job?.data.userId,
      });
      // The killed importer never set finishedAt, and undo refuses unfinished batches.
      // ponytail: assumes one worker process; with several, scope this to the job's own batch.
      if (job) {
        ImportBatches.update(
          { finishedAt: new Date() },
          { where: { userId: job.data.userId, finishedAt: null } },
        ).catch((error) =>
          logger.error({ message: `[${logLabel} Worker] Failed to finish interrupted import batches`, error }),
        );
      }
    } else {
      logger.error({ message: `[${logLabel} Worker] Job ${job?.id} failed`, error: err });
    }
    if (!job) return;
    // Report the partial progress reached before the crash so the user can see
    // how many rows actually landed instead of a misleading "0 / 0 failed".
    const { processedCount, totalCount } = readJobProgress(job);
    sendProgress({
      userId: job.data.userId,
      payload: buildFailedPayload({
        jobId: job.id!,
        processedCount,
        totalCount,
        error: describeFailure({ reason: err.message }),
      }),
    });
  });

  worker.on('error', (err) => {
    if (!isConnectionClosedError(err)) {
      logger.error({ message: `[${logLabel} Worker] Worker error`, error: err });
    }
  });

  async function enqueue({ userId, jobId, data }: { userId: number; jobId: string; data: TJobData }): Promise<void> {
    await withQueuePublishSpan({
      queueName,
      messageId: jobId,
      payloadSize: JSON.stringify(data).length,
      fn: async (traceData) => {
        // Add through a concrete-data view of the queue: with a generic
        // `TJobData`, BullMQ's `ExtractNameType` conditional stays unresolved and
        // the job-name argument (always a string here) won't type-check. Viewing
        // the data as the concrete `SentryTraceData` constraint resolves the name
        // type to `string`; the spread payload satisfies it structurally.
        const namedQueue = queue as unknown as Queue<SentryTraceData, ImportJobResult<TSummary>>;
        await namedQueue.add(jobId, { ...data, ...traceData }, { jobId });
      },
    });

    // The `queued` payload carries the same counters as `running` and lives in
    // the same `queued | running` union member, so build it from the running
    // default and flip the discriminant — the same technique the
    // waiting/delayed branch of `getImportProgress` uses below.
    const queuedPayload = {
      ...buildRunningPayload({ jobId, processedCount: 0, totalCount: 0 }),
      status: 'queued',
    } as TProgress;
    // The job is already committed to the queue, so a failed initial notification
    // must not surface as an enqueue failure — callers roll back their tracking
    // pointer on throw, which would orphan the committed job.
    try {
      sendProgress({ userId, payload: queuedPayload });
    } catch (err) {
      logger.warn(`[${logLabel}] Initial queued SSE emit failed for job ${jobId}`, {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  async function getImportProgress({ userId, jobId }: { userId: number; jobId: string }): Promise<TProgress | null> {
    const job = await queue.getJob(jobId);
    if (!job) return null;
    if (job.data.userId !== userId) return null;

    const state = await job.getState();
    const { processedCount, totalCount } = readJobProgress(job);

    if (state === 'completed') {
      const result = job.returnvalue;
      if (!result?.summary) {
        // BullMQ marked the job completed but the returnvalue blob has not
        // surfaced yet (rare write-vs-read race right after the handler resolves).
        // Treat as still-running so the next poll picks up the real result.
        return buildRunningPayload({ jobId, processedCount, totalCount });
      }
      return buildCompletedPayload({ jobId, totalCount: result.totalCount, summary: result.summary });
    }
    if (state === 'failed') {
      // `getJob` (top of this fn) snapshots the job hash — including `failedReason`
      // — before `getState` re-queries the job's set; a job that flips active →
      // failed in that window reports `state === 'failed'` while the snapshot's
      // `failedReason` is still empty. Re-fetch once so that transient miss
      // surfaces the real error. A genuinely empty reason (a non-Error throw, which
      // BullMQ never persists) must still settle terminally with a generic message:
      // the failed branch must never report `running`, which would leave a
      // poll-only client (SSE down) spinning forever with no terminal state.
      const settled = (await queue.getJob(jobId)) ?? job;
      return buildFailedPayload({
        jobId,
        processedCount,
        totalCount,
        error: describeFailure({ reason: settled.failedReason || 'Unknown error' }),
      });
    }
    if (state === 'waiting' || state === 'delayed') {
      // Not yet picked up by a worker: surface as `queued`. The running payload
      // carries the same counters and lives in the same `queued | running` union
      // member, so flip its discriminant. The cast bridges the generic
      // `TProgress` (which can't prove the narrowing) back to the bundle's
      // declared return type, the same technique the enqueue span uses above.
      return { ...buildRunningPayload({ jobId, processedCount, totalCount }), status: 'queued' } as TProgress;
    }
    return buildRunningPayload({ jobId, processedCount, totalCount });
  }

  return { queue, worker, queueName, sendProgress, readJobProgress, enqueue, getImportProgress, describeFailure };
}
