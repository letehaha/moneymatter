import { TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';

type RemeasureBody = { remeasure: { updated: number; failed: number } };

// Account ref balances are measured in the user's base currency, so the rate a
// remeasure needs for a EUR account is EUR to base.
const CUSTOM_EUR_TO_BASE = 5;
const CUSTOM_BASE_TO_EUR = 0.2;

const buildCustomRatePairs = () => {
  const baseCode = global.BASE_CURRENCY!.code;
  return [
    { baseCode: 'EUR', quoteCode: baseCode, rate: CUSTOM_EUR_TO_BASE },
    { baseCode: baseCode, quoteCode: 'EUR', rate: CUSTOM_BASE_TO_EUR },
  ];
};

const createEurAccountWithIncome = async () => {
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'EUR' }),
    raw: true,
  });
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 100,
      transactionType: TRANSACTION_TYPES.income,
    }),
    raw: true,
  });
  return account;
};

const TODAY = startOfDay(new Date());
const DEPOSIT_DATE = subDays(TODAY, 60);
const SEEDED_DATES = [DEPOSIT_DATE, TODAY];

const CUSTOM_INR_TO_AED = 0.5;
const EDITED_INR_TO_AED = 0.25;

const HOLDINGS_INR = 100_000;
const HOLDINGS_INR_CENTS = HOLDINGS_INR * 100;

const seedMarketRates = () => helpers.seedInrAedRates({ depositDate: DEPOSIT_DATE, laterDates: [TODAY] });

const setCustomRate = ({ inrToAed }: { inrToAed: number }) =>
  helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: 'INR', quoteCode: 'AED', rate: inrToAed },
      { baseCode: 'AED', quoteCode: 'INR', rate: 1 / inrToAed },
    ],
    raw: true,
  });

const createInrAccountWithHoldings = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['INR'] });
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'INR' }),
    raw: true,
  });

  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: HOLDINGS_INR,
      transactionType: TRANSACTION_TYPES.income,
      time: DEPOSIT_DATE.toISOString(),
    }),
    raw: true,
  });

  return account;
};

