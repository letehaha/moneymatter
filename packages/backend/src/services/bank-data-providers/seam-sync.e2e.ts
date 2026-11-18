import { ACCOUNT_TYPES, API_ERROR_CODES, BANK_PROVIDER_TYPE, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import type { LunchFlowApiTransaction } from '@services/bank-data-providers/lunchflow/types';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { MOCK_IDENTIFICATION_HASH_1, getMockedTransactions } from '@tests/mocks/enablebanking/data';
import { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import { LUNCHFLOW_BASE_URL, getLunchFlowTransactionsMock } from '@tests/mocks/lunchflow/mock-api';
import { getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import { getMockedWalutomatHistory } from '@tests/mocks/walutomat/data';
import { getWalutomatBalancesMock } from '@tests/mocks/walutomat/mock-api';
import { addMinutes, format, startOfDay, subDays } from 'date-fns';
import { HttpResponse, http } from 'msw';

const TODAY = startOfDay(new Date());
const TODAY_KEY = format(TODAY, 'yyyy-MM-dd');
const dayKey = ({ daysAgo }: { daysAgo: number }) => format(subDays(TODAY, daysAgo), 'yyyy-MM-dd');
const PAST_DAYS = [9, 8, 7, 6, 5, 4, 3, 2, 1];

type BalanceRows = Awaited<ReturnType<typeof helpers.getBalanceHistory<true>>>;

const pastChart = (rows: BalanceRows) =>
  PAST_DAYS.map((daysAgo) => helpers.balanceCentsOn({ rows, date: subDays(TODAY, daysAgo) }));

const historyBeforeSeam = async ({ accountId }: { accountId: string }) => {
  const [account, rows] = await Promise.all([
    helpers.readAccount({ accountId }),
    helpers.getBalanceHistory({ accountId, raw: true }),
  ]);
  return { initialBalance: account.initialBalance, chart: pastChart(rows) };
};

const chartOn = ({ chart, daysAgo }: { chart: number[]; daysAgo: number }) => chart[PAST_DAYS.indexOf(daysAgo)]!;

const historyFromSeam = async ({ accountId }: { accountId: string }) => {
  const [account, rows] = await Promise.all([
    helpers.readAccount({ accountId }),
    helpers.getBalanceHistory({ accountId, raw: true }),
  ]);
  return {
    currentBalance: account.currentBalance,
    rows: rows.filter((row) => format(new Date(row.date), 'yyyy-MM-dd') >= TODAY_KEY),
  };
};

/** Runs `fn` as a user whose base currency is EUR, so a EUR account's history needs no exchange rate. */
const asEurBaseUser = async ({ fn }: { fn: () => Promise<void> }) => {
  const user = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'EUR' });
  await helpers.asUser({ cookies: user.cookies, fn });
};

const createManualAccount = async ({
  currencyCode,
  initialBalance = 1000,
}: {
  currencyCode: string;
  initialBalance?: number;
}) => {
  await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });
  return helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Manual account', currencyCode, initialBalance }),
    raw: true,
  });
};

const createManualRow = async ({ accountId, daysAgo }: { accountId: RecordId; daysAgo: number }) => {
  const [category] = await helpers.getCategoriesList();
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount: 100,
      transactionType: TRANSACTION_TYPES.expense,
      time: addMinutes(subDays(TODAY, daysAgo), 12 * 60).toISOString(),
      categoryId: category!.id as RecordId,
    }),
    raw: true,
  });
};

const bankRowsOf = async ({ accountId }: { accountId: string }) =>
  (await helpers.getTransactions({ accountIds: [accountId], raw: true })).filter((tx) => tx.accountType !== 'system');

const isPending = (tx: unknown) => (tx as TransactionApiResponse).isPending;

/** Serves `transactions` from the LunchFlow feed, holding each request until `release` is called. */
const holdLunchFlowTransactions = ({ transactions }: { transactions: LunchFlowApiTransaction[] }) => {
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = http.get(`${LUNCHFLOW_BASE_URL}/accounts/1001/transactions`, async () => {
    markRequested();
    await released;
    return HttpResponse.json({ transactions, total: transactions.length });
  });
  return { handler, requested, release };
};

