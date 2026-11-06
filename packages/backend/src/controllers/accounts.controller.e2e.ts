import type { RecordId } from '@bt/shared/types';
import { ACCOUNT_CATEGORIES, ACCOUNT_TYPES, API_ERROR_CODES, TRANSACTION_TYPES, VEHICLE_CLASS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { addDays, format, subDays } from 'date-fns';

const DEFAULT_TX_AMOUNT = 1000;

async function createSecondUser(): Promise<string> {
  const signupRes = await helpers.makeAuthRequest({
    method: 'post',
    url: '/auth/sign-up/email',
    payload: {
      email: `user2-${Date.now()}@test.local`,
      password: 'testpassword123',
      name: 'Second User',
    },
  });
  return helpers.extractCookies(signupRes);
}

async function asUser<T>({ cookies, fn }: { cookies: string; fn: () => Promise<T> }): Promise<T> {
  const original = global.APP_AUTH_COOKIES;
  global.APP_AUTH_COOKIES = cookies;
  try {
    return await fn();
  } finally {
    global.APP_AUTH_COOKIES = original;
  }
}

async function createExpenseTransactions({ accountId, count }: { accountId: RecordId; count: number }) {
  for (const index in Array(count).fill(0)) {
    await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId, amount: DEFAULT_TX_AMOUNT }),
        time: addDays(new Date(), +index + 1).toISOString(),
      },
    });
  }
}

const centsByDate = ({ rows }: { rows: { date: string | Date; amount: unknown }[] }) =>
  new Map(rows.map((row) => [String(row.date).slice(0, 10), Math.round(Number(row.amount) * 100)]));

const createBaseAccount = ({ initialBalance }: { initialBalance: number }) =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance }), raw: true });

async function expectRejected({
  id,
  payload,
}: {
  id: string;
  payload: { initialBalance: number; currentBalance?: number; accountCategory?: ACCOUNT_CATEGORIES };
}) {
  const before = await helpers.getAccount({ id, raw: true });
  const historyBefore = await helpers.getBalanceHistory({ accountId: id, raw: true });
  const res = await helpers.updateAccount<helpers.ErrorResponse>({ id, payload });
  expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
  expect(await helpers.getAccount({ id, raw: true })).toStrictEqual(before);
  expect(await helpers.getBalanceHistory({ accountId: id, raw: true })).toStrictEqual(historyBefore);
}

