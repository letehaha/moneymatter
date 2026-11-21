import { ImportSource, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const createFromMessage = ({ accountId, importSource }: { accountId: RecordId; importSource: unknown }) =>
  helpers.createTransaction({
    payload: { ...helpers.buildTransactionPayload({ accountId }), importSource: importSource as never },
    raw: true,
  });

const listBatches = async () => (await helpers.getBatchesHistory({ raw: true })).items;

describe('POST /transactions with importSource', () => {
  it('lists the rows of one day as a single message-import batch', async () => {
    const account = await helpers.createAccount({ raw: true });

    await createFromMessage({ accountId: account.id, importSource: ImportSource.messageImport });
    await createFromMessage({ accountId: account.id, importSource: ImportSource.messageImport });

    expect(await listBatches()).toEqual([
      expect.objectContaining({
        source: ImportSource.messageImport,
        transactionCount: 2,
        accountIds: [account.id],
      }),
    ]);
  });

  it('deletes the rows when the batch is deleted from history', async () => {
    const account = await helpers.createAccount({ raw: true });
    await createFromMessage({ accountId: account.id, importSource: ImportSource.messageImport });
    const [untouched] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });
    const [batch] = await listBatches();

    const result = await helpers.deleteImportBatch({ batchId: batch!.batchId, raw: true });

    expect(result.deletedCount).toBe(1);
    expect((await helpers.getTransactions({ raw: true })).map((tx) => tx.id)).toEqual([untouched.id]);
    expect(await listBatches()).toEqual([]);
  });

  it('creates a planned row without filing it under a batch, even once it is confirmed', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, importSource: ImportSource.messageImport },
      raw: true,
    });
    await helpers.updateTransaction({ id: planned.id, payload: { isPlanned: false }, raw: true });

    expect((await helpers.getTransactionById({ id: planned.id, raw: true }))!.isPlanned).toBe(false);
    expect(await listBatches()).toEqual([]);
  });

  it.each([
    ['another source', ImportSource.csv],
    ['a non-string', 42],
    ['nothing', undefined],
  ])('creates the row as usual when importSource is %s', async (_label, importSource) => {
    const account = await helpers.createAccount({ raw: true });

    const [transaction] = await createFromMessage({ accountId: account.id, importSource });

    expect(transaction.accountId).toBe(account.id);
    expect(await listBatches()).toEqual([]);
  });
});
