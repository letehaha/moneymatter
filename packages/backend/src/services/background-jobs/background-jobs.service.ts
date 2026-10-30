import { CustomResponse } from '@common/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { redisClient } from '@root/redis-client';
import { randomUUID } from 'crypto';

type StoredJob = { state: 'pending' } | { state: 'done'; statusCode: number; body: unknown };

/** A pending entry outlives its heartbeat only briefly, so a job killed by a restart reads as gone within a minute. */
const PENDING_TTL_SECONDS = 60;
const HEARTBEAT_MS = 20_000;
const RESULT_TTL_SECONDS = 60 * 60;

const jobKey = ({ userId, jobId }: { userId: number; jobId: string }) => `background-job:${userId}:${jobId}`;

/**
 * Runs `run` detached from the request and stores the response it writes, so a long AI call
 * is not cut off by browser or proxy timeouts. The client polls `getBackgroundJob`.
 *
 * An identical request (same `fingerprint`) while a job is still running gets that job's id,
 * so a page refresh followed by a retry attaches to the running job instead of paying twice.
 *
 * ponytail: in-process, so a restart mid-run loses the job (the poll then 404s and the user
 * retries). Move to BullMQ if jobs start writing data or restarts mid-run become common.
 */
export async function startBackgroundJob({
  userId,
  fingerprint,
  run,
}: {
  userId: number;
  fingerprint: string;
  run: (res: CustomResponse) => Promise<unknown>;
}): Promise<string> {
  const jobId = randomUUID();
  const key = jobKey({ userId, jobId });
  const activeKey = `background-job-active:${userId}:${fingerprint}`;
  const pending = JSON.stringify({ state: 'pending' } satisfies StoredJob);
  const logStoreFailure = (error: unknown) =>
    logger.error({ message: '[Background jobs] Failed to store job state', error: error as Error }, { userId, jobId });

  // Job key first, so an id handed out through `activeKey` always resolves when polled.
  await redisClient.setex(key, PENDING_TTL_SECONDS, pending);
  if (!(await redisClient.set(activeKey, jobId, 'EX', PENDING_TTL_SECONDS, 'NX'))) {
    const [runningJobId] = await Promise.all([redisClient.get(activeKey), redisClient.del(key)]);
    return runningJobId ?? startBackgroundJob({ userId, fingerprint, run });
  }

  const heartbeat = setInterval(() => {
    redisClient
      .multi()
      .setex(key, PENDING_TTL_SECONDS, pending)
      .expire(activeKey, PENDING_TTL_SECONDS)
      .exec()
      .catch(logStoreFailure);
  }, HEARTBEAT_MS);

  const captured = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      // Serialize here, so an unserializable result throws inside the handler's error handling.
      this.body = JSON.parse(JSON.stringify(body));
      this.headersSent = true;
      return this;
    },
  };

  void run(captured as unknown as CustomResponse)
    .finally(() => {
      clearInterval(heartbeat);
      const done: StoredJob = { state: 'done', statusCode: captured.statusCode, body: captured.body };
      return redisClient.multi().setex(key, RESULT_TTL_SECONDS, JSON.stringify(done)).del(activeKey).exec();
    })
    .catch(logStoreFailure);

  return jobId;
}

export async function getBackgroundJob({ userId, jobId }: { userId: number; jobId: string }): Promise<StoredJob> {
  // Read without CacheClient so a Redis outage surfaces as an error, not as a lost job.
  const raw = await redisClient.get(jobKey({ userId, jobId }));
  if (!raw) throw new NotFoundError({ message: t({ key: 'backgroundJobs.notFound' }) });
  return JSON.parse(raw) as StoredJob;
}
