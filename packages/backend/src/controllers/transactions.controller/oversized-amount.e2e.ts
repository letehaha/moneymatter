import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

// The largest amount the report engines can convert is Number.MAX_SAFE_INTEGER minor units.
describe('Amounts too large for the currency', () => {
  it.each([
    { currencyCode: 'USD', amount: 90_071_992_547_410 },
    { currencyCode: 'KWD', amount: 9_100_000_000_000 },
  ])('rejects a $currencyCode transaction of $amount and stats keep loading', async ({ currencyCode, amount }) => {
    await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode }),
      raw: true,
    });

    const response = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount }),
    });
    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

    const accountResponse = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode, initialBalance: amount }),
      raw: false,
    });
    expect(accountResponse.statusCode).toBe(ERROR_CODES.ValidationError);

    expect((await helpers.getBalanceHistory()).statusCode).toBe(200);
    expect((await helpers.getTotalBalance({ date: new Date().toISOString().slice(0, 10) })).statusCode).toBe(200);
  });

  it('rejects a transaction whose converted ref amount is too large for the base currency', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['GBP'], raw: true });
    await helpers.editUserCurrencyExchangeRate({
      pairs: [
        { baseCode: 'GBP', quoteCode: global.BASE_CURRENCY!.code, rate: 2 },
        { baseCode: global.BASE_CURRENCY!.code, quoteCode: 'GBP', rate: 0.5 },
      ],
    });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'GBP' }),
      raw: true,
    });

    const response = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 50_000_000_000_000 }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.getBalanceHistory()).statusCode).toBe(200);
  });

  it('fails a base-currency change that would convert an amount past the new currency limit', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true });
    const account = await helpers.createAccount({ raw: true });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 10_000_000_000_000 }),
      raw: true,
    });

    const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'UAH' });

    expect(status.state).toBe('failed');
    expect((await helpers.getBalanceHistory()).statusCode).toBe(200);
  });
});
