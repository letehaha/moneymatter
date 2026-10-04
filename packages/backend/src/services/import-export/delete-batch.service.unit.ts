import { beforeEach, describe, expect, it, jest } from '@jest/globals';

interface MockRow {
  id: string;
  accountId: string;
  transferId?: string | null;
  transferNature?: string;
}

interface MockBatch {
  id: string;
  importedAt: Date;
  finishedAt: Date | null;
  destroy: jest.Mock<() => Promise<void>>;
}

interface MockEffect {
  accountId: string;
  absorbedAmount: Money;
  createdByImport: boolean;
}

interface AbsorbParams {
  userId: number;
  accountId: string;
  amountDelta: Money;
}

const findWithFiltersMock = jest.fn<() => Promise<MockRow[]>>();
const transactionsFindAllMock = jest.fn<() => Promise<{ id: string; transferId: string }[]>>();
const updateTransactionsMock = jest.fn<(params: unknown) => Promise<unknown>>();
const batchFindOneMock = jest.fn<(params: unknown) => Promise<MockBatch | null>>();
const effectsFindAllMock = jest.fn<(params: unknown) => Promise<MockEffect[]>>();
const absorbMock = jest.fn<(params: AbsorbParams) => Promise<unknown>>();
const lockAccountRowMock = jest.fn<(params: { accountId: string }) => Promise<{ id: string; type: string } | null>>();
const deleteAccountByIdMock = jest.fn<(params: { id: string; userId: number }) => Promise<unknown>>();
const bulkDeleteMock =
  jest.fn<
    (params: { userId: number; transactionIds: string[] }) => Promise<{ deletedCount: number; deletedIds: string[] }>
  >();

jest.mock('@models/transactions.model', () => ({
  __esModule: true,
  findWithFilters: () => findWithFiltersMock(),
}));

jest.mock('@models/transactions-query', () => ({
  __esModule: true,
  countTransactions: async () => 0,
  findTransactions: () => transactionsFindAllMock(),
  updateTransactions: (params: unknown) => updateTransactionsMock(params),
}));

jest.mock('@models/import-batches.model', () => ({
  __esModule: true,
  default: { findOne: (params: unknown) => batchFindOneMock(params) },
}));

jest.mock('@models/import-batch-account-effects.model', () => ({
  __esModule: true,
  default: { findAll: (params: unknown) => effectsFindAllMock(params) },
}));

jest.mock('@services/accounts.service', () => ({
  __esModule: true,
  deleteAccountById: (params: { id: string; userId: number }) => deleteAccountByIdMock(params),
}));

jest.mock('@services/accounts/absorb-balance-adjustment', () => ({
  __esModule: true,
  absorbBalanceAdjustment: (params: AbsorbParams) => absorbMock(params),
}));

jest.mock('@services/accounts/lock-account-row', () => ({
  __esModule: true,
  lockAccountRow: (params: { accountId: string }) => lockAccountRowMock(params),
}));

jest.mock('@services/transactions/bulk-delete', () => ({
  __esModule: true,
  bulkDelete: (params: { userId: number; transactionIds: string[] }) => bulkDeleteMock(params),
}));

