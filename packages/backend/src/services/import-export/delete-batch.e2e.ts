import {
  BANK_PROVIDER_TYPE,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  asDecimal,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { waitForImportBatchDelete } from '@tests/helpers/import-export';
import { asUser, signUpSecondUser, withoutSession } from '@tests/helpers/share';
import { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';

/** LunchFlow's mock account id used across the bank-data-provider test fixtures. */
const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = '1001';

/** Connects a USD account to LunchFlow, turning it bank-linked after its import. */
async function linkAccountToLunchFlow({ accountId }: { accountId: string }) {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
    credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
    raw: true,
  });
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({
      response: getMockedLunchFlowTransactions(0),
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
    }),
    getLunchFlowBalanceMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: { balance: { amount: asDecimal(0), currency: 'USD' } },
    }),
  );
  const linkResponse = await helpers.linkAccountToBankConnection({
    id: accountId,
    connectionId,
    externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
    raw: false,
  });
  expect(linkResponse.statusCode).toBe(200);
}

describe('DELETE /import/batch/:batchId', () => {
  it('deletes every transaction of the batch and restores the account balance', async () => {
    const account = await helpers.createAccount({ raw: true });
    const balanceBeforeImport = account.currentBalance;

    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      recalculateBalance: true,
    });

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result.deletedCount).toBe(2);
    expect(result.deletedIds.toSorted()).toEqual(summary.newTransactionIds.toSorted());

    const remaining = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    expect(remaining).toHaveLength(0);

    const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterDelete.currentBalance).toBe(balanceBeforeImport);
  });

  it('restores current and initial balance when the import absorbed its rows into the opening balance', async () => {
    const account = await helpers.createAccount({ raw: true });
    const historyBeforeImport = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      recalculateBalance: false,
    });

    const accountAfterImport = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterImport.currentBalance).toBe(account.currentBalance);

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterDelete.currentBalance).toBe(account.currentBalance);
    expect(accountAfterDelete.initialBalance).toBe(account.initialBalance);

    // Compared as value sets: the days the deleted rows sat on keep flat records.
    const historyAfterDelete = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
    expect(new Set(historyAfterDelete.map((record) => record.amount))).toEqual(
      new Set(historyBeforeImport.map((record) => record.amount)),
    );
  });

  it('restores both balances when a recalculating import absorbed rows older than the latest transaction', async () => {
    const account = await helpers.createAccount({ raw: true });
    // Newer than both CSV rows, so the import classifies them as history and absorbs them.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, time: new Date('2024-06-01').toISOString() }),
      raw: true,
    });
    const accountBeforeImport = await helpers.getAccount({ id: account.id, raw: true });

    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      recalculateBalance: true,
    });

    const accountAfterImport = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterImport.currentBalance).toBe(accountBeforeImport.currentBalance);
    expect(accountAfterImport.initialBalance).not.toBe(accountBeforeImport.initialBalance);

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterDelete.currentBalance).toBe(accountBeforeImport.currentBalance);
    expect(accountAfterDelete.initialBalance).toBe(accountBeforeImport.initialBalance);
  });

  it('restores the opening balance when every imported row was already deleted by hand', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const manualDelete = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: summary.newTransactionIds },
    });
    expect(manualDelete.statusCode).toBe(200);
    const accountAfterManualDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterManualDelete.initialBalance).not.toBe(account.initialBalance);

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result).toEqual({ deletedCount: 0, deletedIds: [] });

    const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterDelete.currentBalance).toBe(account.currentBalance);
    expect(accountAfterDelete.initialBalance).toBe(account.initialBalance);

    // The batch row is gone with the first undo, so a repeat reverses nothing.
    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    const accountAfterRepeat = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterRepeat.initialBalance).toBe(account.initialBalance);
  });

  it('undoes one of two imports absorbed into the same account and leaves the other intact', async () => {
    const account = await helpers.createAccount({ raw: true });
    const first = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });
    const accountAfterFirstImport = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterFirstImport.initialBalance).not.toBe(account.initialBalance);
    // Expenses 10 + 20 + 5, so this batch absorbs 35 against the first batch's 30.
    const second = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      extraRows: [`2024-01-18,5.00,Snack,,A,${account.currencyCode},expense`],
    });
    expect(second.newTransactionIds).toHaveLength(3);

    await helpers.deleteImportBatch({ batchId: first.batchId, raw: true });

    const accountAfterFirstUndo = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterFirstUndo.currentBalance).toBe(account.currentBalance);
    expect(Number(accountAfterFirstUndo.initialBalance)).toBe(Number(account.initialBalance) + 35);
    const secondBatchRows = await helpers.getTransactions({ batchId: second.batchId, raw: true });
    expect(secondBatchRows.map((tx) => tx.id).toSorted()).toEqual(second.newTransactionIds.toSorted());

    await helpers.deleteImportBatch({ batchId: second.batchId, raw: true });

    const accountAfterSecondUndo = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterSecondUndo.initialBalance).toBe(account.initialBalance);
  });

  it('undoes a batch requested with an upper-cased batchId', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId.toUpperCase(), raw: true });
    expect(result.deletedCount).toBe(summary.newTransactionIds.length);

    const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
    expect(accountAfterDelete.currentBalance).toBe(account.currentBalance);
    expect(accountAfterDelete.initialBalance).toBe(account.initialBalance);
  });

  it('deletes an account the import created when it has no other transactions', async () => {
    const summary = await helpers.runCsvImport({ currencyCode: global.BASE_CURRENCY_CODE });
    const created = (await helpers.getAccounts()).find((account) => account.name === 'A')!;
    expect(created).toBeDefined();

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result.deletedCount).toBe(2);

    expect((await helpers.getAccounts()).find((account) => account.id === created.id)).toBeUndefined();
  });

  it('keeps an account the import created when the user added a transaction to it', async () => {
    const summary = await helpers.runCsvImport({ currencyCode: global.BASE_CURRENCY_CODE });
    const created = (await helpers.getAccounts()).find((account) => account.name === 'A')!;
    const [manualTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: created.id, transactionType: TRANSACTION_TYPES.income }),
      raw: true,
    });
    const accountBeforeDelete = await helpers.getAccount({ id: created.id, raw: true });

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    const remaining = await helpers.getTransactions({ accountIds: [created.id], raw: true });
    expect(remaining.map((tx) => tx.id)).toEqual([manualTx!.id]);

    // Only the two imported expenses (10 + 20) come off the balance.
    const accountAfterDelete = await helpers.getAccount({ id: created.id, raw: true });
    expect(Number(accountAfterDelete.currentBalance)).toBe(Number(accountBeforeDelete.currentBalance) + 30);
    expect(accountAfterDelete.initialBalance).toBe(accountBeforeDelete.initialBalance);
  });

  it('reverts the entered-balance shift on a created account the user added a transaction to', async () => {
    const summary = await helpers.runCsvImport({ currencyCode: global.BASE_CURRENCY_CODE, enteredBalance: 500 });
    const created = (await helpers.getAccounts()).find((account) => account.name === 'A')!;
    expect(Number(created.currentBalance)).toBe(500);
    expect(Number(created.initialBalance)).toBe(530);

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: created.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    const accountAfterDelete = await helpers.getAccount({ id: created.id, raw: true });
    expect(Number(accountAfterDelete.initialBalance)).toBe(0);
    expect(Number(accountAfterDelete.currentBalance)).toBe(-50);
  });

  it('undoes a batch that both created an account and absorbed into a linked one', async () => {
    const linked = await helpers.createAccount({ raw: true });

    const summary = await helpers.runCsvImport({ currencyCode: linked.currencyCode, incomeAccountId: linked.id });
    expect((await helpers.getAccounts()).some((account) => account.name === 'A')).toBe(true);
    const linkedAfterImport = await helpers.getAccount({ id: linked.id, raw: true });
    expect(linkedAfterImport.initialBalance).not.toBe(linked.initialBalance);

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result.deletedCount).toBe(3);

    expect((await helpers.getAccounts()).map((account) => account.id)).toEqual([linked.id]);

    const linkedAfterDelete = await helpers.getAccount({ id: linked.id, raw: true });
    expect(linkedAfterDelete.currentBalance).toBe(linked.currentBalance);
    expect(linkedAfterDelete.initialBalance).toBe(linked.initialBalance);
  });

  it('deleting an account removes its batch effects, so a later undo is a no-op', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      recalculateBalance: false,
    });

    const accountDelete = await helpers.deleteAccount({ id: account.id, raw: false });
    expect(accountDelete.statusCode).toBe(200);

    const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
    expect(response.statusCode).toBe(200);
    expect(response.body.response).toEqual({ deletedCount: 0, deletedIds: [] });
  });

  it('is a no-op success for a batchId with no matching transactions', async () => {
    const result = await helpers.deleteImportBatch({
      batchId: '00000000-0000-0000-0000-000000000000',
      raw: true,
    });

    expect(result).toEqual({ deletedCount: 0, deletedIds: [] });
  });

  it('rejects a non-uuid batchId', async () => {
    const response = await helpers.deleteImportBatch({ batchId: 'not-a-uuid' });

    expect(response.statusCode).toBe(422);
  });

  it('returns 401 for an unauthenticated request', async () => {
    const response = await withoutSession(() =>
      helpers.deleteImportBatch({ batchId: '00000000-0000-0000-0000-000000000000' }),
    );

    expect(response.statusCode).toBe(401);
  });

  it("never deletes another user's batch, even when the batchId is known", async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const otherUser = await signUpSecondUser();
    const otherResult = await asUser({
      cookies: otherUser.cookies,
      fn: () => helpers.deleteImportBatch({ batchId: summary.batchId, raw: true }),
    });
    // Scoped to the caller, so another user's batchId resolves as the no-op
    // success case (see the "no matching transactions" test above) — not a leak.
    expect(otherResult).toEqual({ deletedCount: 0, deletedIds: [] });

    // The owner's transactions must still be there — the other user's attempt was a no-op.
    const stillThere = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    expect(stillThere).toHaveLength(2);
  });

  it('rejects undoing a batch whose account was later connected to a bank', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
      raw: true,
    });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: 'USD' });

    await linkAccountToLunchFlow({ accountId: account.id });

    const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
    expect(response.statusCode).toBe(422);

    // Blocked before deletion, not partially applied.
    const stillThere = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    expect(stillThere).toHaveLength(2);
  });

  it('undoes an emptied batch whose created account was later connected to a bank, keeping the account', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const summary = await helpers.runCsvImport({ currencyCode: 'USD' });
    const created = (await helpers.getAccounts()).find((account) => account.name === 'A')!;
    expect(created).toBeDefined();

    const manualDelete = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: summary.newTransactionIds },
    });
    expect(manualDelete.statusCode).toBe(200);
    await linkAccountToLunchFlow({ accountId: created.id });

    const historyBeforeUndo = await helpers.getBatchesHistory({ raw: true });
    expect(historyBeforeUndo.items.map((item) => item.batchId)).toEqual([summary.batchId]);

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result).toEqual({ deletedCount: 0, deletedIds: [] });

    expect(await helpers.getBatchesHistory({ raw: true })).toEqual({ items: [], totalCount: 0 });
    expect((await helpers.getAccounts()).some((account) => account.id === created.id)).toBe(true);
  });

  it('unlinks (but does not delete) a transfer leg linked to a transaction outside the batch', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const otherAccount = await helpers.createAccount({ raw: true });
    const [manualTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: otherAccount.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const linkedBatchTxId = summary.newTransactionIds[0]!;
    await helpers.linkTransactions({
      payload: { ids: [[manualTx!.id as RecordId, linkedBatchTxId as RecordId]] },
      raw: true,
    });

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result.deletedCount).toBe(2);
    expect(result.deletedIds.toSorted()).toEqual(summary.newTransactionIds.toSorted());

    const remainingBatchTxs = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    expect(remainingBatchTxs).toHaveLength(0);

    // The linked transaction survives, demoted to a standalone out-of-wallet row.
    const [manualTxAfter] = await helpers.getTransactions({ accountIds: [otherAccount.id], raw: true });
    expect(manualTxAfter?.id).toBe(manualTx!.id);
    expect(manualTxAfter?.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
    expect(manualTxAfter?.transferId).toBeNull();
  });

  it('hard-deletes the linked external transaction too when deleteLinkedTransfers is true', async () => {
    const account = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: account.currencyCode });

    const otherAccount = await helpers.createAccount({ raw: true });
    const [manualTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: otherAccount.id,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const linkedBatchTxId = summary.newTransactionIds[0]!;
    await helpers.linkTransactions({
      payload: { ids: [[manualTx!.id as RecordId, linkedBatchTxId as RecordId]] },
      raw: true,
    });

    const result = await helpers.deleteImportBatch({
      batchId: summary.batchId,
      deleteLinkedTransfers: true,
      raw: true,
    });
    expect(result.deletedCount).toBe(3);
    expect(result.deletedIds.toSorted()).toEqual([...summary.newTransactionIds, manualTx!.id].toSorted());

    const manualTxAfter = await helpers.getTransactions({ accountIds: [otherAccount.id], raw: true });
    expect(manualTxAfter).toHaveLength(0);
  });

  it('deletes an intra-batch transfer pair fully and counts both legs', async () => {
    const account = await helpers.createAccount({ raw: true });
    const otherAccount = await helpers.createAccount({ raw: true });
    const summary = await helpers.runCsvImport({
      accountId: account.id,
      currencyCode: account.currencyCode,
      incomeAccountId: otherAccount.id,
    });
    expect(summary.newTransactionIds).toHaveLength(3);

    const imported = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    const income = imported.find((tx) => tx.transactionType === TRANSACTION_TYPES.income)!;
    const expense = imported.find((tx) => tx.transactionType === TRANSACTION_TYPES.expense)!;
    await helpers.linkTransactions({
      payload: { ids: [[income.id as RecordId, expense.id as RecordId]] },
      raw: true,
    });

    const result = await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });
    expect(result.deletedCount).toBe(3);
    expect(result.deletedIds.toSorted()).toEqual(summary.newTransactionIds.toSorted());

    const remaining = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
    expect(remaining).toHaveLength(0);

    for (const linked of [account, otherAccount]) {
      const afterDelete = await helpers.getAccount({ id: linked.id, raw: true });
      expect(afterDelete.currentBalance).toBe(linked.currentBalance);
      expect(afterDelete.initialBalance).toBe(linked.initialBalance);
    }
  });
});

