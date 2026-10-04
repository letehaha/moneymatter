import { describe, expect, it, jest } from '@jest/globals';

const batchCreateMock = jest.fn<(values: unknown) => Promise<{ id: string }>>();
const batchUpdateMock = jest.fn<(values: unknown, options: unknown) => Promise<unknown>>();
const effectsBulkCreateMock = jest.fn<(rows: unknown) => Promise<unknown>>();

jest.mock('@models/import-batches.model', () => ({
  __esModule: true,
  default: {
    create: (values: unknown) => batchCreateMock(values),
    update: (values: unknown, options: unknown) => batchUpdateMock(values, options),
  },
}));

jest.mock('@models/import-batch-account-effects.model', () => ({
  __esModule: true,
  default: { bulkCreate: (rows: unknown) => effectsBulkCreateMock(rows) },
}));

// The real wrapper needs a DB connection this unit test has none of. Running the body
// straight through is what a committed run looks like to the caller.
jest.mock('@services/common/with-transaction', () => ({
  __esModule: true,
  withTransaction: <T extends unknown[], R>(fn: (...args: T) => Promise<R>) => fn,
}));

/* eslint-disable import/first */
import { ImportSource } from '@bt/shared/types';

import { type OpenImportBatch, withImportBatchRecord } from './import-batch-record';
/* eslint-enable import/first */

describe('withImportBatchRecord', () => {
  it('stamps finishedAt on the opened batch and rethrows when the importer fails after opening it', async () => {
    batchCreateMock.mockResolvedValue({ id: 'batch-row-1' });
    const failure = new Error('payee resolution failed');

    const importer = withImportBatchRecord(async ({ openImportBatch }: { openImportBatch: OpenImportBatch }) => {
      await openImportBatch({
        userId: 1,
        importDetails: { batchId: 'batch-1', source: ImportSource.csv, importedAt: new Date().toISOString() },
        createdAccountIds: ['acc-1'],
      });
      throw failure;
    });

    await expect(importer({})).rejects.toBe(failure);

    expect(batchUpdateMock).toHaveBeenCalledWith({ finishedAt: expect.any(Date) }, { where: { id: 'batch-row-1' } });
  });
});
