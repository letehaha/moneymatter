import { type ImportBatchDeleteActiveStatus, ImportSource } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LockedError, ValidationError } from '@js/errors';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import { getUserActiveImportBatchDeleteStatus } from '@services/import-export/delete-batch-queue';
import { deleteOrQueueImportBatch } from '@services/import-export/delete-or-queue-batch.service';
import { listBatchesHistory } from '@services/import-export/get-batches-history.service';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Block the real services, whose import chains build queues at module scope and would open
// Redis connections in a unit test.
jest.mock('@services/import-export/delete-or-queue-batch.service', () => ({ deleteOrQueueImportBatch: jest.fn() }));
jest.mock('@services/import-export/delete-batch-queue', () => ({ getUserActiveImportBatchDeleteStatus: jest.fn() }));
jest.mock('@services/import-export/get-batches-history.service', () => ({ listBatchesHistory: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));

import { registerDeleteImportBatch } from './delete-import-batch';
import { registerGetImportBatchDeleteStatus } from './get-import-batch-delete-status';
import { registerListImportBatches } from './list-import-batches';

const READER = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE_ONLY = makeExtra({ scopes: ['finance:read', 'finance:delete'] });
const LOCKED = /currencies.baseCurrencyChangeInProgress/;

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const historyService = jest.mocked(listBatchesHistory);
const statusService = jest.mocked(getUserActiveImportBatchDeleteStatus);
const deleteService = jest.mocked(deleteOrQueueImportBatch);

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

const call = async ({
  tool,
  args,
  extra = READER,
}: {
  tool: ReturnType<typeof captureTools>[number];
  args?: unknown;
  extra?: ReturnType<typeof makeExtra>;
}) => parseToolResult({ result: await (args === undefined ? tool.handler(extra) : tool.handler(args, extra)) });

const makeBatch = (patch: Record<string, unknown> = {}) => ({
  batchId: BATCH_ID,
  source: ImportSource.csv,
  importedAt: '2026-10-10T08:00:00.000Z',
  transactionCount: 12,
  accountIds: [ACCOUNT_ID],
  createdAccountCount: 1,
  ...patch,
});

beforeEach(() => {
  jest.resetAllMocks();
});

describe('list_import_batches', () => {
  const tool = captureTools({ register: registerListImportBatches })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name and bounds limit and offset', () => {
    expect(tool.name).toBe('list_import_batches');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['limit', 'offset']);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ limit: 100, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ offset: -1 }).success).toBe(false);
  });

  it('lists the caller batches with the default page and copies the fields by name', async () => {
    historyService.mockResolvedValue({
      items: [makeBatch({ internalNote: 'do not copy' })] as never,
      totalCount: 1,
    });

    const data = await call({ tool, args: {} });

    expect(historyService).toHaveBeenCalledWith({ userId: 42, limit: 30, offset: 0 });
    expect(data).toEqual({ batches: [makeBatch()], total: 1 });
  });

  it('passes limit and offset on and reports no total past the first page', async () => {
    historyService.mockResolvedValue({ items: [], totalCount: null });

    const data = await call({ tool, args: { limit: 5, offset: 10 } });

    expect(historyService).toHaveBeenCalledWith({ userId: 42, limit: 5, offset: 10 });
    expect(data).toEqual({ batches: [], total: null });
  });

  it('describes the batch id as the argument of delete_import_batch', () => {
    expect(tool.config.description).toMatch(/delete_import_batch/);
  });
});

describe('get_import_batch_delete_status', () => {
  const tool = captureTools({ register: registerGetImportBatchDeleteStatus })[0]!;

  it('registers under its name and takes no input', () => {
    expect(tool.name).toBe('get_import_batch_delete_status');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual([]);
  });

  const STATUSES: ImportBatchDeleteActiveStatus[] = [
    { state: 'idle' },
    { state: 'queued', jobId: 'job-1' },
    { state: 'running', jobId: 'job-1' },
    { state: 'completed', jobId: 'job-1', deletedCount: 1500 },
    { state: 'failed', jobId: 'job-1', error: 'Boom' },
  ];

  it.each(STATUSES)('reports the caller job as %j', async (status) => {
    statusService.mockResolvedValue(status);

    const data = await call({ tool });

    expect(statusService).toHaveBeenCalledWith({ userId: 42 });
    expect(data).toEqual(status);
  });

  it('copies the status fields by name', async () => {
    statusService.mockResolvedValue({ state: 'completed', jobId: 'job-1', deletedCount: 3, extra: 'x' } as never);

    expect(await call({ tool })).toEqual({ state: 'completed', jobId: 'job-1', deletedCount: 3 });
  });
});