describe('Accounts controller', () => {
  describe('create account', () => {
    const initialBalance = 1000;
    const creditLimit = 500;

    it('should correctly create account with correct balance for default currency', async () => {
      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          initialBalance,
          creditLimit,
        },
        raw: true,
      });

      expect(account.initialBalance).toStrictEqual(initialBalance);
      expect(account.refInitialBalance).toStrictEqual(initialBalance);
      expect(account.currentBalance).toStrictEqual(initialBalance);
      expect(account.refCurrentBalance).toStrictEqual(initialBalance);
      expect(account.creditLimit).toStrictEqual(creditLimit);
      expect(account.refCreditLimit).toStrictEqual(creditLimit);
    });
    it('should correctly create account with correct balance for external currency', async () => {
      const currency = (await helpers.addUserCurrencies({ currencyCodes: ['UAH'], raw: true })).currencies[0]!;

      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          initialBalance,
          creditLimit,
          currencyCode: currency.currencyCode,
        },
        raw: true,
      });

      const currencyRate = (await helpers.getCurrenciesRates({ codes: ['UAH'] }))[0];

      expect(account.initialBalance).toStrictEqual(initialBalance);
      expect(account.refInitialBalance).toEqualRefValue(initialBalance * currencyRate!.rate);
      expect(account.currentBalance).toStrictEqual(initialBalance);
      expect(account.refCurrentBalance).toEqualRefValue(initialBalance * currencyRate!.rate);
      expect(account.creditLimit).toStrictEqual(creditLimit);
      expect(account.refCreditLimit).toEqualRefValue(creditLimit * currencyRate!.rate);
    });

    it('rejects negative creditLimit on creation', async () => {
      const res = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          creditLimit: -100,
        },
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it.each(['', '   '])('rejects empty name %j on creation', async (name) => {
      const res = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), name },
        raw: false,
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('accepts balances above the legacy 32-bit INTEGER ceiling', async () => {
      // Regression: SequelizeDatabaseError "value … is out of range for type integer".
      // 25_000_000 decimal → 2_500_000_000 cents, comfortably above the old
      // 2_147_483_647 cap; common for low-denomination currencies (IDR, VND).
      const LARGE_BALANCE = 25_000_000;

      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          initialBalance: LARGE_BALANCE,
          creditLimit: LARGE_BALANCE,
        },
        raw: true,
      });

      expect(account.initialBalance).toStrictEqual(LARGE_BALANCE);
      expect(account.refInitialBalance).toStrictEqual(LARGE_BALANCE);
      expect(account.currentBalance).toStrictEqual(LARGE_BALANCE);
      expect(account.refCurrentBalance).toStrictEqual(LARGE_BALANCE);
      expect(account.creditLimit).toStrictEqual(LARGE_BALANCE);
      expect(account.refCreditLimit).toStrictEqual(LARGE_BALANCE);
    });
  });
  describe('update account', () => {
    it('should return 404 if try to update unexisting account', async () => {
      const res = await helpers.updateAccount<helpers.ErrorResponse>({
        id: generateRandomRecordId(),
      });

      expect(res.statusCode).toEqual(ERROR_CODES.NotFoundError);
      expect(helpers.extractResponse(res).code).toEqual(API_ERROR_CODES.notFound);
    });

    it.each(['', '   '])('rejects empty name %j on update', async (name) => {
      const account = await helpers.createAccount({ raw: true });
      const res = await helpers.updateAccount<helpers.ErrorResponse>({ id: account.id, payload: { name } });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getAccount({ id: account.id, raw: true })).name).toBe(account.name);
    });

    it('should just ignore if no data passed', async () => {
      const account = await helpers.createAccount({ raw: true });
      const updatedAccount = await helpers.updateAccount({
        id: account.id,
        payload: {},
        raw: true,
      });

      expect(account).toStrictEqual(updatedAccount);
    });

    it('updates account correctly with default user currency', async () => {
      const newBasicFieldsValues = {
        name: 'new test',
      };
      const account = await helpers.createAccount({ raw: true });
      const updatedAccount = await helpers.updateAccount({
        id: account.id,
        payload: newBasicFieldsValues,
        raw: true,
      });

      expect(updatedAccount).toStrictEqual({
        ...account,
        ...newBasicFieldsValues,
      });

      await createExpenseTransactions({ accountId: account.id, count: 3 });

      const accountAfterTxs = await helpers.getAccount({
        id: account.id,
        raw: true,
      });
      expect(accountAfterTxs.initialBalance).toBe(0);
      expect(accountAfterTxs.refInitialBalance).toBe(0);
      expect(accountAfterTxs.currentBalance).toBe(-3000);
      expect(accountAfterTxs.refCurrentBalance).toBe(-3000);

      // Update account balance directly, with no tx usage. In that case balance should
      // be changed as well as initialBalance
      const accountUpdateBalance = await helpers.updateAccount({
        id: account.id,
        payload: {
          currentBalance: -500,
        },
        raw: true,
      });

      // We changed currentBalance from -3000 to -500, so it means that
      // initialbalance should be increased on 2500
      expect(accountUpdateBalance.initialBalance).toBe(2500);
      expect(accountUpdateBalance.refInitialBalance).toBe(2500);
      expect(accountUpdateBalance.currentBalance).toBe(-500);
      expect(accountUpdateBalance.refCurrentBalance).toBe(-500);
    });
    it('updates account correctly with non-default user currency', async () => {
      const newCurrency = 'UAH';
      const currency = (
        await helpers.addUserCurrencies({
          currencyCodes: [newCurrency],
          raw: true,
        })
      ).currencies[0];
      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          currencyCode: currency!.currencyCode,
        },
        raw: true,
      });

      await createExpenseTransactions({ accountId: account.id, count: 3 });

      const accountAfterTxs = await helpers.getAccount({
        id: account.id,
        raw: true,
      });
      const currencyRate = (await helpers.getCurrenciesRates({ codes: [newCurrency] }))[0]!.rate;
      expect(accountAfterTxs.initialBalance).toBe(0);
      expect(accountAfterTxs.refInitialBalance).toBe(0);
      expect(accountAfterTxs.currentBalance).toBe(-3000);
      expect(accountAfterTxs.refCurrentBalance).toEqualRefValue(-3000 * currencyRate);

      // Update account balance directly, with no tx usage. In that case balance should
      // be changed as well as initialBalance
      const accountUpdateBalance = await helpers.updateAccount({
        id: account.id,
        payload: {
          currentBalance: -500,
        },
        raw: true,
      });

      // We changed currentBalance from -3000 to -500, so it means that
      // initialbalance should be increased on 2500
      expect(accountUpdateBalance.initialBalance).toBe(2500);
      expect(accountUpdateBalance.refInitialBalance).toEqualRefValue(2500 * currencyRate);
      expect(accountUpdateBalance.currentBalance).toBe(-500);
      expect(accountUpdateBalance.refCurrentBalance).toEqualRefValue(-500 * currencyRate);
    });

    it('rejects negative creditLimit', async () => {
      const account = await helpers.createAccount({ raw: true });
      const res = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: -100 },
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('does not change balances when creditLimit changes (raised, zeroed, with existing transactions)', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          initialBalance: 1000,
          creditLimit: 500,
        }),
        raw: true,
      });

      const raised = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 800 },
        raw: true,
      });

      // Credit limit is separate from balance — only creditLimit and
      // refCreditLimit change, all balance fields stay untouched
      expect(raised.creditLimit).toBe(800);
      expect(raised.currentBalance).toBe(account.currentBalance);
      expect(raised.refCurrentBalance).toBe(account.refCurrentBalance);
      expect(raised.initialBalance).toBe(account.initialBalance);
      expect(raised.refInitialBalance).toBe(account.refInitialBalance);

      const zeroed = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 0 },
        raw: true,
      });

      expect(zeroed.creditLimit).toBe(0);
      expect(zeroed.refCreditLimit).toBe(0);
      expect(zeroed.currentBalance).toBe(account.currentBalance);
      expect(zeroed.refCurrentBalance).toBe(account.refCurrentBalance);
      expect(zeroed.initialBalance).toBe(account.initialBalance);
      expect(zeroed.refInitialBalance).toBe(account.refInitialBalance);

      await createExpenseTransactions({ accountId: account.id, count: 3 });

      const afterTxs = await helpers.getAccount({ id: account.id, raw: true });
      expect(afterTxs.currentBalance).toBe(-2000);

      const updated = await helpers.updateAccount({
        id: afterTxs.id,
        payload: { creditLimit: 1000 },
        raw: true,
      });

      expect(updated.creditLimit).toBe(1000);
      expect(updated.currentBalance).toBe(afterTxs.currentBalance);
      expect(updated.refCurrentBalance).toBe(afterTxs.refCurrentBalance);
      expect(updated.initialBalance).toBe(afterTxs.initialBalance);
      expect(updated.refInitialBalance).toBe(afterTxs.refInitialBalance);
    }, 30_000);

    it('recalculates refCreditLimit for non-base currency', async () => {
      const newCurrency = 'UAH';
      const currency = (await helpers.addUserCurrencies({ currencyCodes: [newCurrency], raw: true })).currencies[0]!;

      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          initialBalance: 1000,
          creditLimit: 500,
          currencyCode: currency.currencyCode,
        },
        raw: true,
      });

      const currencyRate = (await helpers.getCurrenciesRates({ codes: [newCurrency] }))[0]!.rate;

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 800 },
        raw: true,
      });

      expect(updated.creditLimit).toBe(800);
      expect(updated.refCreditLimit).toEqualRefValue(800 * currencyRate);
      // All balance fields unchanged
      expect(updated.currentBalance).toBe(account.currentBalance);
      expect(updated.refCurrentBalance).toBe(account.refCurrentBalance);
      expect(updated.initialBalance).toBe(account.initialBalance);
      expect(updated.refInitialBalance).toBe(account.refInitialBalance);
    });

    it('does not recalculate refCreditLimit when creditLimit is set to the same value', async () => {
      const newCurrency = 'UAH';
      const currency = (await helpers.addUserCurrencies({ currencyCodes: [newCurrency], raw: true })).currencies[0]!;

      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          creditLimit: 500,
          currencyCode: currency.currencyCode,
        },
        raw: true,
      });

      const updated = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 500 },
        raw: true,
      });

      // Same value — refCreditLimit should remain unchanged
      expect(updated.creditLimit).toBe(account.creditLimit);
      expect(updated.refCreditLimit).toBe(account.refCreditLimit);
    });

    it('updates name and creditLimit but rejects currentBalance changes on non-system account', async () => {
      const account = await helpers.createAccount({
        payload: {
          ...helpers.buildAccountPayload(),
          type: ACCOUNT_TYPES.monobank,
        },
        raw: true,
      });

      const updatedAccount = await helpers.updateAccount({
        id: account.id,
        payload: { name: 'test test' },
        raw: true,
      });

      expect(updatedAccount.name).toBe('test test');

      const withLimit = await helpers.updateAccount({
        id: account.id,
        payload: { creditLimit: 1000 },
        raw: true,
      });
      expect(withLimit.creditLimit).toBe(1000);
      expect(withLimit.currentBalance).toBe(account.currentBalance);
      expect(withLimit.initialBalance).toBe(account.initialBalance);

      const rejectedPayloads = [{ currentBalance: 0 }, { currentBalance: 1000 }];

      for (const payload of rejectedPayloads) {
        const res = await helpers.updateAccount({ id: account.id, payload });

        expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      const reread = await helpers.getAccount({ id: account.id, raw: true });
      expect(reread.creditLimit).toBe(1000);
      expect(reread.currentBalance).toBe(account.currentBalance);
    });

    it('returns 404 when updating another user account', async () => {
      const account = await helpers.createAccount({ raw: true });
      const user2Cookies = await createSecondUser();

      const res = await asUser({
        cookies: user2Cookies,
        fn: () =>
          helpers.updateAccount({
            id: account.id,
            payload: { name: 'Hacked' },
            raw: false,
          }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('updates both creditLimit and currentBalance simultaneously', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          initialBalance: 1000,
          creditLimit: 500,
        }),
        raw: true,
      });

      await createExpenseTransactions({ accountId: account.id, count: 2 });

      const afterTxs = await helpers.getAccount({ id: account.id, raw: true });
      expect(afterTxs.currentBalance).toBe(-1000);

      const updated = await helpers.updateAccount({
        id: afterTxs.id,
        payload: { creditLimit: 800, currentBalance: 0 },
        raw: true,
      });

      expect(updated.creditLimit).toBe(800);
      expect(updated.currentBalance).toBe(0);
      // initialBalance was 1000, currentBalance went from -1000 to 0 (+1000 delta)
      expect(updated.initialBalance).toBe(2000);
    });

    describe('dedicated-flow categories', () => {
      const createGeneralAccount = () =>
        helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'Checking' }),
          raw: true,
        });

      it('rejects moving a general account into the loan category', async () => {
        const account = await createGeneralAccount();

        const response = await helpers.updateAccount<helpers.ErrorResponse>({
          id: account.id,
          payload: { accountCategory: ACCOUNT_CATEGORIES.loan },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(response).code).toBe(API_ERROR_CODES.validationError);

        const reloaded = await helpers.getAccount({ id: account.id, raw: true });
        expect(reloaded.accountCategory).toBe(ACCOUNT_CATEGORIES.general);

        const loans = await helpers.getLoans({ raw: true });
        expect(loans.length).toBe(0);
      });

      it('rejects moving a general account into the vehicle category', async () => {
        const account = await createGeneralAccount();

        const response = await helpers.updateAccount<helpers.ErrorResponse>({
          id: account.id,
          payload: { accountCategory: ACCOUNT_CATEGORIES.vehicle },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(response).code).toBe(API_ERROR_CODES.validationError);

        const reloaded = await helpers.getAccount({ id: account.id, raw: true });
        expect(reloaded.accountCategory).toBe(ACCOUNT_CATEGORIES.general);
      });

      it('rejects moving a vehicle account out of the vehicle category', async () => {
        const vehicle = await helpers.createVehicle({
          name: 'Car',
          currencyCode: global.BASE_CURRENCY_CODE,
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          vehicleClass: VEHICLE_CLASS.sedan,
          purchasePrice: 25000,
          purchaseDate: format(subDays(new Date(), 365), 'yyyy-MM-dd'),
          raw: true,
        });

        const response = await helpers.updateAccount<helpers.ErrorResponse>({
          id: vehicle.accountId,
          payload: { accountCategory: ACCOUNT_CATEGORIES.general },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(helpers.extractResponse(response).code).toBe(API_ERROR_CODES.validationError);

        const reloaded = await helpers.getAccount({ id: vehicle.accountId, raw: true });
        expect(reloaded.accountCategory).toBe(ACCOUNT_CATEGORIES.vehicle);
      });

      it('keeps the account editable after the rejected flip', async () => {
        const account = await createGeneralAccount();

        await helpers.updateAccount({
          id: account.id,
          payload: { accountCategory: ACCOUNT_CATEGORIES.loan },
        });

        const toSaving = await helpers.updateAccount({
          id: account.id,
          payload: { accountCategory: ACCOUNT_CATEGORIES.saving },
        });
        expect(toSaving.statusCode).toBe(200);

        const reloaded = await helpers.getAccount({ id: account.id, raw: true });
        expect(reloaded.accountCategory).toBe(ACCOUNT_CATEGORIES.saving);
      });
    });

    describe('initialBalance', () => {
      it('shifts initialBalance, currentBalance and the whole balance history by the same delta', async () => {
        const account = await createBaseAccount({ initialBalance: 1000 });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            time: subDays(new Date(), 10).toISOString(),
          }),
        });
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 50,
            transactionType: TRANSACTION_TYPES.income,
            time: subDays(new Date(), 5).toISOString(),
          }),
        });
        const historyBefore = centsByDate({
          rows: await helpers.getBalanceHistory({ accountId: account.id, raw: true }),
        });

        const updated = await helpers.updateAccount({ id: account.id, payload: { initialBalance: 1500 }, raw: true });

        expect(updated.initialBalance).toBe(1500);
        expect(updated.refInitialBalance).toBe(1500);
        expect(updated.currentBalance).toBe(1450);
        expect(updated.refCurrentBalance).toBe(1450);

        const historyRows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
        const historyAfter = centsByDate({ rows: historyRows });
        expect(historyAfter.size).toBe(historyBefore.size);
        for (const [date, cents] of historyBefore) {
          expect(historyAfter.get(date)).toBe(cents + 50000);
        }
        expect(helpers.balanceCentsOn({ rows: historyRows, date: new Date() })).toBe(145000);
      });

      it('moves both balances on an account without transactions', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });

        const updated = await helpers.updateAccount({ id: account.id, payload: { initialBalance: -40 }, raw: true });

        expect(updated.initialBalance).toBe(-40);
        expect(updated.currentBalance).toBe(-40);
        expect(updated.refCurrentBalance).toBe(-40);
      });

      it('changes nothing when the value is unchanged', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });
        await createExpenseTransactions({ accountId: account.id, count: 1 });
        const before = await helpers.getAccount({ id: account.id, raw: true });
        const historyBefore = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

        const res = await helpers.updateAccount({ id: account.id, payload: { initialBalance: 100 } });

        expect(res.statusCode).toBe(200);
        expect(await helpers.getAccount({ id: account.id, raw: true })).toStrictEqual(before);
        expect(await helpers.getBalanceHistory({ accountId: account.id, raw: true })).toStrictEqual(historyBefore);
      });

      it('keeps currentBalance = initialBalance + transactions for transactions created after the edit', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });
        await helpers.updateAccount({ id: account.id, payload: { initialBalance: 250 }, raw: true });

        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 30 }),
        });

        const reread = await helpers.getAccount({ id: account.id, raw: true });
        expect(reread.initialBalance).toBe(250);
        expect(reread.currentBalance).toBe(220);
      });

      it('re-measures ref balances at the spot rate for a foreign-currency account', async () => {
        await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
        const account = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 200 }),
          raw: true,
        });

        const updated = await helpers.updateAccount({ id: account.id, payload: { initialBalance: 500 }, raw: true });

        const spotEurToAed = AED_PER_USD / EUR_PER_USD;
        expect(updated.initialBalance).toBe(500);
        expect(updated.currentBalance).toBe(500);
        expect(Math.round(Number(updated.refInitialBalance) * 100)).toEqualRefValue(50000 * spotEurToAed);
        expect(Math.round(Number(updated.refCurrentBalance) * 100)).toEqualRefValue(50000 * spotEurToAed);
      });

      it('rejects initialBalance on a bank-connected account', async () => {
        const account = await helpers.createAccount({
          payload: { ...helpers.buildAccountPayload(), type: ACCOUNT_TYPES.monobank },
          raw: true,
        });

        await expectRejected({ id: account.id, payload: { initialBalance: 1000 } });
      });

      it('rejects initialBalance on a loan account', async () => {
        const loan = await helpers.createLoan({
          payload: helpers.buildCreateLoanPayload({ currencyCode: global.BASE_CURRENCY_CODE }),
          raw: true,
        });

        await expectRejected({ id: loan.id, payload: { initialBalance: 1000 } });
      });

      it('rejects initialBalance on a vehicle account', async () => {
        const vehicle = await helpers.createVehicle({
          name: 'Car',
          currencyCode: global.BASE_CURRENCY_CODE,
          make: 'Toyota',
          model: 'Camry',
          year: 2020,
          vehicleClass: VEHICLE_CLASS.sedan,
          purchasePrice: 25000,
          purchaseDate: format(subDays(new Date(), 365), 'yyyy-MM-dd'),
          raw: true,
        });

        await expectRejected({ id: vehicle.accountId, payload: { initialBalance: 1000 } });
      });

      it('rejects initialBalance and currentBalance sent together', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });

        await expectRejected({ id: account.id, payload: { initialBalance: 200, currentBalance: 300 } });
      });

      it('rolls back initialBalance when another field in the same request is rejected', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });
        await createExpenseTransactions({ accountId: account.id, count: 1 });

        await expectRejected({
          id: account.id,
          payload: { initialBalance: 500, accountCategory: ACCOUNT_CATEGORIES.loan },
        });
      });

      it('persists initialBalance together with other fields', async () => {
        const account = await createBaseAccount({ initialBalance: 100 });

        const updated = await helpers.updateAccount({
          id: account.id,
          payload: { initialBalance: 300, name: 'Renamed' },
          raw: true,
        });

        expect(updated.name).toBe('Renamed');
        expect(updated.initialBalance).toBe(300);
        expect(updated.currentBalance).toBe(300);
        const reread = await helpers.getAccount({ id: account.id, raw: true });
        expect(reread.name).toBe('Renamed');
        expect(reread.initialBalance).toBe(300);
      });
    });
  });

  describe('delete account', () => {
    it('returns 404 when deleting a non-existent account', async () => {
      const res = await helpers.deleteAccount({ id: generateRandomRecordId(), raw: false });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('deletes own account successfully', async () => {
      const account = await helpers.createAccount({ raw: true });

      const res = await helpers.deleteAccount({ id: account.id, raw: false });
      expect(res.statusCode).toBe(200);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((a) => a.id === account.id)).toBe(false);
    });

    it('returns 404 when deleting another user account and leaves it intact', async () => {
      const account = await helpers.createAccount({ raw: true });
      const user2Cookies = await createSecondUser();

      const res = await asUser({
        cookies: user2Cookies,
        fn: () => helpers.deleteAccount({ id: account.id, raw: false }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);

      const stillExists = await helpers.getAccount({ id: account.id, raw: true });
      expect(stillExists.id).toBe(account.id);
    });
  });
});
