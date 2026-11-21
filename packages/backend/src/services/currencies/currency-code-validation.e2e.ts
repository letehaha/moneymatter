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
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Securities from '@models/investments/securities.model';
import * as helpers from '@tests/helpers';
import { type CustomResponse } from '@tests/helpers/common';

// A user-defined BTC owned by the primary user. The second user never holds it.
const CUSTOM_CODE = 'BTC';

const messageOf = (response: unknown): string =>
  (response as CustomResponse<{ message: string }>).body.response.message;

describe('currency code validation against the database', () => {
  beforeEach(async () => {
    await helpers.createCustomCurrency({
      payload: { code: CUSTOM_CODE, name: 'Bitcoin', decimals: 8, rate: { value: 60000 } },
      raw: true,
    });
  });

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

    it('is rejected on every update path and on the creates that store a code', async () => {
      const other = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const account = await helpers.createAccount({ raw: true });
          const [transaction] = await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 10,
              categoryId: (await helpers.getCategoriesList())[0]!.id,
            }),
            raw: true,
          });
          const template = await helpers.createTransactionTemplate({
            payload: { name: 'Template', transactionType: TRANSACTION_TYPES.expense },
            raw: true,
          });
          const subscription = await helpers.createSubscription({
            name: 'Sub',
            frequency: SUBSCRIPTION_FREQUENCIES.monthly,
            startDate: '2026-01-01',
            expectedAmount: 5,
            expectedCurrencyCode: global.BASE_CURRENCY.code,
            raw: true,
          });
          const goal = await helpers.createGoal({ raw: true });
          const automation = await helpers.createAutomation({
            payload: {
              name: 'Rule',
              conditions: { match: 'all', items: [{ field: 'note', operator: 'contains_any', value: ['coffee'] }] },
              actions: [{ type: 'set_note', mode: 'append', value: 'automated' }],
            },
            raw: true,
          });
          const amountRule = { field: 'amount' as const, operator: 'between' as const, value: { min: 1, max: 2 } };
          const amountConditions = {
            match: 'all' as const,
            items: [
              {
                field: 'amount' as const,
                operator: 'gte' as const,
                value: { min: 1 },
                currency: { mode: 'specific' as const, code: CUSTOM_CODE },
              },
            ],
          };

          const responses = [
            await helpers.updateTransaction({
              id: transaction!.id,
              payload: { originalAmount: 5, originalCurrencyCode: CUSTOM_CODE },
            }),
            await helpers.updateTransactionTemplate({
              id: template.id,
              payload: { originalCurrencyCode: CUSTOM_CODE },
            }),
            await helpers.updateSubscription({
              id: subscription.id,
              expectedAmount: 5,
              expectedCurrencyCode: CUSTOM_CODE,
            }),
            await helpers.updateSubscription({
              id: subscription.id,
              matchingRules: { rules: [{ ...amountRule, currencyCode: CUSTOM_CODE }] },
            }),
            await helpers.createSubscription({
              name: 'Sub with rule',
              frequency: SUBSCRIPTION_FREQUENCIES.monthly,
              startDate: '2026-01-01',
              expectedAmount: 5,
              expectedCurrencyCode: global.BASE_CURRENCY.code,
              matchingRules: { rules: [{ ...amountRule, currencyCode: CUSTOM_CODE }] },
            }),
            await helpers.createGoal({ payload: { currencyCode: CUSTOM_CODE } }),
            await helpers.updateGoal({ goalId: goal.id, payload: { currencyCode: CUSTOM_CODE } }),
            await helpers.updateAutomation({ id: automation.id, payload: { conditions: amountConditions } }),
            await helpers.editCurrencyExchangeRate({
              pairs: [
                { baseCode: CUSTOM_CODE, quoteCode: global.BASE_CURRENCY.code, rate: 2 },
                { baseCode: global.BASE_CURRENCY.code, quoteCode: CUSTOM_CODE, rate: 0.5 },
              ],
            }),
            await helpers.createTransactionTemplate({
              payload: {
                name: 'Foreign template',
                transactionType: TRANSACTION_TYPES.expense,
                originalCurrencyCode: CUSTOM_CODE,
              },
            }),
            await helpers.createAutomation({
              payload: {
                name: 'Rule in a foreign code',
                conditions: amountConditions,
                actions: [{ type: 'set_note', mode: 'append', value: 'automated' }],
              },
            }),
          ];

          for (const response of responses) {
            expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
            expect((response as CustomResponse<{ details: unknown }>).body.response.details).toEqual({
              rejectedCodes: [CUSTOM_CODE],
            });
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

    it('fails the CSV and YNAB execute jobs that would create an account in it, and creates none', async () => {
      const other = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });

          const csv = await helpers.executeImport({
            payload: {
              fileContent: [
                'Date,Amount,Description,Category,Account,Currency,Type',
                `2024-01-15,10.00,Coffee,,A,${CUSTOM_CODE},expense`,
              ].join('\n'),
              delimiter: ',',
              columnMapping: csvColumnMapping({
                currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
              }),
              accountMapping: { A: { action: 'create-new', currentBalance: null } },
              categoryMapping: {},
              skipDuplicateIndices: [],
              recalculateBalance: false,
            },
            raw: true,
          });
          const csvProgress = await helpers.waitForCsvImportCompletion({ jobId: csv.jobId });

          const ynab = await helpers.executeYnab({
            payload: {
              fileContent: [
                '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
                '"Wallet","","06/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",0.00,100.00,"Cleared"',
                '"Wallet","","06/02/2026","Cafe","Wants: Dining","Wants","Dining","Coffee",3.50,0.00,"Cleared"',
              ].join('\n'),
              accountMapping: { Wallet: { currencyCode: CUSTOM_CODE } },
            },
            raw: true,
          });
          const ynabProgress = await helpers.waitForYnabImportCompletion({ jobId: ynab.jobId });

          for (const progress of [csvProgress, ynabProgress]) {
            expect(progress).toMatchObject({ status: 'failed', error: expect.stringContaining(`"${CUSTOM_CODE}"`) });
          }
          expect(await helpers.getAccounts()).toHaveLength(0);
        },
      });
    });

    it('is dropped as the original currency of a statement import row', async () => {
      const other = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
          const account = await helpers.createAccount({ raw: true });

          const result = await helpers.statementExecuteImportAndWait({
            payload: {
              accountId: account.id,
              transactions: [
                {
                  date: '2024-01-15 10:30:00',
                  description: 'Swap',
                  amount: 10,
                  type: 'expense',
                  originalAmount: 0.001,
                  originalCurrencyCode: CUSTOM_CODE,
                },
              ],
              skipIndices: [],
            },
          });

          expect(result.imported).toBe(1);
          const imported = (await helpers.getTransactions({ raw: true })).find((tx) =>
            result.newTransactionIds.includes(tx.id),
          );
          expect(imported).toMatchObject({ originalAmount: null, originalCurrencyCode: null });
        },
      });
    });
  });

  describe('the owner of a custom code', () => {
    it('creates an account in it and imports a CSV into that account', async () => {
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
