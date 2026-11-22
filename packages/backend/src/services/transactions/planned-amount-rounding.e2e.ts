import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('POST /transactions planned amount at the currency decimals', () => {
  it.each([
    { currency: 'JPY', amount: 0.4 },
    { currency: 'KWD', amount: 0.0004 },
  ])('rejects a $currency plan of $amount that rounds to zero', async ({ currency, amount }) => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency });

    const response = await helpers.createPlannedTransaction({ payload: { accountId: account.id, amount } });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('creates a JPY plan of 0.5 rounded up to 1', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'JPY' });

    const [plan] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 0.5 },
      raw: true,
    });

    expect(Number(plan!.amount)).toBe(1);
  });
});
