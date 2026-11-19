import { TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('Undoing an import that forced an entered balance on the account it created', () => {
  it('reverts exactly the rounded shift it applied, when the entered balance has more decimals than the currency', async () => {
    const summary = await helpers.runCsvImport({ currencyCode: global.BASE_CURRENCY_CODE, enteredBalance: 500.005 });
    const created = (await helpers.getAccounts()).find((account) => account.name === 'A')!;
    expect(Number(created.currentBalance)).toBe(500.01);

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: created.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    await helpers.deleteImportBatch({ batchId: summary.batchId, raw: true });

    expect(Number((await helpers.getAccount({ id: created.id, raw: true })).currentBalance)).toBe(50);
  });
});