describe('Edit currency exchange rate controller', () => {
  it('should fail editing currency exchange rates for non-connected currencies', async () => {
    const pairs = [
      { baseCode: 'USD', quoteCode: 'EUR', rate: 0.85 },
      { baseCode: 'EUR', quoteCode: 'USD', rate: 1.18 },
    ];
    const res = await helpers.editCurrencyExchangeRate({ pairs });
    expect(res.statusCode).toEqual(ERROR_CODES.NotFoundError);
  });

  describe('', () => {
    beforeEach(async () => {
      // Setup: Ensure the user has the necessary currencies
      await helpers.addUserCurrencies({ currencyCodes: ['USD', 'EUR', 'GBP'] });
    });

    it('should successfully edit currency exchange rates', async () => {
      const allCurrencies = await helpers.getAllCurrencies();
      const eur = allCurrencies.find((i) => i.code === 'EUR')!;

      await helpers.makeRequest({
        method: 'post',
        url: '/user/currencies',
        payload: {
          currencies: [{ currencyCode: eur.code }],
        },
        raw: false,
      });

      const pairs = [
        { baseCode: 'USD', quoteCode: 'EUR', rate: 0.85 },
        { baseCode: 'EUR', quoteCode: 'USD', rate: 1.18 },
      ];

      const res = await helpers.editCurrencyExchangeRate({ pairs });

      expect(res.statusCode).toEqual(200);

      // Verify that edition request returned edited currencies. The response is an
      // object: the edited rates plus the ref-balance remeasure counts.
      const { rates: returnedValues } = helpers.extractResponse(res);
      expect(['USD', 'EUR'].every((code) => returnedValues.map((r) => r.baseCode === code))).toBe(true);

      const usdEurRate = returnedValues.find((rate) => rate.baseCode === 'USD' && rate.quoteCode === 'EUR')!;
      const eurUsdRate = returnedValues.find((rate) => rate.baseCode === 'EUR' && rate.quoteCode === 'USD')!;

      expect(usdEurRate.rate).toBeCloseTo(0.85);
      expect(eurUsdRate.rate).toBeCloseTo(1.18);
    });

    it('rejects an unknown code, an identical base/quote pair and a missing inverse pair', async () => {
      const invalidCode = await helpers.editCurrencyExchangeRate({
        pairs: [{ baseCode: 'USD', quoteCode: 'INVALID', rate: 1.5 }],
      });
      expect(invalidCode.statusCode).toEqual(ERROR_CODES.ValidationError);

      const samePair = await helpers.editCurrencyExchangeRate({
        pairs: [{ baseCode: 'USD', quoteCode: 'USD', rate: 1 }],
      });
      expect(samePair.statusCode).toEqual(ERROR_CODES.ValidationError);

      const missingOpposite = await helpers.editCurrencyExchangeRate({
        pairs: [{ baseCode: 'USD', quoteCode: 'EUR', rate: 0.85 }],
      });
      expect(missingOpposite.statusCode).toEqual(ERROR_CODES.ValidationError);
    });

    it('rejects removing one direction of a pair without its opposite', async () => {
      const oneSided = await helpers.removeCurrencyExchangeRate({
        pairs: [{ baseCode: 'USD', quoteCode: 'EUR' }],
      });

      expect(oneSided.statusCode).toEqual(ERROR_CODES.ValidationError);
      expect((oneSided.body.response as unknown as { message: string }).message).toMatch(/opposite pair/);
    });

    it('should return error when trying to edit non-existent currency pair', async () => {
      const pairs = [
        { baseCode: 'USD', quoteCode: 'JPY', rate: 110 },
        { baseCode: 'JPY', quoteCode: 'USD', rate: 0.0091 },
      ];

      const res = await helpers.editCurrencyExchangeRate({ pairs });

      expect(res.statusCode).toEqual(ERROR_CODES.NotFoundError);
    });
  });

  /**
   * The custom-rate edit and remove endpoints re-anchor account `ref*` balances via
   * `remeasureRefBalances` and report `{ updated, failed }`. An account whose currency
   * has no market rate keeps its stale value and counts as `failed`; the rate write
   * still commits.
   */
  describe('Custom-rate endpoints surface the ref-balance remeasure result', () => {
    it('reports remeasure.failed when removing a custom rate leaves an account with no market rate', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });

      // Create the account and income at the market rate first: that conversion marks
      // today's rate basket as fully fetched, so the post-delete remeasure cannot
      // re-fetch and heal the EUR rows this test strips.
      await createEurAccountWithIncome();

      await helpers.updateUserCurrency({
        currency: { currencyCode: 'EUR', liveRateUpdate: false },
        raw: true,
      });
      await helpers.editCurrencyExchangeRate({ pairs: buildCustomRatePairs() });

      // Drop every stored EUR row to simulate a total FX-data gap. ExchangeRates is a
      // seed table shared across tests on this worker, so the rows are snapshotted here
      // and re-inserted in `finally`.
      const [eurRates] = (await connection.sequelize.query(
        `SELECT "baseCode", "quoteCode", "date", "rate", "source"
         FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`,
      )) as [Array<Record<string, unknown>>, unknown];

      try {
        await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`);

        const baseCode = global.BASE_CURRENCY!.code;
        const res = await helpers.removeCurrencyExchangeRate({
          pairs: [
            { baseCode: 'EUR', quoteCode: baseCode },
            { baseCode: baseCode, quoteCode: 'EUR' },
          ],
        });

        expect(res.statusCode).toBe(200);
        const body = helpers.extractResponse<RemeasureBody>(res);
        expect(body.remeasure.failed).toBeGreaterThanOrEqual(1);
      } finally {
        for (const row of eurRates) {
          await connection.sequelize.query(
            `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
             VALUES (:baseCode, :quoteCode, :date, :rate, :source)`,
            { replacements: row },
          );
        }
      }
    });

    it('reports remeasure.updated with zero failures when editing a custom rate with rates present', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
      await helpers.updateUserCurrency({
        currency: { currencyCode: 'EUR', liveRateUpdate: false },
        raw: true,
      });

      // Creating the account before any custom rate stamps its ref balance at the
      // market rate, so the edit below moves it and the remeasure counts it.
      await createEurAccountWithIncome();

      const res = await helpers.editCurrencyExchangeRate({ pairs: buildCustomRatePairs() });

      expect(res.statusCode).toBe(200);
      const body = helpers.extractResponse<RemeasureBody>(res);
      expect(body.remeasure.updated).toBeGreaterThanOrEqual(1);
      expect(body.remeasure.failed).toBe(0);
    });
  });

  /** A manual `INR → AED` rate re-prices every stored day of an INR account's balance history. */
  describe('Custom exchange rate and foreign-currency balance history', () => {
    afterEach(async () => {
      await helpers.clearExchangeRatesForDates({ dates: SEEDED_DATES });
    });

    it('re-prices the whole stored history when the manual rate is edited', async () => {
      await seedMarketRates();
      const account = await createInrAccountWithHoldings();

      await setCustomRate({ inrToAed: CUSTOM_INR_TO_AED });

      const afterSet = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
      expect(helpers.balanceCentsOn({ rows: afterSet, date: DEPOSIT_DATE })).toEqualRefValue(
        HOLDINGS_INR_CENTS * CUSTOM_INR_TO_AED,
      );
      expect(helpers.balanceCentsOn({ rows: afterSet, date: TODAY })).toEqualRefValue(
        HOLDINGS_INR_CENTS * CUSTOM_INR_TO_AED,
      );

      await setCustomRate({ inrToAed: EDITED_INR_TO_AED });

      const afterEdit = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
      expect(helpers.balanceCentsOn({ rows: afterEdit, date: DEPOSIT_DATE })).toEqualRefValue(
        HOLDINGS_INR_CENTS * EDITED_INR_TO_AED,
      );
      expect(helpers.balanceCentsOn({ rows: afterEdit, date: TODAY })).toEqualRefValue(
        HOLDINGS_INR_CENTS * EDITED_INR_TO_AED,
      );
    });

    it('falls back to per-day market rates when the manual rate is removed', async () => {
      await seedMarketRates();
      const account = await createInrAccountWithHoldings();

      await setCustomRate({ inrToAed: CUSTOM_INR_TO_AED });

      await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'INR', quoteCode: 'AED' },
          { baseCode: 'AED', quoteCode: 'INR' },
        ],
        raw: true,
      });

      const rows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

      expect(helpers.balanceCentsOn({ rows, date: DEPOSIT_DATE })).toEqualRefValue(
        HOLDINGS_INR_CENTS * helpers.INR_TO_AED_AT_DEPOSIT,
      );
      expect(helpers.balanceCentsOn({ rows, date: TODAY })).toEqualRefValue(
        HOLDINGS_INR_CENTS * helpers.INR_TO_AED_AFTER,
      );
    });
  });
});
