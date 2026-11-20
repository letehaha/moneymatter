import {
  type AccountMappingConfig,
  AccountOptionValue,
  type CategoryMappingConfig,
  CategoryOptionValue,
  type ColumnMappingConfig,
  type CsvImportProgress,
  type CsvImportSummary,
  SSE_EVENT_TYPES,
  type TagMappingConfig,
} from '@bt/shared/types';
import { SentryTraceData } from '@js/utils/sentry';
import { createImportJobQueue } from '@services/import-export/core/queue/create-import-job-queue';
import { randomUUID } from 'node:crypto';

import { executeImport } from './execute-import';
import { parseValidRows } from './parse-valid-rows';

interface CsvImportJobData extends SentryTraceData {
  userId: number;
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  skipDuplicateIndices: number[];
  skipUnpriceableIndices?: number[];
  defaultAccountId?: string;
  defaultCategoryId?: string;
  /** IANA timezone forwarded to `parseValidRows` so the worker anchors dates to
   *  the same instants the interactive preview computed. */
  timezone?: string;
  /** When true, rows dated on/after a linked account's pre-import boundary move
   *  its current balance; when false/absent the pre-import balance is preserved. */
  recalculateBalance?: boolean;
  skippedAfterBankSeam?: number;
}

const {
  queue: csvImportQueue,
  worker: csvImportWorker,
  enqueue,
  getImportProgress,
} = createImportJobQueue<CsvImportJobData, CsvImportSummary, CsvImportProgress>({
  baseName: 'csv-import',
  sseEventType: SSE_EVENT_TYPES.CSV_IMPORT_PROGRESS,
  logLabel: 'CSV Import',
  processJob: async ({ job, onProgress }) => {
    const {
      userId,
      fileContent,
      delimiter,
      columnMapping,
      accountMapping,
      categoryMapping,
      tagMapping,
      skipDuplicateIndices,
      skipUnpriceableIndices,
      defaultAccountId,
      defaultCategoryId,
      timezone,
      recalculateBalance,
      skippedAfterBankSeam,
    } = job.data;

    // Re-parse server-side rather than shipping `validRows` through Redis.
    // `parseValidRows` is deterministic, so the skip indices the user picked
    // against the preview stay valid against this fresh parse.
    const { validRows } = await parseValidRows({ userId, fileContent, delimiter, columnMapping, timezone });

    // `columnMapping` is the authoritative source for the "single existing
    // account/category" choice: that option carries the id directly, and the
    // executor consumes it as the fallback for rows whose account name is empty
    // or whose category is absent. Derive it here so the client only has to send
    // the column mapping; the explicit fields stay as a fallback for the other
    // options.
    const resolvedDefaultAccountId =
      columnMapping.account.option === AccountOptionValue.existingAccount
        ? columnMapping.account.accountId
        : defaultAccountId;
    const resolvedDefaultCategoryId =
      columnMapping.category.option === CategoryOptionValue.existingCategory
        ? columnMapping.category.categoryId
        : defaultCategoryId;

    return executeImport({
      userId,
      validRows,
      accountMapping,
      categoryMapping,
      tagMapping,
      skipDuplicateIndices,
      skipUnpriceableIndices,
      defaultAccountId: resolvedDefaultAccountId,
      defaultCategoryId: resolvedDefaultCategoryId,
      recalculateBalance,
      reviewSkippedAfterBankSeam: skippedAfterBankSeam,
      onProgress,
    });
  },
});

export { csvImportQueue, csvImportWorker };

/** Public entry point — controller calls this to enqueue an import. */
export async function queueCsvImport({
  userId,
  fileContent,
  delimiter,
  columnMapping,
  accountMapping,
  categoryMapping,
  tagMapping,
  skipDuplicateIndices,
  skipUnpriceableIndices,
  defaultAccountId,
  defaultCategoryId,
  timezone,
  recalculateBalance,
  skippedAfterBankSeam,
}: {
  userId: number;
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  skipDuplicateIndices: number[];
  skipUnpriceableIndices?: number[];
  defaultAccountId?: string;
  defaultCategoryId?: string;
  timezone?: string;
  recalculateBalance?: boolean;
  skippedAfterBankSeam?: number;
}): Promise<string> {
  // Random suffix (not a timestamp): two imports the same user fires within the
  // same millisecond would otherwise collide on one id, and BullMQ silently drops
  // the second `add` for a duplicate jobId — losing the second import with no error.
  const jobId = `csv-import-${userId}-${randomUUID()}`;
  const data: CsvImportJobData = {
    userId,
    fileContent,
    delimiter,
    columnMapping,
    accountMapping,
    categoryMapping,
    tagMapping,
    skipDuplicateIndices,
    skipUnpriceableIndices,
    defaultAccountId,
    defaultCategoryId,
    timezone,
    recalculateBalance,
    skippedAfterBankSeam,
  };

  await enqueue({ userId, jobId, data });

  return jobId;
}

/** Fallback polling path: returns the current state of a job for a given user. */
export async function getCsvImportProgress({
  userId,
  jobId,
}: {
  userId: number;
  jobId: string;
}): Promise<CsvImportProgress | null> {
  return getImportProgress({ userId, jobId });
}
