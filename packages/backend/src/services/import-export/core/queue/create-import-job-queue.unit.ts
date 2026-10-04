import { type ImportBatchDeleteProgress, SSE_EVENT_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils/logger';
import type { SentryTraceData } from '@js/utils/sentry';
import { sseManager } from '@services/common/sse';

import { createImportJobQueue } from './create-import-job-queue';

jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ on: jest.fn(), getJob: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));
jest.mock('@js/utils/logger', () => ({ __esModule: true, logger: { error: jest.fn(), warn: jest.fn() } }));
jest.mock('@i18n/index', () => ({ __esModule: true, t: ({ key }: { key: string }) => key }));
jest.mock('@services/common/sse', () => ({ __esModule: true, sseManager: { sendToUser: jest.fn() } }));
jest.mock('@services/balances/revalue-balance-history.service', () => ({
  __esModule: true,
  runWithBalanceRevalueBatch: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({
  __esModule: true,
  isBaseCurrencyChangeLocked: jest.fn(),
}));
const batchUpdateMock = jest.fn<(values: unknown, options: unknown) => Promise<unknown>>();
jest.mock('@models/import-batches.model', () => ({
  __esModule: true,
  default: { update: (values: unknown, options: unknown) => batchUpdateMock(values, options) },
}));
jest.mock('@js/utils/sentry', () => ({
  __esModule: true,
  withQueueProcessSpan: jest.fn(),
  withQueuePublishSpan: jest.fn(),
}));

interface TestJobData extends SentryTraceData {
  userId: number;
}

const STALLED_REASON = 'job stalled more than allowable limit';
const DEFAULT_INTERRUPTED_KEY = 'importExport.importInterruptedByServerUpdate';
const USER_ID = 42;
const JOB_ID = 'job-1';

const buildBundle = ({ interruptedMessageKey }: { interruptedMessageKey?: string } = {}) =>
  createImportJobQueue<TestJobData, { deletedCount: number }, ImportBatchDeleteProgress>({
    baseName: 'unit-test-import',
    sseEventType: SSE_EVENT_TYPES.IMPORT_BATCH_DELETE_PROGRESS,
    logLabel: 'Unit Test',
    interruptedMessageKey,
    processJob: async () => ({ deletedCount: 0 }),
  });

const failJob = ({ bundle, error }: { bundle: ReturnType<typeof buildBundle>; error: Error }) => {
  const onMock = bundle.worker.on as unknown as jest.Mock;
  const handler = onMock.mock.calls.find(([event]) => event === 'failed')![1] as (job: unknown, err: Error) => void;
  handler({ id: JOB_ID, data: { userId: USER_ID } }, error);
};

const expectFailedPayload = ({ error }: { error: string }) =>
  expect(sseManager.sendToUser).toHaveBeenCalledWith({
    userId: USER_ID,
    event: SSE_EVENT_TYPES.IMPORT_BATCH_DELETE_PROGRESS,
    data: { jobId: JOB_ID, status: 'failed', processedCount: 0, totalCount: 0, error },
  });

beforeEach(() => {
  jest.clearAllMocks();
  batchUpdateMock.mockResolvedValue([0]);
});

describe('createImportJobQueue failure reporting', () => {
  it('warns and sends the default interrupted message for a stalled job', () => {
    failJob({ bundle: buildBundle(), error: new Error(STALLED_REASON) });

    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { jobId: JOB_ID, userId: USER_ID });
    expect(logger.error).not.toHaveBeenCalled();
    expectFailedPayload({ error: DEFAULT_INTERRUPTED_KEY });
  });

  it("finishes the user's unfinished import batches when a job fails as stalled, so undo is allowed", () => {
    failJob({ bundle: buildBundle(), error: new Error(STALLED_REASON) });

    expect(batchUpdateMock).toHaveBeenCalledWith(
      { finishedAt: expect.any(Date) },
      { where: { userId: USER_ID, finishedAt: null } },
    );
  });

  it('leaves import batches alone on an ordinary failure', () => {
    failJob({ bundle: buildBundle(), error: new Error('boom') });

    expect(batchUpdateMock).not.toHaveBeenCalled();
  });

  it('sends the interrupted message of the key the queue was built with', () => {
    const interruptedMessageKey = 'common.jobInterruptedByServerUpdate';

    failJob({ bundle: buildBundle({ interruptedMessageKey }), error: new Error(STALLED_REASON) });

    expectFailedPayload({ error: interruptedMessageKey });
  });

  it('logs an ordinary failure as an error and sends its message', () => {
    failJob({ bundle: buildBundle(), error: new Error('boom') });

    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expectFailedPayload({ error: 'boom' });
  });

  it('reports a stalled job as interrupted on the status poll', async () => {
    const bundle = buildBundle();
    const getJobMock = bundle.queue.getJob as unknown as jest.Mock<() => Promise<unknown>>;
    getJobMock.mockResolvedValue({
      data: { userId: USER_ID },
      failedReason: STALLED_REASON,
      getState: async () => 'failed',
    });

    const progress = await bundle.getImportProgress({ userId: USER_ID, jobId: JOB_ID });

    expect(progress).toEqual({
      jobId: JOB_ID,
      status: 'failed',
      processedCount: 0,
      totalCount: 0,
      error: DEFAULT_INTERRUPTED_KEY,
    });
  });
});
