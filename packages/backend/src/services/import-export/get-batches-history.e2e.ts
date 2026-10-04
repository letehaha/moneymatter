import { ImportSource } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { asUser, signUpSecondUser, withoutSession } from '@tests/helpers/share';

describe('GET /import/batches-history', () => {
  it('lists batches from different sources with correct source, count, and accountIds', async () => {
    const account = await helpers.createAccount({ raw: true });
    const csvSummary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });
    const { summary: ynabSummary, accountNames: ynabAccountNames } = await helpers.runYnabImport();

    const result = await helpers.getBatchesHistory({ raw: true });

    expect(result.totalCount).toBe(2);
    expect(result.items).toHaveLength(2);

    const csvBatch = result.items.find((b) => b.source === ImportSource.csv)!;
    expect(csvBatch).toBeDefined();
    expect(csvBatch.batchId).toBe(csvSummary.batchId);
    expect(csvBatch.transactionCount).toBe(2);
    expect(csvBatch.accountIds).toEqual([account.id]);

    // Dedicated assertion for the YNAB mislabeling bug fixed alongside this
    // feature: the batch must be tagged `ynab`, not `csv`.
    const ynabBatch = result.items.find((b) => b.source === ImportSource.ynab);
    expect(ynabBatch).toBeDefined();
    // The fixture's one transfer creates two linked rows (both legs stamped with
    // the batch), so the row count is transactions + 2x transfers, not + transfers.
    expect(ynabBatch!.transactionCount).toBe(ynabSummary.transactionsImported + 2 * ynabSummary.transfersImported);

    // Every account the import touched or created — including a transfer's
    // destination account — must show up, not just the source leg's account.
    const allAccounts = await helpers.getAccounts();
    const expectedYnabAccountIds = allAccounts.filter((a) => ynabAccountNames.includes(a.name)).map((a) => a.id);
    expect(expectedYnabAccountIds).toHaveLength(ynabAccountNames.length);
    expect(new Set(ynabBatch!.accountIds)).toEqual(new Set(expectedYnabAccountIds));
  });

  it('lists the newest batch first, paginating with totalCount only on the first page', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });
    const older = await helpers.runCsvImport({ accountId: accountA.id, currencyCode: accountA.currencyCode });
    // Import batches are millisecond-stamped; without a gap the two could land in
    // the same millisecond and "newest first" would be unverifiable here.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const newer = await helpers.runCsvImport({ accountId: accountB.id, currencyCode: accountB.currencyCode });

    const firstPage = await helpers.getBatchesHistory({ payload: { limit: 1, offset: 0 }, raw: true });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.totalCount).toBe(2);
    expect(firstPage.items[0]!.batchId).toBe(newer.batchId);

    const secondPage = await helpers.getBatchesHistory({ payload: { limit: 1, offset: 1 }, raw: true });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.totalCount).toBeNull();
    expect(secondPage.items[0]!.batchId).toBe(older.batchId);
  });

  it('rejects a limit above the allowed maximum and an unauthenticated request', async () => {
    const overLimit = await helpers.getBatchesHistory({ payload: { limit: 500 } });
    expect(overLimit.statusCode).toBe(422);

    const unauthenticated = await withoutSession(() => helpers.getBatchesHistory({}));
    expect(unauthenticated.statusCode).toBe(401);
  });

  it("never surfaces another user's batches", async () => {
    const account = await helpers.createAccount({ raw: true });
    await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });
    expect((await helpers.getBatchesHistory({ raw: true })).totalCount).toBe(1);

    const otherUser = await signUpSecondUser();
    const otherHistory = await asUser({
      cookies: otherUser.cookies,
      fn: () => helpers.getBatchesHistory({ raw: true }),
    });

    expect(otherHistory).toEqual({ items: [], totalCount: 0 });
  });

  it('keeps a batch listed after its rows were deleted by hand while it still has an absorb to undo', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const manualDelete = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: summary.newTransactionIds },
    });
    expect(manualDelete.statusCode).toBe(200);

    expect(await helpers.getBatchesHistory({ raw: true })).toEqual({
      items: [
        expect.objectContaining({
          batchId: summary.batchId,
          source: ImportSource.csv,
          transactionCount: 0,
          accountIds: [account.id],
          createdAccountCount: 0,
        }),
      ],
      totalCount: 1,
    });

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    expect(await helpers.getBatchesHistory({ raw: true })).toEqual({ items: [], totalCount: 0 });
  });

  it('hides a batch once its rows are gone and nothing is left to undo', async () => {
    // No earlier transaction on the account, so a recalculating import absorbs nothing.
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      recalculateBalance: true,
    });
    expect((await helpers.getBatchesHistory({ raw: true })).totalCount).toBe(1);

    const manualDelete = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: summary.newTransactionIds },
    });
    expect(manualDelete.statusCode).toBe(200);

    expect(await helpers.getBatchesHistory({ raw: true })).toEqual({ items: [], totalCount: 0 });
  });

  it('reports how many accounts the import created', async () => {
    const creating = await helpers.runCsvImport({ currencyCode: global.BASE_CURRENCY_CODE });
    const existing = await helpers.createAccount({ raw: true });
    const linking = await helpers.runCsvImport({ accountId: existing.id, currencyCode: existing.currencyCode });

    const history = await helpers.getBatchesHistory({ raw: true });

    expect(Object.fromEntries(history.items.map((item) => [item.batchId, item.createdAccountCount]))).toEqual({
      [creating.batchId]: 1,
      [linking.batchId]: 0,
    });

    const created = (await helpers.getAccounts()).find((account) => account.id !== existing.id)!;
    expect(created).toBeDefined();

    const manualDelete = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: creating.newTransactionIds },
    });
    expect(manualDelete.statusCode).toBe(200);

    const emptied = (await helpers.getBatchesHistory({ raw: true })).items.find(
      (item) => item.batchId === creating.batchId,
    );
    expect(emptied).toEqual(
      expect.objectContaining({ transactionCount: 0, accountIds: [created.id], createdAccountCount: 1 }),
    );

    await helpers.deleteImportBatch({ batchId: creating.batchId, raw: true });

    const historyAfterUndo = await helpers.getBatchesHistory({ raw: true });
    expect(historyAfterUndo.items.map((item) => item.batchId)).toEqual([linking.batchId]);
    expect((await helpers.getAccounts()).map((account) => account.id)).toEqual([existing.id]);
  });
});
