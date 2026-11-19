import type { RecordId } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';

// ── Mocks (hoisted before importing the module under test) ──────────────────

// The module builds a queue + worker pair lazily per API token; the constructors
// are the only bullmq surface these tests reach.
jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), addBulk: jest.fn(), on: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  UnrecoverableError: class UnrecoverableError extends Error {},
}));
jest.mock('@services/accounts/absorb-link-residual', () => ({
  __esModule: true,
  runPendingLinkAbsorb: jest.fn(),
}));
jest.mock('@models/bank-data-provider-connections.model', () => ({
  __esModule: true,
  default: { update: jest.fn() },
}));
jest.mock('../sync/sync-status-tracker', () => ({
  __esModule: true,
  ...(jest.requireActual('../sync/sync-status-tracker') as object),
  setAccountSyncStatus: jest.fn(),
}));
jest.mock('@js/utils/logger', () => ({
  __esModule: true,
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

/* eslint-disable import/first */
import { logger } from '@js/utils/logger';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { redisClient } from '@root/redis-client';
import { runPendingLinkAbsorb } from '@services/accounts/absorb-link-residual';

import { SyncStatus, setAccountSyncStatus } from '../sync/sync-status-tracker';
import { handleCompletedBatch, queueTransactionSync, syncPriorityForAccount } from './transaction-sync-queue';
/* eslint-enable import/first */

const runPendingLinkAbsorbMock = jest.mocked(runPendingLinkAbsorb);
const setAccountSyncStatusMock = jest.mocked(setAccountSyncStatus);
const connectionsUpdateMock = jest.mocked(BankDataProviderConnections.update);
const loggerErrorMock = jest.mocked(logger.error);
const incrMock = jest.mocked(redisClient.incr);
const delMock = jest.mocked(redisClient.del);

const USER_ID = 42;
const CONNECTION_ID = 'connection-1';

const buildCompletedJob = (accountId: string): Job =>
  ({
    id: 'group-1-0',
    data: { totalBatches: 1, accountId, userId: USER_ID, connectionId: CONNECTION_ID },
  }) as unknown as Job;

/** An empty window (from >= to) is the only path that finalizes inline. */
const queueEmptyWindow = (accountId: RecordId) =>
  queueTransactionSync({
    userId: USER_ID,
    accountId,
    connectionId: CONNECTION_ID,
    externalAccountId: 'external-1',
    apiToken: 'token-1',
    from: new Date('2024-06-10T00:00:00.000Z'),
    to: new Date('2024-06-01T00:00:00.000Z'),
  });

beforeEach(() => {
  jest.clearAllMocks();
  incrMock.mockResolvedValue(1 as never);
  runPendingLinkAbsorbMock.mockResolvedValue({});
  setAccountSyncStatusMock.mockResolvedValue(undefined);
  connectionsUpdateMock.mockResolvedValue([1] as never);
});

describe('finalizeSyncGroup via handleCompletedBatch', () => {
  it('completes the sync and stamps the connection when the deferred absorb succeeds', async () => {
    const accountId = generateRandomRecordId();

    await handleCompletedBatch(buildCompletedJob(accountId));

    expect(runPendingLinkAbsorbMock).toHaveBeenCalledWith({ accountId, userId: USER_ID });
    expect(setAccountSyncStatusMock).toHaveBeenCalledWith({
      accountId,
      status: SyncStatus.COMPLETED,
      userId: USER_ID,
    });
    expect(connectionsUpdateMock).toHaveBeenCalledWith(
      { lastSyncAt: expect.any(Date) },
      { where: { id: CONNECTION_ID } },
    );
  });

  it('logs and marks the sync FAILED without stamping the connection when the deferred absorb throws', async () => {
    const accountId = generateRandomRecordId();
    runPendingLinkAbsorbMock.mockRejectedValue(new Error('absorb blew up'));

    await expect(handleCompletedBatch(buildCompletedJob(accountId))).resolves.toBeUndefined();

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.objectContaining({ accountId, userId: USER_ID }),
    );
    expect(setAccountSyncStatusMock).toHaveBeenCalledWith({
      accountId,
      status: SyncStatus.FAILED,
      error: 'absorb blew up',
      userId: USER_ID,
    });
    expect(connectionsUpdateMock).not.toHaveBeenCalled();
  });

  it('counts a batch skipped because the account left the connection and clears the group without finalizing', async () => {
    const accountId = generateRandomRecordId();
    const job = { ...buildCompletedJob(accountId), returnvalue: { success: false, skipped: true } } as unknown as Job;

    await handleCompletedBatch(job);

    expect(incrMock).toHaveBeenCalledWith('jobgroup:group-1:completions');
    expect(delMock).toHaveBeenCalledWith('jobgroup:group-1:completions');
    expect(runPendingLinkAbsorbMock).not.toHaveBeenCalled();
    expect(connectionsUpdateMock).not.toHaveBeenCalled();
  });

  it('leaves the group unfinalized until the last batch reports in', async () => {
    const accountId = generateRandomRecordId();
    const job = {
      id: 'group-2-0',
      data: { totalBatches: 3, accountId, userId: USER_ID, connectionId: CONNECTION_ID },
    } as unknown as Job;

    await handleCompletedBatch(job);

    expect(runPendingLinkAbsorbMock).not.toHaveBeenCalled();
    expect(setAccountSyncStatusMock).not.toHaveBeenCalled();
    expect(connectionsUpdateMock).not.toHaveBeenCalled();
  });
});

describe('finalizeSyncGroup via queueTransactionSync empty window', () => {
  it('completes the sync and stamps the connection when the deferred absorb succeeds', async () => {
    const accountId = generateRandomRecordId();

    const result = await queueEmptyWindow(accountId);

    expect(result.totalBatches).toBe(0);
    expect(runPendingLinkAbsorbMock).toHaveBeenCalledWith({ accountId, userId: USER_ID });
    expect(setAccountSyncStatusMock).toHaveBeenCalledWith({
      accountId,
      status: SyncStatus.COMPLETED,
      userId: USER_ID,
    });
    expect(connectionsUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('propagates the absorb failure and writes neither the status nor the connection stamp', async () => {
    const accountId = generateRandomRecordId();
    runPendingLinkAbsorbMock.mockRejectedValue(new Error('absorb blew up'));

    await expect(queueEmptyWindow(accountId)).rejects.toThrow('absorb blew up');

    expect(setAccountSyncStatusMock).not.toHaveBeenCalled();
    expect(connectionsUpdateMock).not.toHaveBeenCalled();
  });
});

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('syncPriorityForAccount', () => {
  it('ranks active accounts ahead of stale ones and fresh accounts first', () => {
    const fresh = syncPriorityForAccount({ latestTransactionTime: null });
    const active = syncPriorityForAccount({ latestTransactionTime: daysAgo(0.5) });
    const stale = syncPriorityForAccount({ latestTransactionTime: daysAgo(180) });

    expect(fresh).toBe(1);
    expect(active).toBe(1);
    expect(stale).toBe(180);
    expect(syncPriorityForAccount({ latestTransactionTime: daysAgo(10_000_000) })).toBe(2 ** 21 - 1);
  });

  it('stamps every queued batch with the given priority', async () => {
    const { Queue } = jest.requireMock('bullmq') as { Queue: jest.Mock };
    await queueTransactionSync({
      userId: USER_ID,
      accountId: generateRandomRecordId(),
      connectionId: CONNECTION_ID,
      externalAccountId: 'external-1',
      apiToken: 'token-priority',
      from: new Date('2024-01-01T00:00:00.000Z'),
      to: new Date('2024-03-15T00:00:00.000Z'),
      priority: 7,
    });

    const queue = Queue.mock.results.at(-1)!.value as { addBulk: jest.Mock };
    const jobs = queue.addBulk.mock.calls[0]![0] as Array<{ opts: { priority?: number } }>;
    expect(jobs.length).toBeGreaterThan(1);
    expect(jobs.every((job) => job.opts.priority === 7)).toBe(true);
  });
});
