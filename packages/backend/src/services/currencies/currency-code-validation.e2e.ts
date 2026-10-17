import {
  AccountOptionValue,
  CategoryOptionValue,
  type ColumnMappingConfig,
  CurrencyOptionValue,
  SUBSCRIPTION_FREQUENCIES,
  TRANSACTION_TYPES,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Securities from '@models/investments/securities.model';
import UsersCurrencies from '@models/users-currencies.model';
import * as helpers from '@tests/helpers';
import { type CustomResponse } from '@tests/helpers/common';

// A user-defined BTC owned by the primary user. The second user never holds it.
const CUSTOM_CODE = 'BTC';

const messageOf = (response: unknown): string =>
  (response as CustomResponse<{ message: string }>).body.response.message;

describe('currency code validation against the database', () => {
  beforeEach(async () => {
    const { id: userId } = await helpers.getUserInfo({ raw: true });
    await helpers.seedCustomCurrencyRow({ code: CUSTOM_CODE, name: 'Bitcoin', digits: 8, createdByUserId: userId });
    await UsersCurrencies.create({
      userId,
      currencyCode: CUSTOM_CODE,
      isDefaultCurrency: false,
      liveRateUpdate: false,
    });
  });

  afterEach(async () => {
    await helpers.removeCustomCurrencyRow({ code: CUSTOM_CODE });
  });

  const setManualRate = async () => {
    const base = global.BASE_CURRENCY.code;
    await helpers.editUserCurrencyExchangeRate({
      pairs: [
        { baseCode: CUSTOM_CODE, quoteCode: base, rate: 60000 },
        { baseCode: base, quoteCode: CUSTOM_CODE, rate: 1 / 60000 },
      ],
    });
  };

  describe('an unknown code', () => {
    it('is rejected with 422 on account creation, and the message lists the choices the user has', async () => {
      const unknown = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'ZZZ' }),
        raw: false,
      });

      expect(unknown.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(messageOf(unknown)).toContain('Invalid currency code "ZZZ"');
      expect(messageOf(unknown)).toContain('ISO 4217');
      expect(messageOf(unknown)).toContain(CUSTOM_CODE);
    });

    it('names only the ISO choice to a user without custom currencies', async () => {
      const other = await helpers.signUpSecondUser();

      const unknown = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.createAccount({ payload: helpers.buildAccountPayload({ currencyCode: 'ZZZ' }), raw: false }),
      });

      expect(unknown.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(messageOf(unknown)).toContain('Invalid currency code "ZZZ"');
      expect(messageOf(unknown)).not.toContain('custom currencies');
    });

    it('is rejected on every write that takes a code', async () => {
      const account = await helpers.createAccount({ raw: true });

      const transaction = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 10,
          originalAmount: 5,
          originalCurrencyCode: 'ZZZ',
        }),
      });
      const template = await helpers.createTransactionTemplate({
        payload: { name: 'Template', transactionType: TRANSACTION_TYPES.expense, originalCurrencyCode: 'ZZZ' },
      });
      const subscription = await helpers.createSubscription({
        name: 'Sub',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2026-01-01',
        expectedAmount: 5,
        expectedCurrencyCode: 'ZZZ',
      });
      const userCurrency = await helpers.addUserCurrencies({ currencyCodes: ['ZZZ'] });
      const rates = await helpers.makeRequest({
        method: 'put',
        url: '/user/currency/rates',
        payload: {
          pairs: [
            { baseCode: 'ZZZ', quoteCode: 'USD', rate: 2 },
            { baseCode: 'USD', quoteCode: 'ZZZ', rate: 0.5 },
          ],
        },
      });

      for (const response of [transaction, template, subscription, userCurrency, rates]) {
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(messageOf(response)).toContain('Invalid currency code "ZZZ"');
      }
    });

    it('is rejected on the pair-rate lookup', async () => {
      const response = await helpers.getExchangeRatePair({ from: 'ZZZ', to: 'USD', date: '2024-01-15' });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(messageOf(response)).toContain('Invalid currency code "ZZZ"');
    });

    it('is rejected by the request schema when the code is malformed', async () => {
      const response = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: 'US-D' }),
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe("another user's custom code", () => {
    it('is rejected exactly like an unknown code, so its existence is not revealed', async () => {
      const other = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const account = await helpers.createAccount({ raw: true });

          const createAccount = await helpers.createAccount({
            payload: helpers.buildAccountPayload({ currencyCode: CUSTOM_CODE }),
            raw: false,
          });
          const attach = await helpers.addUserCurrencies({ currencyCodes: [CUSTOM_CODE] });
          const transaction = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 10,
              originalAmount: 5,
              originalCurrencyCode: CUSTOM_CODE,
            }),
          });
          const pair = await helpers.getExchangeRatePair({ from: CUSTOM_CODE, to: 'USD', date: '2024-01-15' });

          for (const response of [createAccount, attach, transaction, pair]) {
            expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
            expect(messageOf(response)).toContain(`Invalid currency code "${CUSTOM_CODE}"`);
          }

          const userCurrencies = await helpers.getUserCurrencies();
          expect(userCurrencies.map((item) => item.currencyCode)).not.toContain(CUSTOM_CODE);
        },
      });
    });

    it('is rejected by the CSV import steps', async () => {
      const other = await helpers.signUpSecondUser();

      const response = await helpers.asUser({
        cookies: other.cookies,
        fn: () => extractCsvCurrencies({ currencyCell: CUSTOM_CODE }),
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(messageOf(response)).toContain(CUSTOM_CODE);
    });
  });

  describe('the owner of a custom code', () => {
    it('creates an account in it and imports a CSV into that account', async () => {
      await setManualRate();

      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ currencyCode: CUSTOM_CODE }),
        raw: true,
      });
      expect(account.currencyCode).toBe(CUSTOM_CODE);

      const extracted = await extractCsvCurrencies({ currencyCell: CUSTOM_CODE });
      expect(extracted.statusCode).toBe(200);

      const summary = await helpers.runCsvImport({ accountId: account.id, currencyCode: CUSTOM_CODE });
      expect(summary.imported).toBe(2);
    });

    it('can also pick it as the default currency of the CSV, and another user cannot', async () => {
      const payload = {
        fileContent: ['Date,Amount,Description,Category,Account,Type', '2024-01-15,10.00,Coffee,,A,expense'].join('\n'),
        delimiter: ',',
        columnMapping: csvColumnMapping({
          currency: { option: CurrencyOptionValue.existingCurrency, currencyCode: CUSTOM_CODE },
        }),
      };

      const asOwner = await helpers.extractUniqueValues({ payload });
      expect(asOwner.statusCode).toBe(200);

      const other = await helpers.signUpSecondUser();
      const asOther = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.extractUniqueValues({ payload }),
      });
      expect(asOther.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('contexts that accept ISO 4217 codes only', () => {
    it('rejects a custom code, even for the user that owns it', async () => {
      const portfolio = await helpers.createPortfolio({ payload: { displayCurrencyCode: CUSTOM_CODE } });
      const deal = await helpers.createVentureDeal({ payload: { currencyCode: CUSTOM_CODE } });
      const baseCurrency = await helpers.changeBaseCurrency({ newCurrencyCode: CUSTOM_CODE });

      for (const response of [portfolio, deal, baseCurrency]) {
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });

    it('does not attach a custom currency through a security quoted in the same code', async () => {
      const security = await Securities.create({
        symbol: 'BTCX',
        providerSymbol: 'BTCX',
        name: 'BTC tracker',
        currencyCode: CUSTOM_CODE,
        providerName: SECURITY_PROVIDER.yahoo,
        assetClass: ASSET_CLASS.stocks,
      });
      const portfolio = await helpers.createPortfolio({ raw: true });

      const holding = await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security.id } });

      expect(holding.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});

const csvColumnMapping = ({ currency }: { currency: ColumnMappingConfig['currency'] }): ColumnMappingConfig => ({
  date: 'Date',
  dateFieldOrder: 'month-first',
  amount: 'Amount',
  description: 'Description',
  category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
  currency,
  transactionType: {
    option: TransactionTypeOptionValue.dataSourceColumn,
    columnName: 'Type',
    incomeValues: ['income'],
    expenseValues: ['expense'],
  },
  account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
});

const extractCsvCurrencies = ({ currencyCell }: { currencyCell: string }) =>
  helpers.extractUniqueValues({
    payload: {
      fileContent: [
        'Date,Amount,Description,Category,Account,Currency,Type',
        `2024-01-15,10.00,Coffee,,A,${currencyCell},expense`,
      ].join('\n'),
      delimiter: ',',
      columnMapping: csvColumnMapping({
        currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
      }),
    },
  });
