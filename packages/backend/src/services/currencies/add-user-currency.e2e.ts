import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('Add user currencies', () => {
  it('should successfully add user currencies', async () => {
    const allCurrencies = await helpers.getAllCurrencies();
    const uah = allCurrencies.find((i) => i.code === 'UAH')!;
    const eur = allCurrencies.find((i) => i.code === 'EUR')!;

    const currencies = [
      { currencyCode: uah.code, exchangeRate: 37, liveRateUpdate: true },
      { currencyCode: eur.code, exchangeRate: 0.85, liveRateUpdate: false },
    ];

    const res = await helpers.addUserCurrenciesWithRates({
      currencies,
      raw: false,
    });

    expect(res.statusCode).toEqual(200);

    // Verify that addition request returned added currencies
    const returnedValues = helpers.extractResponse(res).currencies;
    expect(returnedValues.length).toBe(2);
    expect(currencies.every((c) => returnedValues.some((i) => i.currencyCode === c.currencyCode))).toBe(true);

    const returnedUah = returnedValues.find((c) => c.currencyCode === uah.code)!;
    const returnedEur = returnedValues.find((c) => c.currencyCode === eur.code)!;

    expect(returnedUah.exchangeRate).toBe(37);
    expect(returnedUah.liveRateUpdate).toBe(true);
    expect(returnedEur.exchangeRate).toBe(0.85);
    expect(returnedEur.liveRateUpdate).toBe(false);
  });

  it('rejects an unknown currency code, a negative exchange rate and an empty currencies array', async () => {
    const unknownCode = await helpers.addUserCurrencies({ currencyCodes: ['ZZZ'] });
    expect(unknownCode.statusCode).toEqual(ERROR_CODES.ValidationError);

    const allCurrencies = await helpers.getAllCurrencies();
    const uah = allCurrencies.find((i) => i.code === 'UAH')!;

    const negativeRate = await helpers.addUserCurrenciesWithRates({
      currencies: [{ currencyCode: uah.code, exchangeRate: -1 }],
      raw: false,
    });
    expect(negativeRate.statusCode).toEqual(ERROR_CODES.ValidationError);

    const emptyList = await helpers.addUserCurrenciesWithRates({ currencies: [], raw: false });
    expect(emptyList.statusCode).toEqual(ERROR_CODES.ValidationError);
  });

  it.each(['XAU', 'XDR'])('rejects the non-currency code %s on add and on account create', async (code) => {
    const addRes = await helpers.addUserCurrencies({ currencyCodes: [code] });
    expect(addRes.statusCode).toEqual(ERROR_CODES.ValidationError);

    const accountRes = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: code, initialBalance: 0.5 }),
      raw: false,
    });
    expect(accountRes.statusCode).toEqual(ERROR_CODES.ValidationError);

    const userCurrencies = await helpers.getUserCurrencies();
    expect(userCurrencies.some((item) => item.currencyCode === code)).toBe(false);
  });

  it('should successfully add currencies without optional fields', async () => {
    const allCurrencies = await helpers.getAllCurrencies();
    const uah = allCurrencies.find((i) => i.code === 'UAH')!;

    const res = await helpers.addUserCurrenciesWithRates({
      currencies: [{ currencyCode: uah.code }],
      raw: false,
    });

    expect(res.statusCode).toEqual(200);
    const returnedValues = helpers.extractResponse(res).currencies;
    expect(returnedValues.length).toBe(1);
    expect(returnedValues[0]!.currencyCode).toBe(uah.code);
    expect(returnedValues[0]!.exchangeRate).toBeNull();
    expect(returnedValues[0]!.liveRateUpdate).toBe(true);
  });

  it('keeps a single connection when the same currency is added by concurrent requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => helpers.addUserCurrencies({ currencyCodes: ['EUR'] })),
    );

    expect(responses.every((res) => res.statusCode === 200)).toBe(true);

    const userCurrencies = await helpers.getUserCurrencies();
    expect(userCurrencies.filter((item) => item.currencyCode === 'EUR')).toHaveLength(1);
  });

  it('should successfully resolve when trying to add duplicate currencies', async () => {
    // First, add a currency
    const allCurrencies = await helpers.getAllCurrencies();
    const uah = allCurrencies.find((i) => i.code === 'UAH')!;
    const currencies = [{ currencyCode: uah.code }];

    await helpers.addUserCurrenciesWithRates({
      currencies,
      raw: false,
    });

    // Try to add the same currency again
    const res = await helpers.addUserCurrenciesWithRates({
      currencies,
      raw: false,
    });

    expect(res.statusCode).toEqual(200);
    expect(helpers.extractResponse(res).alreadyExistingCodes).toEqual(currencies.map((i) => i.currencyCode));
  });

  it('should successfully resolve when trying to add a currency same as base currency', async () => {
    const currencies = [{ currencyCode: global.BASE_CURRENCY.code }];

    const res = await helpers.addUserCurrenciesWithRates({
      currencies,
      raw: false,
    });

    expect(res.statusCode).toEqual(200);
  });
});
