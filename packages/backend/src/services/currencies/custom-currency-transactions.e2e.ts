import {
  type AccountApiResponse,
  type RecordId,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';

const BASE = (): string => global.BASE_CURRENCY_CODE;

/** The user's own rate between `code` and `quote`, in both directions, as the endpoint requires. */
const pairRates = ({ code, rate, quote = BASE() }: { code: string; rate: number; quote?: string }) => [
  { baseCode: code, quoteCode: quote, rate },
  { baseCode: quote, quoteCode: code, rate: 1 / rate },
];

const setRates = (pairs: { baseCode: string; quoteCode: string; rate: number }[]) =>
  helpers.editCurrencyExchangeRate({ pairs, raw: true });

const createCurrency = async ({ code, decimals, name = code }: { code: string; decimals: number; name?: string }) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name, decimals } });
  expect(response.statusCode).toBe(201);
};

const createAccountIn = async ({ code, name = `${code} account` }: { code: string; name?: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

const createTx = async ({
  accountId,
  amount,
  type = TRANSACTION_TYPES.expense,
  ownCategory = false,
  extra = {},
}: {
  accountId: string;
  amount: number;
  type?: TRANSACTION_TYPES;
  ownCategory?: boolean;
  extra?: Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>;
}) => {
  const categoryId = ownCategory ? (await helpers.getCategoriesList())[0]!.id : global.DEFAULT_CATEGORY_ID;
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId,
      transactionType: type,
      ...extra,
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200) {
    throw new Error(`createTransaction answered ${body.statusCode}: ${JSON.stringify(body.body)}`);
  }

  return body.body.response;
};

const readTx = async ({ id }: { id: string }) =>
  (await helpers.getTransactionById({ id: id as RecordId, raw: true })) as unknown as TransactionApiResponse;

const readAccount = async ({ id }: { id: string }) =>
  (await helpers.getAccount({ id, raw: true })) as unknown as AccountApiResponse;

describe('Transactions in custom currencies', () => {
  describe('precision round trips', () => {
    it('stores 8 decimals of BTC exactly and values them in the base currency at the user rate', async () => {
      await createCurrency({ code: 'BTC', decimals: 8, name: 'Bitcoin' });
      await setRates(pairRates({ code: 'BTC', rate: 250000 }));
      const account = await createAccountIn({ code: 'BTC' });

      const [created] = await createTx({ accountId: account.id, amount: 0.00040641 });

      expect(created!.amount).toBe(0.00040641);
      // 0.00040641 BTC x 250000 = 101.6025, rounded to the 2 decimals of the base currency.
      expect(created!.refAmount).toBe(101.6);
      expect(created!.refAmountMissing).toBe(false);

      const fetched = await readTx({ id: created!.id });
      expect(fetched.amount).toBe(0.00040641);
      expect(fetched.refAmount).toBe(101.6);
      expect(fetched.currencyMeta).toEqual({ decimals: 8, symbol: null, isCustom: true });
    });

    it('rounds an amount with more than 8 decimals to 8 and stores it', async () => {
      await createCurrency({ code: 'BTC', decimals: 8 });
      await setRates(pairRates({ code: 'BTC', rate: 250000 }));
      const account = await createAccountIn({ code: 'BTC' });

      const [created] = await createTx({ accountId: account.id, amount: 0.123456789 });

      expect(created!.amount).toBe(0.12345679);
    });

    it('stores 6 decimals of USDT exactly and keeps them in the account balance', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether' });
      await setRates(pairRates({ code: 'USDT', rate: 3.6725 }));
      const account = await createAccountIn({ code: 'USDT' });

      const [created] = await createTx({ accountId: account.id, amount: 12.345678, type: TRANSACTION_TYPES.income });

      expect(created!.amount).toBe(12.345678);
      // 12.345678 x 3.6725 = 45.339502455, rounded to the base currency.
      expect(created!.refAmount).toBe(45.34);

      expect((await readTx({ id: created!.id })).amount).toBe(12.345678);
      const reloaded = await readAccount({ id: account.id });
      expect(reloaded.currentBalance).toBe(12.345678);
      expect(reloaded.refCurrentBalance).toBe(45.34);
    });
  });

  describe('conversion path', () => {
    it('crosses the stored quote into the base currency with the manual ISO rate of that quote', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      // USDT keeps its rate in USD; the user's own USD to base rate then decides the value.
      await setRates([...pairRates({ code: 'USDT', rate: 1, quote: 'USD' }), ...pairRates({ code: 'USD', rate: 3.9 })]);
      const account = await createAccountIn({ code: 'USDT' });

      const [created] = await createTx({ accountId: account.id, amount: 10 });

      expect(created!.refAmount).toBe(39);
      expect(created!.refAmountMissing).toBe(false);
    });

    it('values later entries through the same stored quote after the ISO rate changes', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await setRates([...pairRates({ code: 'USDT', rate: 1, quote: 'USD' }), ...pairRates({ code: 'USD', rate: 3.9 })]);
      const account = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: account.id, amount: 10 });

      await setRates(pairRates({ code: 'USD', rate: 4 }));
      const [second] = await createTx({ accountId: account.id, amount: 10 });

      expect(first!.refAmount).toBe(39);
      expect(second!.refAmount).toBe(40);
    });
  });

  describe('transfers', () => {
    it('values both legs of a USDT to USD transfer when both amounts are given', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await setRates([...pairRates({ code: 'USDT', rate: 3.6725 }), ...pairRates({ code: 'USD', rate: 4 })]);
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: 'USD' });

      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 100.123456,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: usd.id as RecordId,
          destinationAmount: 27.5,
        },
      });

      expect(source!.amount).toBe(100.123456);
      // 100.123456 x 3.6725 = 367.7... rounded to 2 decimals
      expect(source!.refAmount).toBe(367.7);
      expect(source!.refAmountMissing).toBe(false);
      expect(destination!.amount).toBe(27.5);
      expect(destination!.refAmount).toBe(110);
      expect(destination!.refAmountMissing).toBe(false);
    });

    it('flags only the custom leg of a transfer when its currency has no rate', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await setRates(pairRates({ code: 'USD', rate: 4 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: 'USD' });

      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 50,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: usd.id as RecordId,
          destinationAmount: 50,
        },
      });

      expect(source!.refAmount).toBeNull();
      expect(source!.refAmountMissing).toBe(true);
      expect(destination!.refAmount).toBe(200);
      expect(destination!.refAmountMissing).toBe(false);
    });

    it('takes the base-currency value from the base-currency leg when the other leg is custom', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const base = await createAccountIn({ code: BASE(), name: 'Base' });

      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 10,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: base.id as RecordId,
          destinationAmount: 36.7,
        },
      });

      expect(source!.refAmount).toBe(36.7);
      expect(source!.refAmountMissing).toBe(false);
      expect(destination!.refAmount).toBe(36.7);
    });
  });

  describe('a custom currency with no rate', () => {
    it('saves the transaction, flags it, and leaves it out of the base-currency sums', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const base = await createAccountIn({ code: BASE(), name: 'Base' });

      const [custom] = await createTx({ accountId: usdt.id, amount: 5.5 });
      await createTx({ accountId: base.id, amount: 10 });

      expect(custom!.amount).toBe(5.5);
      expect(custom!.refAmount).toBeNull();
      expect(custom!.refCommissionRate).toBe(0);
      expect(custom!.refAmountMissing).toBe(true);

      const fetched = await readTx({ id: custom!.id });
      expect(fetched.refAmount).toBeNull();
      expect(fetched.refAmountMissing).toBe(true);

      const listed = (await helpers.getTransactions({
        accountIds: [usdt.id as RecordId],
        raw: true,
      })) as unknown as TransactionApiResponse[];
      expect(listed.map((tx) => [tx.refAmount, tx.refAmountMissing])).toEqual([[null, true]]);

      const summary = await helpers.getTransactionsSummary({ raw: true });
      expect(summary).toMatchObject({ count: 1, expense: 10 });

      const spendings = (await helpers.getSpendingsByCategories({ raw: true })) as Record<string, { amount: number }>;
      expect(Object.values(spendings).reduce((sum, item) => sum + item.amount, 0)).toBe(10);

      // The account keeps its native balance; its base-currency value is not known yet.
      const account = await readAccount({ id: usdt.id });
      expect(account.currentBalance).toBe(-5.5);
      expect(account.refCurrentBalance).toBeNull();
    });

    it('fills in the value when the transaction is saved again after the rate exists', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [custom] = await createTx({ accountId: usdt.id, amount: 5 });
      expect(custom!.refAmountMissing).toBe(true);

      await setRates(pairRates({ code: 'USDT', rate: 3.6725 }));
      const [updated] = (await helpers.updateTransaction({
        id: custom!.id as RecordId,
        payload: { amount: 6 },
        raw: true,
      })) as unknown as TransactionApiResponse[];

      expect(updated!.refAmount).toBe(22.04);
      expect(updated!.refAmountMissing).toBe(false);
      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBe(-22.04);
    });

    it('flags the entry instead of hanging when two custom currencies are quoted in each other and neither has a rate in the base', async () => {
      await createCurrency({ code: 'SAT', decimals: 8 });
      await createCurrency({ code: 'COIN', decimals: 4 });
      const sat = await createAccountIn({ code: 'SAT' });

      // The endpoint stores both directions, so SAT is quoted in COIN and COIN in SAT: a loop.
      await setRates(pairRates({ code: 'SAT', rate: 3, quote: 'COIN' }));

      const [created] = await createTx({ accountId: sat.id, amount: 0.5 });

      expect(created!.amount).toBe(0.5);
      expect(created!.refAmount).toBeNull();
      expect(created!.refAmountMissing).toBe(true);

      // A rate to the base breaks the loop for the entries saved after it.
      await setRates(pairRates({ code: 'SAT', rate: 2 }));
      const [valued] = await createTx({ accountId: sat.id, amount: 0.5 });
      expect(valued!.refAmount).toBe(1);
      expect(valued!.refAmountMissing).toBe(false);
    });

    it('turns a valued transaction back into a flagged one when its rate is removed before an edit', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      await setRates(pairRates({ code: 'USDT', rate: 4 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const [custom] = await createTx({ accountId: usdt.id, amount: 5 });
      expect(custom!.refAmount).toBe(20);

      await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: BASE() },
          { baseCode: BASE(), quoteCode: 'USDT' },
        ],
        raw: true,
      });
      const [updated] = (await helpers.updateTransaction({
        id: custom!.id as RecordId,
        payload: { note: 'edited' },
        raw: true,
      })) as unknown as TransactionApiResponse[];

      expect(updated!.refAmount).toBeNull();
      expect(updated!.refAmountMissing).toBe(true);
    });
  });

  describe('bulk actions selected by filters over rows with no rate', () => {
    const noteOf = async ({ id }: { id: string }) => (await readTx({ id })).note;

    it('bulk edit reaches every unpriced row of a custom-currency account', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: usdt.id, amount: 5 });
      const [second] = await createTx({ accountId: usdt.id, amount: 7 });
      expect(first!.refAmountMissing).toBe(true);

      const result = await helpers.bulkUpdateTransactions({
        payload: { selection: { filters: { accountIds: [usdt.id as RecordId] }, excludedIds: [] }, note: 'bulk' },
        raw: true,
      });

      expect(result.updatedIds.toSorted()).toEqual([first!.id, second!.id].toSorted());
      expect(await noteOf({ id: first!.id })).toBe('bulk');
      expect(await noteOf({ id: second!.id })).toBe('bulk');
    });

    it('bulk delete reaches every unpriced row of a custom-currency account', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: usdt.id, amount: 5 });
      const [second] = await createTx({ accountId: usdt.id, amount: 7 });

      const result = await helpers.bulkDeleteTransactions({
        payload: { selection: { filters: { accountIds: [usdt.id as RecordId] }, excludedIds: [] } },
        raw: true,
      });

      expect(result.deletedIds.toSorted()).toEqual([first!.id, second!.id].toSorted());
      const remaining = (await helpers.getTransactions({
        accountIds: [usdt.id as RecordId],
        raw: true,
      })) as unknown as TransactionApiResponse[];
      expect(remaining).toEqual([]);
    });

    it('a mixed selection of priced and unpriced rows honours the excluded ids', async () => {
      await createCurrency({ code: 'USDT', decimals: 6 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const base = await createAccountIn({ code: BASE(), name: 'Base' });
      const [unpriced] = await createTx({ accountId: usdt.id, amount: 5 });
      const [keptUnpriced] = await createTx({ accountId: usdt.id, amount: 6 });
      const [priced] = await createTx({ accountId: base.id, amount: 10 });
      const filters = { accountIds: [usdt.id as RecordId, base.id as RecordId] };

      const updated = await helpers.bulkUpdateTransactions({
        payload: { selection: { filters, excludedIds: [keptUnpriced!.id] }, note: 'mixed' },
        raw: true,
      });

      expect(updated.updatedIds.toSorted()).toEqual([unpriced!.id, priced!.id].toSorted());
      expect(await noteOf({ id: keptUnpriced!.id })).not.toBe('mixed');

      const deleted = await helpers.bulkDeleteTransactions({
        payload: { selection: { filters, excludedIds: [keptUnpriced!.id] } },
        raw: true,
      });

      expect(deleted.deletedIds.toSorted()).toEqual([unpriced!.id, priced!.id].toSorted());
      const remaining = (await helpers.getTransactions({ raw: true })) as unknown as TransactionApiResponse[];
      expect(remaining.map((tx) => tx.id)).toEqual([keptUnpriced!.id]);
    });
  });

  describe('two users with their own definition of the same code', () => {
    it('values the same entry differently according to each user decimals', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, name: 'Satoshi' });
      await setRates(pairRates({ code: 'SAT', rate: 3 }));
      const aliceAccount = await createAccountIn({ code: 'SAT' });
      const [aliceTx] = await createTx({ accountId: aliceAccount.id, amount: 1.5 });
      const [aliceOther] = await createTx({ accountId: aliceAccount.id, amount: 2.4 });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await createCurrency({ code: 'SAT', decimals: 0, name: 'Sats' });
          await setRates(pairRates({ code: 'SAT', rate: 3 }));
          const bobAccount = await createAccountIn({ code: 'SAT' });
          const [bobTx] = await createTx({ accountId: bobAccount.id, amount: 1.5, ownCategory: true });
          const [bobOther] = await createTx({ accountId: bobAccount.id, amount: 2.4, ownCategory: true });

          // Half rounds up to 2 whole sats for Bob.
          expect(bobTx!.amount).toBe(2);
          expect(bobTx!.refAmount).toBe(6);
          expect(bobOther!.amount).toBe(2);
          expect(bobOther!.refAmount).toBe(6);
        },
      });

      expect(aliceTx!.amount).toBe(1.5);
      expect(aliceTx!.refAmount).toBe(4.5);
      expect(aliceOther!.amount).toBe(2.4);
      expect(aliceOther!.refAmount).toBe(7.2);
    });
  });

  describe('a collaborator who never defined the currency', () => {
    it("connects the code with the owner's definition and saves the entry flagged, since no rate exists", async () => {
      await createCurrency({ code: 'SAT', decimals: 8, name: 'Satoshi' });
      const account = await createAccountIn({ code: 'SAT', name: 'Shared SAT' });

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: bob.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.write,
        policy: { transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all },
        raw: true,
      });

      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.acceptShareInvitation({ token: invitation.token, raw: true });
          expect(await helpers.listCustomCurrencies({ raw: true })).toEqual([]);

          const [created] = await createTx({ accountId: account.id, amount: 0.123456789 });

          // The owner's 8 decimals govern the amount; Bob has no rate, so the value stays open.
          expect(created!.amount).toBe(0.12345679);
          expect(created!.refAmount).toBeNull();
          expect(created!.refAmountMissing).toBe(true);

          const connected = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'SAT');
          expect(connected).toBeDefined();
          expect(connected!.currency).toMatchObject({ code: 'SAT', digits: 8, currency: 'Satoshi' });
          expect(connected!.liveRateUpdate).toBe(false);
        },
      });
    });
  });
  describe('backup and restore', () => {
    beforeEach(async () => {
      const { id } = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
      await RateLimitService.resetRateLimit(`backup:user:${id}`);
      await RateLimitService.resetRateLimit(`backup-restore:user:${id}`);
    });

    it('restores a transaction that has no base-currency amount as missing, and the account balance as unknown', async () => {
      await createCurrency({ code: 'USDT', decimals: 6, name: 'Tether' });
      const usdt = await createAccountIn({ code: 'USDT', name: 'Stable' });
      await createTx({ accountId: usdt.id, amount: 5.123456 });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);

      await helpers.wipeUserData();
      const restore = await helpers.restoreBackup({ fileContent: exported.body.toString('base64') });
      expect(restore.statusCode).toBe(200);
      const status = await helpers.waitForRestore({ jobId: restore.jobId! });
      expect(status.status).toBe('completed');

      const restoredAccount = (await helpers.getAccounts()).find((candidate) => candidate.name === 'Stable');
      expect(restoredAccount).toBeDefined();
      const restored = (await helpers.getTransactions({
        accountIds: [restoredAccount!.id as RecordId],
        raw: true,
      })) as unknown as TransactionApiResponse[];

      expect(restored).toHaveLength(1);
      expect(restored[0]!.amount).toBe(5.123456);
      expect(restored[0]!.refAmount).toBeNull();
      expect(restored[0]!.refAmountMissing).toBe(true);
    });
  });
});