// The real wrapper needs a DB connection this unit test has none of. Running the body
// straight through is what a committed run looks like to the caller.
jest.mock('@services/common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));

/* eslint-disable import/first */
import { ACCOUNT_TYPES, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { LockedError, ValidationError } from '@js/errors';

import { ImportBatchTooLargeError, deleteImportBatch } from './delete-batch.service';
/* eslint-enable import/first */

const USER_ID = 1;
const BATCH_ID = 'batch-1';
const HOUR_MS = 60 * 60 * 1000;

function mockRows(count: number) {
  findWithFiltersMock.mockResolvedValue(
    Array.from({ length: count }, (_, i) => ({ id: `tx-${i}`, accountId: 'acc-1' })),
  );
}

function mockBatch({ importedAt, finishedAt }: { importedAt: Date; finishedAt: Date | null }): MockBatch {
  const batch: MockBatch = { id: 'batch-row-1', importedAt, finishedAt, destroy: jest.fn<() => Promise<void>>() };
  batchFindOneMock.mockResolvedValue(batch);
  return batch;
}

describe('deleteImportBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lockAccountRowMock.mockImplementation(async ({ accountId }) => ({ id: accountId, type: ACCOUNT_TYPES.system }));
    batchFindOneMock.mockResolvedValue(null);
    effectsFindAllMock.mockResolvedValue([]);
  });

  it('throws ImportBatchTooLargeError above the sync cap without deleting anything', async () => {
    mockRows(1001);

    await expect(deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID })).rejects.toBeInstanceOf(
      ImportBatchTooLargeError,
    );

    expect(bulkDeleteMock).not.toHaveBeenCalled();
  });

  it('deletes an at-cap batch in a single bulkDelete call', async () => {
    mockRows(1000);

    const result = await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID });

    expect(bulkDeleteMock).toHaveBeenCalledTimes(1);
    expect(bulkDeleteMock.mock.calls[0]![0].transactionIds).toHaveLength(1000);
    expect(result.deletedCount).toBe(1000);
    expect(result.deletedIds).toHaveLength(1000);
  });

  it('locks the affected accounts before deleting and reverses nothing when the batch has no batch row', async () => {
    mockRows(2);
    effectsFindAllMock.mockResolvedValue([
      { accountId: 'acc-2', absorbedAmount: Money.fromCents(1500), createdByImport: false },
    ]);

    const result = await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID });

    expect(lockAccountRowMock.mock.calls).toEqual([[{ accountId: 'acc-1' }]]);
    expect(lockAccountRowMock.mock.invocationCallOrder[0]!).toBeLessThan(bulkDeleteMock.mock.invocationCallOrder[0]!);
    expect(absorbMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCount: 2, deletedIds: ['tx-0', 'tx-1'] });
  });

  it('deletes above the cap when maxRows is lifted (the background worker path)', async () => {
    mockRows(1001);

    const result = await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID, maxRows: Infinity });

    expect(bulkDeleteMock.mock.calls[0]![0].transactionIds).toHaveLength(1001);
    expect(result.deletedCount).toBe(1001);
  });

  it('reports every batch row as deleted even when bulkDelete skips a cascade-deleted intra-batch twin', async () => {
    findWithFiltersMock.mockResolvedValue([
      {
        id: 'tx-0',
        accountId: 'acc-1',
        transferId: 'transfer-1',
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      },
      {
        id: 'tx-1',
        accountId: 'acc-1',
        transferId: 'transfer-1',
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      },
    ]);
    transactionsFindAllMock.mockResolvedValue([
      { id: 'tx-0', transferId: 'transfer-1' },
      { id: 'tx-1', transferId: 'transfer-1' },
    ]);
    bulkDeleteMock.mockResolvedValue({ deletedCount: 1, deletedIds: ['tx-0'] });

    const result = await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID });

    expect(bulkDeleteMock).toHaveBeenCalledTimes(1);
    expect(updateTransactionsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ deletedCount: 2, deletedIds: ['tx-0', 'tx-1'] });
  });

  it('rejects, without mutating anything, when a batch leg is linked to a loan payment outside the batch', async () => {
    findWithFiltersMock.mockResolvedValue([
      {
        id: 'tx-0',
        accountId: 'acc-1',
        transferId: 'transfer-1',
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      },
    ]);
    transactionsFindAllMock.mockResolvedValue([
      { id: 'tx-0', transferId: 'transfer-1' },
      { id: 'loan-payment-outside-batch', transferId: 'transfer-1' },
    ]);

    await expect(deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID })).rejects.toThrow();

    expect(updateTransactionsMock).not.toHaveBeenCalled();
    expect(bulkDeleteMock).not.toHaveBeenCalled();
  });

  it('refuses with LockedError while the import is still running', async () => {
    mockRows(2);
    mockBatch({ importedAt: new Date(), finishedAt: null });
    effectsFindAllMock.mockResolvedValue([
      { accountId: 'acc-1', absorbedAmount: Money.fromCents(1500), createdByImport: false },
    ]);

    await expect(deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID })).rejects.toBeInstanceOf(LockedError);

    expect(bulkDeleteMock).not.toHaveBeenCalled();
    expect(absorbMock).not.toHaveBeenCalled();
  });

  it('undoes an unfinished batch once the import is old enough to have crashed', async () => {
    mockRows(2);
    const batch = mockBatch({ importedAt: new Date(Date.now() - 4 * HOUR_MS), finishedAt: null });

    const result = await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID });

    expect(result).toEqual({ deletedCount: 2, deletedIds: ['tx-0', 'tx-1'] });
    expect(batch.destroy).toHaveBeenCalledTimes(1);
  });

  it('reverses each recorded non-zero absorb, locks effect-only accounts and destroys the batch row', async () => {
    mockRows(2);
    const batch = mockBatch({ importedAt: new Date(Date.now() - HOUR_MS), finishedAt: new Date() });
    effectsFindAllMock.mockResolvedValue([
      { accountId: 'acc-2', absorbedAmount: Money.fromCents(1500), createdByImport: false },
      { accountId: 'acc-3', absorbedAmount: Money.zero(), createdByImport: true },
    ]);

    await deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID });

    expect(batchFindOneMock).toHaveBeenCalledWith({ where: { userId: USER_ID, batchId: BATCH_ID }, lock: true });

    const bulkDeleteOrder = bulkDeleteMock.mock.invocationCallOrder[0]!;
    const accountsLockedBeforeDelete = lockAccountRowMock.mock.calls
      .filter((_, i) => lockAccountRowMock.mock.invocationCallOrder[i]! < bulkDeleteOrder)
      .map(([params]) => params.accountId);
    expect(accountsLockedBeforeDelete).toEqual(['acc-1', 'acc-2']);

    expect(absorbMock).toHaveBeenCalledTimes(1);
    const reversal = absorbMock.mock.calls[0]![0];
    expect(reversal).toMatchObject({ userId: USER_ID, accountId: 'acc-2' });
    expect(reversal.amountDelta.toCents()).toBe(-1500);

    expect(batch.destroy).toHaveBeenCalledTimes(1);
    expect(deleteAccountByIdMock.mock.calls).toEqual([[{ id: 'acc-3', userId: USER_ID }]]);
  });

  it('still resolves with the deleted rows when deleting a created account fails after commit', async () => {
    mockRows(2);
    mockBatch({ importedAt: new Date(Date.now() - HOUR_MS), finishedAt: new Date() });
    effectsFindAllMock.mockResolvedValue([{ accountId: 'acc-3', absorbedAmount: Money.zero(), createdByImport: true }]);
    deleteAccountByIdMock.mockRejectedValueOnce(new Error('db down'));

    await expect(deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID })).resolves.toEqual({
      deletedCount: 2,
      deletedIds: ['tx-0', 'tx-1'],
    });
    expect(deleteAccountByIdMock).toHaveBeenCalledTimes(1);
  });

  it('rejects, without deleting or reversing anything, when a locked affected account is bank-linked', async () => {
    mockRows(2);
    const batch = mockBatch({ importedAt: new Date(Date.now() - HOUR_MS), finishedAt: new Date() });
    effectsFindAllMock.mockResolvedValue([
      { accountId: 'acc-2', absorbedAmount: Money.fromCents(1500), createdByImport: false },
    ]);
    lockAccountRowMock.mockImplementation(async ({ accountId }) => ({
      id: accountId,
      type: accountId === 'acc-2' ? ACCOUNT_TYPES.monobank : ACCOUNT_TYPES.system,
    }));

    await expect(deleteImportBatch({ userId: USER_ID, batchId: BATCH_ID })).rejects.toBeInstanceOf(ValidationError);

    expect(bulkDeleteMock).not.toHaveBeenCalled();
    expect(absorbMock).not.toHaveBeenCalled();
    expect(batch.destroy).not.toHaveBeenCalled();
  });
});