describe('background delete for batches above the sync cap', () => {
  const OVERSIZED_BATCH_ROWS = 1001;
  const IMPORT_TIMEOUT_MS = 120_000;

  it('reports idle when no delete job exists', async () => {
    const status = await helpers.getImportBatchDeleteStatus({ raw: true });

    expect(status).toEqual({ state: 'idle' });
  });

  it('returns 401 for an unauthenticated status request', async () => {
    const response = await withoutSession(() => helpers.getImportBatchDeleteStatus());

    expect(response.statusCode).toBe(401);
  });

  it(
    'answers 202 with a job id, deletes every row in the background and restores current and initial balance',
    async () => {
      const account = await helpers.createAccount({ raw: true });

      const summary = await helpers.runCsvImport({
        accountId: account.id,
        currencyCode: account.currencyCode,
        recalculateBalance: false,
        extraRows: Array.from(
          { length: OVERSIZED_BATCH_ROWS - 2 },
          (_, i) => `2024-02-01,${(1 + i * 0.01).toFixed(2)},Row ${i},,A,${account.currencyCode},expense`,
        ),
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
      expect(summary.newTransactionIds).toHaveLength(OVERSIZED_BATCH_ROWS);

      const accountAfterImport = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfterImport.currentBalance).toBe(account.currentBalance);
      expect(accountAfterImport.initialBalance).not.toBe(account.initialBalance);

      const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
      expect(response.statusCode).toBe(202);
      const { jobId } = response.body.response as unknown as { jobId: string };
      expect(jobId).toEqual(expect.any(String));

      const inflight = await helpers.getImportBatchDeleteStatus({ raw: true });
      expect(inflight.state).not.toBe('idle');

      // Whether the worker already holds the lock (route guard) or not yet (enqueue
      // guard), a second delete is refused while the first is in flight.
      const second = await helpers.deleteImportBatch({ batchId: summary.batchId });
      expect(second.statusCode).toBe(423);

      const status = await waitForImportBatchDelete({ timeoutMs: IMPORT_TIMEOUT_MS });
      expect(status).toEqual({ state: 'completed', jobId, deletedCount: OVERSIZED_BATCH_ROWS });

      // The lock is released with the job, so writes flow again.
      const afterDelete = await helpers.createAccount();
      expect(afterDelete.statusCode).toBe(200);

      const remaining = await helpers.getTransactions({ batchId: summary.batchId, raw: true });
      expect(remaining).toHaveLength(0);

      const accountAfterDelete = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfterDelete.currentBalance).toBe(account.currentBalance);
      expect(accountAfterDelete.initialBalance).toBe(account.initialBalance);
    },
    IMPORT_TIMEOUT_MS * 3,
  );

  it(
    'rejects an oversized batch on a now bank-linked account immediately instead of queueing it',
    async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'USD' }),
        raw: true,
      });
      const summary = await helpers.runCsvImport({
        accountId: account.id,
        currencyCode: 'USD',
        extraRows: Array.from(
          { length: OVERSIZED_BATCH_ROWS - 2 },
          (_, i) => `2024-02-01,${(1 + i * 0.01).toFixed(2)},Row ${i},,A,USD,expense`,
        ),
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
      expect(summary.newTransactionIds).toHaveLength(OVERSIZED_BATCH_ROWS);

      await linkAccountToLunchFlow({ accountId: account.id });

      const response = await helpers.deleteImportBatch({ batchId: summary.batchId });
      expect(response.statusCode).toBe(422);

      const status = await helpers.getImportBatchDeleteStatus({ raw: true });
      expect(status).toEqual({ state: 'idle' });

      const stillThere = await helpers.getTransactions({
        batchId: summary.batchId,
        limit: OVERSIZED_BATCH_ROWS,
        raw: true,
      });
      expect(stillThere).toHaveLength(OVERSIZED_BATCH_ROWS);
    },
    IMPORT_TIMEOUT_MS * 2,
  );
});