const link = async ({
  accountId,
  connectionId,
  externalAccountId,
}: {
  accountId: RecordId;
  connectionId: string;
  externalAccountId: string;
}) => {
  const response = await helpers.linkAccountToBankConnection({
    id: accountId,
    connectionId,
    externalAccountId,
    raw: false,
  });
  expect(response.statusCode).toBe(200);
};

const syncAccount = async ({ connectionId, accountId }: { connectionId: string; accountId: string }) =>
  helpers.makeRequest({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
    payload: { accountId },
    raw: true,
  });

const authorizedConnection = async () => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });
  const state = await helpers.enablebanking.getConnectionState(connectionId);
  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: { connectionId, code: helpers.enablebanking.mockAuthCode, state },
  });
  return { connectionId };
};

describe('Bank sync on a manual account linked forward-only', () => {
  describe('Walutomat', () => {
    it('imports only rows from the link on and leaves the history before the seam alone', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await helpers.walutomat.pair();

      const history = getMockedWalutomatHistory({
        amount: 2,
        currency: 'EUR',
        overrides: [{ ts: subDays(new Date(), 5).toISOString() }, { ts: addMinutes(new Date(), 1).toISOString() }],
      });
      global.mswMockServer.use(
        getWalutomatBalancesMock(),
        http.get('https://api.walutomat.pl/api/v2.0.0/account/history', ({ request }) => {
          const dateFrom = new URL(request.url).searchParams.get('dateFrom');
          return HttpResponse.json({
            success: true,
            result: history.filter((item) => !dateFrom || item.ts >= dateFrom),
          });
        }),
      );

      await link({ accountId: account.id, connectionId, externalAccountId: 'wallet-eur' });
      const linked = await helpers.readAccount({ accountId: account.id });
      expect(linked.bankSeamAt).toBe(TODAY.toISOString());

      const bankRows = await bankRowsOf({ accountId: account.id });
      expect(bankRows.map((tx) => tx.originalId)).toEqual([history[1]!.transactionId]);

      const before = await historyBeforeSeam({ accountId: account.id });
      await syncAccount({ connectionId, accountId: account.id });

      expect(await historyBeforeSeam({ accountId: account.id })).toEqual(before);
      expect(await bankRowsOf({ accountId: account.id })).toHaveLength(1);
    });

    it('imports nothing from before the link when every stored row is trashed', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await helpers.walutomat.pair();

      const history = getMockedWalutomatHistory({
        amount: 1,
        currency: 'EUR',
        overrides: [{ ts: subDays(new Date(), 5).toISOString() }],
      });
      global.mswMockServer.use(
        getWalutomatBalancesMock(),
        http.get('https://api.walutomat.pl/api/v2.0.0/account/history', ({ request }) => {
          const dateFrom = new URL(request.url).searchParams.get('dateFrom');
          return HttpResponse.json({
            success: true,
            result: history.filter((item) => !dateFrom || item.ts >= dateFrom),
          });
        }),
      );

      await link({ accountId: account.id, connectionId, externalAccountId: 'wallet-eur' });
      const [manualRow] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect((await helpers.deleteTransaction({ id: manualRow!.id })).statusCode).toBe(200);

      await syncAccount({ connectionId, accountId: account.id });

      expect(await bankRowsOf({ accountId: account.id })).toEqual([]);
    });

    it('imports nothing from before the link after every stored row was purged', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await helpers.walutomat.pair();

      const history = getMockedWalutomatHistory({
        amount: 1,
        currency: 'EUR',
        overrides: [{ ts: subDays(new Date(), 5).toISOString() }],
      });
      global.mswMockServer.use(
        getWalutomatBalancesMock(),
        http.get('https://api.walutomat.pl/api/v2.0.0/account/history', ({ request }) => {
          const dateFrom = new URL(request.url).searchParams.get('dateFrom');
          return HttpResponse.json({
            success: true,
            result: history.filter((item) => !dateFrom || item.ts >= dateFrom),
          });
        }),
      );

      await link({ accountId: account.id, connectionId, externalAccountId: 'wallet-eur' });
      const [manualRow] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect((await helpers.deleteTransaction({ id: manualRow!.id })).statusCode).toBe(200);
      expect((await helpers.deleteTrash({ transactionIds: [manualRow!.id as RecordId] })).statusCode).toBe(200);

      await syncAccount({ connectionId, accountId: account.id });

      expect(await bankRowsOf({ accountId: account.id })).toEqual([]);
    });
  });

  describe('LunchFlow', () => {
    it('imports nothing from before the link when every stored row is trashed', async () => {
      const account = await createManualAccount({ currencyCode: 'USD' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await helpers.lunchflow.pair();
      global.mswMockServer.use(getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }));
      await link({ accountId: account.id, connectionId, externalAccountId: '1001' });

      const [manualRow] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect((await helpers.deleteTransaction({ id: manualRow!.id })).statusCode).toBe(200);

      const [preLinkRow, postLinkRow] = getMockedLunchFlowTransactions(2).transactions;
      global.mswMockServer.use(
        getLunchFlowTransactionsMock({
          response: {
            transactions: [
              { ...preLinkRow!, date: subDays(new Date(), 5).toISOString() },
              { ...postLinkRow!, date: addMinutes(new Date(), 1).toISOString() },
            ],
            total: 2,
          },
        }),
      );
      await helpers.dropSeam({ accountId: account.id });
      await syncAccount({ connectionId, accountId: account.id });

      expect((await bankRowsOf({ accountId: account.id })).map((tx) => tx.originalId)).toEqual([postLinkRow!.id]);
    });

    it('rolls back the rows of a sync whose account was unlinked while it fetched', async () => {
      const account = await createManualAccount({ currencyCode: 'USD' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await helpers.lunchflow.pair();
      global.mswMockServer.use(getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }));
      await link({ accountId: account.id, connectionId, externalAccountId: '1001' });

      const [row] = getMockedLunchFlowTransactions(1).transactions;
      const feed = holdLunchFlowTransactions({
        transactions: [{ ...row!, date: addMinutes(new Date(), 1).toISOString() }],
      });
      global.mswMockServer.use(feed.handler);

      const sync = helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId: account.id },
      });
      try {
        await feed.requested;
        expect((await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: false })).statusCode).toBe(200);
      } finally {
        feed.release();
      }
      const response = await sync;

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(helpers.extractResponse(response)).toMatchObject({ code: API_ERROR_CODES.notFound });
      expect(await bankRowsOf({ accountId: account.id })).toEqual([]);
      const unlinked = await helpers.readAccount({ accountId: account.id });
      expect(unlinked.type).toBe(ACCOUNT_TYPES.system);
      const rows = (await helpers.getTransactions({
        accountIds: [account.id],
        raw: true,
      })) as unknown as TransactionApiResponse[];
      const signedSum = rows.reduce(
        (acc, tx) => acc + (tx.transactionType === TRANSACTION_TYPES.income ? tx.amount : -tx.amount),
        0,
      );
      expect(unlinked.currentBalance).toBeCloseTo(unlinked.initialBalance + signedSum, 2);
    });
  });

  describe('Enable Banking', () => {
    useSelfHost();

    beforeEach(() => {
      helpers.enablebanking.resetSessionCounter();
    });

    afterEach(() => {
      helpers.enablebanking.resetTransactionConfig();
    });

    const bookedRow = ({ daysAgo, reference }: { daysAgo: number; reference: string }) => ({
      entryReference: reference,
      amount: '25.00',
      currency: 'EUR',
      isExpense: true,
      bookingDate: dayKey({ daysAgo }),
      valueDate: dayKey({ daysAgo }),
      balanceAfter: '777.00',
    });

    it('asks the bank only for days from the link on and leaves the history before the seam alone', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await authorizedConnection();

      helpers.enablebanking.setFixedTransactions([
        bookedRow({ daysAgo: 5, reference: 'pre-link' }),
        bookedRow({ daysAgo: 0, reference: 'link-day' }),
      ]);
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', ({ request, params }) => {
          const url = new URL(request.url);
          const dateFrom = url.searchParams.get('date_from');
          if (url.searchParams.get('continuation_key')) return HttpResponse.json({ transactions: [] });
          const transactions = getMockedTransactions(params.accountId as string, 10).filter(
            (tx: { booking_date?: string }) => !dateFrom || !tx.booking_date || tx.booking_date >= dateFrom,
          );
          return HttpResponse.json({ transactions, continuation_key: null });
        }),
      );

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });

      const bankRows = await bankRowsOf({ accountId: account.id });
      expect(bankRows.map((tx) => format(new Date(tx.time), 'yyyy-MM-dd'))).toEqual([TODAY_KEY]);

      const before = await historyBeforeSeam({ accountId: account.id });
      await syncAccount({ connectionId, accountId: account.id });

      expect(await historyBeforeSeam({ accountId: account.id })).toEqual(before);
      expect(await bankRowsOf({ accountId: account.id })).toHaveLength(1);
      expect((await helpers.readAccount({ accountId: account.id })).bankSeamAt).toBe(TODAY.toISOString());
    });

    it('drops a bank row dated before the link and leaves the history before the link alone', async () => {
      // 1623.45 − 100 is the mocked bank balance, so linking absorbs no residual.
      const account = await createManualAccount({ currencyCode: 'EUR', initialBalance: 1623.45 });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await authorizedConnection();
      const manualHistory = await historyBeforeSeam({ accountId: account.id });

      // This bank ignores date_from and sends an older booking day anyway.
      helpers.enablebanking.setFixedTransactions([bookedRow({ daysAgo: 5, reference: 'pre-link' })]);

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });
      await syncAccount({ connectionId, accountId: account.id });

      expect(await bankRowsOf({ accountId: account.id })).toEqual([]);
      expect(await historyBeforeSeam({ accountId: account.id })).toEqual(manualHistory);
    });

    it('drops a bank row dated before the link when every stored row is trashed', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await authorizedConnection();
      helpers.enablebanking.setFixedTransactions([bookedRow({ daysAgo: 5, reference: 'pre-link' })]);

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });
      const [manualRow] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      expect((await helpers.deleteTransaction({ id: manualRow!.id })).statusCode).toBe(200);

      await syncAccount({ connectionId, accountId: account.id });

      expect(await bankRowsOf({ accountId: account.id })).toEqual([]);
    });

    it('upgrades a stored pending row in place when its booked copy is dated before the link', async () => {
      await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await authorizedConnection();
      helpers.enablebanking.setFixedTransactions([{ ...bookedRow({ daysAgo: 0, reference: 'card' }), status: 'PDNG' }]);

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });
      const [pending] = await bankRowsOf({ accountId: account.id });
      expect(isPending(pending)).toBe(true);

      helpers.enablebanking.setFixedTransactions([bookedRow({ daysAgo: 1, reference: 'card' })]);
      await syncAccount({ connectionId, accountId: account.id });

      const bankRows = await bankRowsOf({ accountId: account.id });
      expect(bankRows).toHaveLength(1);
      expect(bankRows[0]!.id).toBe(pending!.id);
      expect(isPending(bankRows[0])).toBe(false);
    });

    /** A manual account with no rows whose first link backfills one booked −25.00 bank row dated 5 days ago. */
    const linkWithBackfilledRow = async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      const { connectionId } = await authorizedConnection();
      helpers.enablebanking.setFixedTransactions([bookedRow({ daysAgo: 5, reference: 'pre-link' })]);

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });

      const bankRows = await bankRowsOf({ accountId: account.id });
      expect(bankRows).toHaveLength(1);
      return { accountId: account.id as RecordId, connectionId, bankRowId: bankRows[0]!.id as RecordId };
    };

    it('rebuilds the history before the link from bank rows the first sync backfills', async () => {
      await asEurBaseUser({
        fn: async () => {
          const { accountId } = await linkWithBackfilledRow();

          const { initialBalance, chart } = await historyBeforeSeam({ accountId });
          const openingCents = Math.round(initialBalance * 100);

          expect(openingCents).toBeGreaterThan(2500);
          expect(chartOn({ chart, daysAgo: 6 })).toBe(openingCents);
          for (const daysAgo of [5, 4, 3, 2, 1]) expect(chartOn({ chart, daysAgo })).toBe(openingCents - 2500);
        },
      });
    });

    it('rebuilds the history before the link when a pre-link bank row trashed while unlinked is restored after a relink', async () => {
      await asEurBaseUser({
        fn: async () => {
          const { accountId, connectionId, bankRowId } = await linkWithBackfilledRow();
          const before = await historyBeforeSeam({ accountId });

          await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
          expect((await helpers.deleteTransaction({ id: bankRowId })).statusCode).toBe(200);
          await helpers.bankDataProviders.connectSelectedAccounts({
            connectionId,
            accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
            raw: true,
          });
          const fromSeam = await historyFromSeam({ accountId });

          const restored = await helpers.restoreTrash({ transactionIds: [bankRowId] });
          expect(restored.statusCode).toBe(200);

          expect((await bankRowsOf({ accountId })).map((tx) => tx.id)).toEqual([bankRowId]);
          expect(await historyBeforeSeam({ accountId })).toEqual(before);
          expect(await historyFromSeam({ accountId })).toEqual(fromSeam);
        },
      });
    });

    it('rebuilds the history before the link when reconciliation removes and restores a pre-link bank row', async () => {
      await asEurBaseUser({
        fn: async () => {
          const { accountId, bankRowId } = await linkWithBackfilledRow();
          const before = await historyBeforeSeam({ accountId });
          const fromSeam = await historyFromSeam({ accountId });

          expect((await helpers.reconciliationRemove({ transactionIds: [bankRowId] })).statusCode).toBe(200);

          // Without the −25.00 row the opening balance is the seam balance, flat up to the link day.
          const removed = await historyBeforeSeam({ accountId });
          expect(removed.initialBalance).toBeCloseTo(before.initialBalance - 25, 2);
          expect(removed.chart).toEqual(
            PAST_DAYS.map((daysAgo) => chartOn({ chart: before.chart, daysAgo: daysAgo === 6 ? 5 : daysAgo })),
          );
          expect(await historyFromSeam({ accountId })).toEqual(fromSeam);

          expect((await helpers.reconciliationRestore({ transactionIds: [bankRowId] })).statusCode).toBe(200);

          expect(await historyBeforeSeam({ accountId })).toEqual(before);
          expect(await historyFromSeam({ accountId })).toEqual(fromSeam);
        },
      });
    });

    it('refuses deleting a pre-link bank row the first sync backfilled', async () => {
      await asEurBaseUser({
        fn: async () => {
          const { accountId, bankRowId } = await linkWithBackfilledRow();
          const before = await historyBeforeSeam({ accountId });
          const fromSeam = await historyFromSeam({ accountId });

          expect((await helpers.deleteTransaction({ id: bankRowId })).statusCode).toBe(ERROR_CODES.ValidationError);
          const bulkDeleted = await helpers.bulkDeleteTransactions({ payload: { transactionIds: [bankRowId] } });
          expect(bulkDeleted.statusCode).toBe(ERROR_CODES.ValidationError);

          expect((await bankRowsOf({ accountId })).map((tx) => tx.id)).toEqual([bankRowId]);
          expect(await historyBeforeSeam({ accountId })).toEqual(before);
          expect(await historyFromSeam({ accountId })).toEqual(fromSeam);
        },
      });
    });

    it('rebuilds the history before the link when two backfilled bank duplicates are merged', async () => {
      await asEurBaseUser({
        fn: async () => {
          const account = await createManualAccount({ currencyCode: 'EUR' });
          const { connectionId } = await authorizedConnection();
          helpers.enablebanking.setFixedTransactions([
            bookedRow({ daysAgo: 5, reference: 'first' }),
            bookedRow({ daysAgo: 5, reference: 'second' }),
          ]);
          await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });

          const [survivor, duplicate] = await bankRowsOf({ accountId: account.id });
          expect(duplicate).toBeDefined();
          const before = await historyBeforeSeam({ accountId: account.id });
          const fromSeam = await historyFromSeam({ accountId: account.id });

          const merged = await helpers.reconciliationMerge({
            transactionIds: [survivor!.id as RecordId, duplicate!.id as RecordId],
            survivorId: survivor!.id as RecordId,
          });
          expect(merged.statusCode).toBe(200);

          const after = await historyBeforeSeam({ accountId: account.id });
          expect(after.initialBalance).toBeCloseTo(before.initialBalance - 25, 2);
          expect(chartOn({ chart: after.chart, daysAgo: 6 })).toBe(chartOn({ chart: before.chart, daysAgo: 6 }) - 2500);
          expect(chartOn({ chart: after.chart, daysAgo: 5 })).toBe(chartOn({ chart: before.chart, daysAgo: 5 }));
          expect(await historyFromSeam({ accountId: account.id })).toEqual(fromSeam);
        },
      });
    });

    it('keeps the bank link in externalData across syncs that record pending payments', async () => {
      const account = await createManualAccount({ currencyCode: 'EUR' });
      await createManualRow({ accountId: account.id, daysAgo: 10 });
      const { connectionId } = await authorizedConnection();
      helpers.enablebanking.setFixedTransactions([
        { ...bookedRow({ daysAgo: 0, reference: 'pending' }), status: 'PDNG' },
      ]);

      await link({ accountId: account.id, connectionId, externalAccountId: MOCK_IDENTIFICATION_HASH_1 });
      helpers.enablebanking.setFixedTransactions([bookedRow({ daysAgo: 0, reference: 'booked' })]);
      await syncAccount({ connectionId, accountId: account.id });

      expect((await helpers.readAccount({ accountId: account.id })).bankSeamAt).toBe(TODAY.toISOString());
    });
  });

  describe('Monobank', () => {
    it('rebuilds the history before the link once the queued sync stores the seam', async () => {
      const account = await createManualAccount({ currencyCode: 'USD' });
      // Own token: the token hash keys the queue lane, which other files' leftover jobs share.
      const { connectionId } = await helpers.monobank.pair('seam-sync-monobank-token');
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });
      const usdAccount = externalAccounts.find((external) => external.currency === 'USD')!;

      global.mswMockServer.use(
        getMonobankTransactionsMock({
          response: [
            helpers.monobank.buildTransaction({ time: subDays(new Date(), 5), amount: -100, balance: 900 }),
            helpers.monobank.buildTransaction({ time: new Date(), amount: -50, balance: 850 }),
          ],
        }),
      );

      await link({ accountId: account.id, connectionId, externalAccountId: usdAccount.externalId });

      // The seam is stored after the queued sync lands its rows, together with the rebuilt history.
      const deadline = Date.now() + 10_000;
      while (!(await helpers.readAccount({ accountId: account.id })).bankSeamAt) {
        if (Date.now() > deadline) throw new Error('The queued Monobank sync did not store the seam within 10s');
        await helpers.sleep(250);
      }
      expect(await bankRowsOf({ accountId: account.id })).toHaveLength(2);

      // Seam balance 9.00 USD; the day before the pre-link -1.00 row holds 10.00 USD, both in AED.
      const rows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });
      expect(rows.filter((row) => format(new Date(row.date), 'yyyy-MM-dd') < TODAY_KEY)).toEqual([
        { date: dayKey({ daysAgo: 6 }), amount: 36.73 },
        { date: dayKey({ daysAgo: 5 }), amount: 33.06 },
      ]);

      const accountBefore = await helpers.readAccount({ accountId: account.id });
      expect(accountBefore.bankSeamAt).toBe(TODAY.toISOString());
      const preSeamBankRow = (await bankRowsOf({ accountId: account.id })).find(
        (tx) => format(new Date(tx.time), 'yyyy-MM-dd') < TODAY_KEY,
      )!;
      const edited = await helpers.updateTransaction({ id: preSeamBankRow.id, payload: { amount: 10 } });
      expect(edited.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getTransactionById({ id: preSeamBankRow.id, raw: true }))!.amount).toBe(1);
      expect(await helpers.readAccount({ accountId: account.id })).toEqual(accountBefore);
      expect(await helpers.getBalanceHistory({ accountId: account.id, raw: true })).toEqual(rows);
    });
  });
});
