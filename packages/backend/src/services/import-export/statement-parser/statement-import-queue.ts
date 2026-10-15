import {
  type ExtractedTransaction,
  SSE_EVENT_TYPES,
  type StatementImportProgress,
  type StatementImportSummary,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, ValidationError } from '@js/errors';
import { SentryTraceData } from '@js/utils/sentry';
import * as Accounts from '@models/accounts.model';
import { redisClient } from '@root/redis-client';
import { createImportJobQueue } from '@services/import-export/core/queue/create-import-job-queue';
import { randomUUID } from 'node:crypto';

import { executeImport } from './execute-import.service';

interface StatementImportJobData extends SentryTraceData {
  userId: number;
  accountId: string;
  transactions: ExtractedTransaction[];
  skipIndices: number[];
  timezone?: string;
}

const {
  queue: statementImportQueue,
  worker: statementImportWorker,
  enqueue,
  getImportProgress,
} = createImportJobQueue<StatementImportJobData, StatementImportSummary, StatementImportProgress>({
  baseName: 'statement-import',
  sseEventType: SSE_EVENT_TYPES.STATEMENT_IMPORT_PROGRESS,
  logLabel: 'Statement Import',
  processJob: async ({ job, onProgress }) => {
    const { userId, accountId, transactions, skipIndices, timezone } = job.data;
    return executeImport({ userId, accountId, transactions, skipIndices, timezone, onProgress });
  },
});

export { statementImportQueue, statementImportWorker };

/** Per-user pointer to the latest statement import, so a second execute request
 *  can be refused while one is still in flight. */
const buildLastJobPointerKey = ({ userId }: { userId: number }): string => `statement-import-last-job-${userId}`;

export async function queueStatementImport({
  userId,
  accountId,
  transactions,
  skipIndices,
  timezone,
}: {
  userId: number;
  accountId: string;
  transactions: ExtractedTransaction[];
  skipIndices: number[];
  timezone?: string;
}): Promise<string> {
  // Nothing deduplicates rows server-side, so a second submit of the same
  // payload (a retry after a timed-out response) would double every row.
  // ponytail: check-then-set, not atomic. Use SET NX on the pointer if two
  // submits within the same few ms ever show up.
  const lastJobId = await redisClient.get(buildLastJobPointerKey({ userId }));
  if (lastJobId) {
    const progress = await getImportProgress({ userId, jobId: lastJobId });
    if (progress?.status === 'queued' || progress?.status === 'running') {
      // The in-flight job id lets the client follow that job instead of dead-ending.
      throw new ConflictError({
        message: t({ key: 'importExport.statementImportInProgress' }),
        details: { jobId: lastJobId },
      });
    }
  }

  // Checked before enqueue so a wrong account id answers 4xx instead of a job
  // the user has to wait on only to see it fail.
  const account = await Accounts.getAccountById({ userId, id: accountId });
  if (!account) {
    throw new ValidationError({ message: t({ key: 'accounts.accountNotFound' }) });
  }

  const jobId = `statement-import-${userId}-${randomUUID()}`;
  await redisClient.set(buildLastJobPointerKey({ userId }), jobId, 'EX', 24 * 3600);
  await enqueue({ userId, jobId, data: { userId, accountId, transactions, skipIndices, timezone } });

  return jobId;
}

/** Fallback polling path: returns the current state of a job for a given user. */
export async function getStatementImportProgress({
  userId,
  jobId,
}: {
  userId: number;
  jobId: string;
}): Promise<StatementImportProgress | null> {
  return getImportProgress({ userId, jobId });
}
