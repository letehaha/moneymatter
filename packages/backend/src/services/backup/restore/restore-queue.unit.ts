import { API_ERROR_CODES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LockedError } from '@js/errors';

// ── Mocks (inline jest.fn() so the hoisted factories never reach out-of-scope
//    vars; concrete mock refs are pulled back out with jest.mocked below) ──────

// Importing the module under test constructs a BullMQ queue + worker through this
// factory. Stub it so no real Redis connection / Worker is opened; the returned
// `queue` and `enqueue` are the seams these tests drive.
jest.mock('@services/import-export/core/queue/create-import-job-queue', () => ({
  __esModule: true,
  createImportJobQueue: jest.fn(() => ({
    queue: { getJob: jest.fn(), getJobs: jest.fn() },
    worker: {},
    enqueue: jest.fn(),
  })),
}));

// `@root/redis-client` opens a real ioredis connection at import; stub the
// key/value ops the module uses for the per-user last-restore pointer.
jest.mock('@root/redis-client', () => ({
  __esModule: true,
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
  REDIS_KEY_PREFIX: undefined,
}));

// Stub to keep the import graph off the DB / base-currency-lock machinery.
jest.mock('./restore-backup.service', () => ({ __esModule: true, restoreUserBackup: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({
  __esModule: true,
  acquireBaseCurrencyLock: jest.fn(),
  extendBaseCurrencyLockTtlIfOwned: jest.fn(),
  releaseBaseCurrencyLockIfOwned: jest.fn(),
}));
jest.mock('@i18n/index', () => ({ __esModule: true, t: jest.fn(() => 'translated') }));

/* eslint-disable import/first */
import { t } from '@i18n/index';
import { redisClient } from '@root/redis-client';
import { acquireBaseCurrencyLock, releaseBaseCurrencyLockIfOwned } from '@services/currencies/base-currency-lock';
import { createImportJobQueue } from '@services/import-export/core/queue/create-import-job-queue';

import { restoreUserBackup } from './restore-backup.service';
import { getBackupRestoreStatus, queueBackupRestore } from './restore-queue';
/* eslint-enable import/first */

type AsyncMock = jest.Mock<(...args: never[]) => Promise<unknown>>;

// What the module under test passed to and received from the (mocked) factory at
// load time. Captured once here (not per-test) so `resetAllMocks`, which wipes
// `mock.calls` and `mock.results`, can't strand the references.
const factoryParams = jest.mocked(createImportJobQueue).mock.calls[0]![0] as unknown as {
  interruptedMessageKey: string;
  processJob: (params: { job: { id: string; data: { userId: number; fileContent: string } } }) => Promise<unknown>;
};
const factoryBundle = jest.mocked(createImportJobQueue).mock.results[0]!.value as unknown as {
  queue: { getJob: AsyncMock; getJobs: AsyncMock };
  enqueue: AsyncMock;
};
const getJobMock = factoryBundle.queue.getJob;
const getJobsMock = factoryBundle.queue.getJobs;
const enqueueMock = factoryBundle.enqueue;
const redisSetMock = jest.mocked(redisClient.set) as unknown as AsyncMock;
const acquireLockMock = jest.mocked(acquireBaseCurrencyLock);
const releaseLockMock = jest.mocked(releaseBaseCurrencyLockIfOwned);
const restoreUserBackupMock = jest.mocked(restoreUserBackup) as unknown as AsyncMock;

const USER_ID = 42;
const FILE_CONTENT = 'base64-encoded-backup-zip';
const STALLED_REASON = 'job stalled more than allowable limit';

const buildJob = ({ state, failedReason }: { state: string; failedReason?: string }) => ({
  data: { userId: USER_ID },
  progress: undefined,
  failedReason,
  getState: async () => state,
});

beforeEach(() => {
  jest.resetAllMocks();
  redisSetMock.mockResolvedValue('OK');
  enqueueMock.mockResolvedValue(undefined);
  releaseLockMock.mockResolvedValue(undefined);
});

describe('queueBackupRestore concurrent-restore enqueue guard', () => {
  it('throws LockedError and never enqueues when a restore is already in flight for the user', async () => {
    // An active/waiting/delayed job owned by the same user is already queued.
    getJobsMock.mockResolvedValue([{ data: { userId: USER_ID } }]);

    const promise = queueBackupRestore({ userId: USER_ID, fileContent: FILE_CONTENT });

    await expect(promise).rejects.toBeInstanceOf(LockedError);
    await expect(promise).rejects.toMatchObject({ code: API_ERROR_CODES.locked });

    // The guard fires before any pointer write or enqueue.
    expect(redisSetMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    // The in-flight lookup checks exactly the pre-pickup states.
    expect(getJobsMock).toHaveBeenCalledWith(['active', 'waiting', 'delayed']);
  });

  it('enqueues (writing the pointer and returning the job id) when no restore is in flight', async () => {
    getJobsMock.mockResolvedValue([]);

    const jobId = await queueBackupRestore({ userId: USER_ID, fileContent: FILE_CONTENT });

    // Job id is namespaced by the user and carries a random suffix.
    expect(jobId).toMatch(new RegExp(`^backup-restore-${USER_ID}-`));

    // Pointer is written (24h TTL) before the enqueue so a reloaded tab can resolve it.
    expect(redisSetMock).toHaveBeenCalledWith(`backup-restore-last-job-${USER_ID}`, jobId, 'EX', 24 * 3600);

    // The job is actually enqueued with the file content re-shipped in its data.
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith({
      userId: USER_ID,
      jobId,
      data: { userId: USER_ID, fileContent: FILE_CONTENT },
    });
  });

  it("ignores another user's in-flight restore and enqueues normally", async () => {
    // A different user's job must not block this user's restore.
    getJobsMock.mockResolvedValue([{ data: { userId: USER_ID + 1 } }]);

    const jobId = await queueBackupRestore({ userId: USER_ID, fileContent: FILE_CONTENT });

    expect(jobId).toMatch(new RegExp(`^backup-restore-${USER_ID}-`));
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });
});

describe('getBackupRestoreStatus', () => {
  it('reports a stalled job with the translated interrupted message and releases its orphaned lock', async () => {
    const jobId = `backup-restore-${USER_ID}-stalled`;
    getJobMock.mockResolvedValue(buildJob({ state: 'failed', failedReason: STALLED_REASON }));
    jest.mocked(t).mockReturnValue('interrupted message');

    const status = await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(t).toHaveBeenCalledWith({ key: 'common.jobInterruptedByServerUpdate' });
    expect(status).toEqual({ jobId, status: 'failed', progress: undefined, error: 'interrupted message' });
    expect(releaseLockMock).toHaveBeenCalledWith({ userId: USER_ID, jobId });
  });

  it('reports any other failure with a translated generic message and the raw reason as detail', async () => {
    const jobId = `backup-restore-${USER_ID}-crashed`;
    const failedReason = 'Backup restore failed: SequelizeUniqueConstraintError: Validation error';
    getJobMock.mockResolvedValue(buildJob({ state: 'failed', failedReason }));
    jest.mocked(t).mockReturnValue('generic failure');

    const status = await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(t).toHaveBeenCalledWith({ key: 'backup.restore.errors.failed' });
    expect(status).toEqual({
      jobId,
      status: 'failed',
      progress: undefined,
      error: 'generic failure',
      errorDetail: failedReason,
    });
  });

  it('omits the detail when BullMQ recorded no failure reason', async () => {
    const jobId = `backup-restore-${USER_ID}-empty`;
    getJobMock.mockResolvedValue(buildJob({ state: 'failed', failedReason: '' }));
    jest.mocked(t).mockReturnValue('generic failure');

    const status = await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(status).toMatchObject({ status: 'failed', error: 'generic failure', errorDetail: undefined });
  });

  it('builds its queue with the interrupted message of a job that rolls back as a whole', () => {
    expect(factoryParams.interruptedMessageKey).toBe('common.jobInterruptedByServerUpdate');
  });

  it('reports an active job as processing and keeps its lock', async () => {
    const jobId = `backup-restore-${USER_ID}-active`;
    getJobMock.mockResolvedValue(buildJob({ state: 'active' }));

    const status = await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(status).toEqual({ jobId, status: 'processing', progress: undefined });
    expect(releaseLockMock).not.toHaveBeenCalled();
  });

  it('keeps the lock of a failed job while its processor still runs in this process', async () => {
    const jobId = `backup-restore-${USER_ID}-live`;
    getJobMock.mockResolvedValue(buildJob({ state: 'failed', failedReason: STALLED_REASON }));
    acquireLockMock.mockResolvedValue(true);
    let finishRestore!: () => void;
    restoreUserBackupMock.mockReturnValue(
      new Promise((resolve) => {
        finishRestore = () => resolve(undefined);
      }),
    );

    const processing = factoryParams.processJob({
      job: { id: jobId, data: { userId: USER_ID, fileContent: FILE_CONTENT } },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const status = await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(status?.status).toBe('failed');
    expect(releaseLockMock).not.toHaveBeenCalled();

    finishRestore();
    await processing;
    releaseLockMock.mockClear();
    await getBackupRestoreStatus({ userId: USER_ID, jobId });

    expect(releaseLockMock).toHaveBeenCalledWith({ userId: USER_ID, jobId });
  });
});
