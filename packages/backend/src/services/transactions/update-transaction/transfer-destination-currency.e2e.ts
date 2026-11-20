import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('Moving a transfer leg to an account in another currency', () => {
  it('rounds the kept destination amount to the new currency decimals', async () => {
    const [sourceAccount, destinationAccount] = await Promise.all([
      helpers.createAccount({ raw: true }),
      helpers.createAccount({ raw: true }),
    ]);
    const { account: jpyAccount } = await helpers.createAccountWithNewCurrency({ currency: 'JPY' });

    const [outLeg] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: sourceAccount.id,
          amount: 12.34,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 12.34,
        destinationAccountId: destinationAccount.id,
      },
      raw: true,
    });

    await helpers.updateTransaction({
      id: outLeg.id,
      payload: { destinationAccountId: jpyAccount.id },
      raw: true,
    });

    const [movedLeg] = await helpers.getTransactions({ accountIds: [jpyAccount.id], raw: true });
    expect(movedLeg!.currencyCode).toBe('JPY');
    expect(Number(movedLeg!.amount)).toBe(12);
    expect(Number((await helpers.getAccount({ id: jpyAccount.id, raw: true })).currentBalance)).toBe(12);
  });
});