describe('delete_import_batch', () => {
  const tool = captureTools({ register: registerDeleteImportBatch })[0]!;
  const schema = z.object(tool.config.inputSchema ?? {}).strict();

  it('registers under its name, takes a uuid batch id and says it undoes an import and may run as a job', () => {
    expect(tool.name).toBe('delete_import_batch');
    expect(Object.keys(tool.config.inputSchema ?? {})).toEqual(['batchId', 'deleteLinkedTransfers']);
    expect(schema.safeParse({ batchId: BATCH_ID }).success).toBe(true);
    expect(schema.safeParse({ batchId: BATCH_ID, deleteLinkedTransfers: true }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ batchId: 'not-a-uuid' }).success).toBe(false);
    expect(tool.config.description).toMatch(/undo/i);
    expect(tool.config.description).toMatch(/irreversible|permanent/i);
    expect(tool.config.description).toMatch(/get_import_batch_delete_status/);
    expect(tool.config.description).toMatch(/finance:delete/);
  });

  it('deletes a batch inline for the caller and reports the count without the ids', async () => {
    deleteService.mockResolvedValue({ deletedCount: 2, deletedIds: ['a', 'b'] });

    const data = await call({ tool, args: { batchId: BATCH_ID }, extra: DELETE_ONLY });

    expect(deleteService).toHaveBeenCalledWith({ userId: 42, batchId: BATCH_ID, deleteLinkedTransfers: false });
    expect(data).toEqual({ queued: false, deletedCount: 2 });
  });

  it('passes deleteLinkedTransfers on', async () => {
    deleteService.mockResolvedValue({ deletedCount: 0, deletedIds: [] });

    await call({ tool, args: { batchId: BATCH_ID, deleteLinkedTransfers: true }, extra: DELETE_ONLY });

    expect(deleteService).toHaveBeenCalledWith({ userId: 42, batchId: BATCH_ID, deleteLinkedTransfers: true });
  });

  it('reports a batch above the sync cap as a queued job to follow with the status tool', async () => {
    deleteService.mockResolvedValue({ jobId: 'import-batch-delete-42-job' });

    const data = (await call({ tool, args: { batchId: BATCH_ID }, extra: DELETE_ONLY })) as Record<string, unknown>;

    expect(data).toMatchObject({ queued: true, jobId: 'import-batch-delete-42-job' });
    expect(data).not.toHaveProperty('deletedCount');
    expect(String(data.message)).toMatch(/get_import_batch_delete_status/);
  });

  it('passes the service refusals through', async () => {
    deleteService.mockRejectedValue(new ValidationError({ message: 'bank-linked' }));
    await expect(call({ tool, args: { batchId: BATCH_ID }, extra: DELETE_ONLY })).rejects.toThrow('bank-linked');

    deleteService.mockRejectedValue(new LockedError({ message: 'delete in progress' }));
    await expect(call({ tool, args: { batchId: BATCH_ID }, extra: DELETE_ONLY })).rejects.toThrow('delete in progress');
  });

  it('refuses a write-only token, a read-only user, a demo user and a base-currency change, before the service', async () => {
    const args = { batchId: BATCH_ID };

    await expect(call({ tool, args, extra: WRITE })).rejects.toThrow(/finance:delete/);
    await expect(call({ tool, args, extra: makeExtra({ readOnly: true }) })).rejects.toThrow();
    await expect(call({ tool, args, extra: makeExtra({ role: 'demo' }) })).rejects.toThrow(/demo/i);
    lockCheck.mockResolvedValue(true);
    await expect(call({ tool, args, extra: DELETE_ONLY })).rejects.toThrow(LOCKED);
    expect(deleteService).not.toHaveBeenCalled();
  });
});
