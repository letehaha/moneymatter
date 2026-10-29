import { BANK_PROVIDER_TYPE, DEACTIVATION_REASON, TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import type { AkahuApiTransaction, AkahuApiTransactionsResponse } from '@services/bank-data-providers/akahu/types';
import * as helpers from '@tests/helpers';
import {
  AKAHU_ACCOUNT_1_ID,
  AKAHU_ACCOUNT_INACTIVE_ID,
  AKAHU_ACCOUNT_NO_TX_ID,
  getMockedAkahuTransactions,
} from '@tests/mocks/akahu/data';
import {
  AKAHU_BASE_URL,
  INVALID_AKAHU_USER_TOKEN,
  VALID_AKAHU_APP_TOKEN,
  VALID_AKAHU_USER_TOKEN,
  akahuHandlers,
  getAkahuTransactionsMock,
} from '@tests/mocks/akahu/mock-api';
import { addHours, subDays } from 'date-fns';
import { HttpResponse, http } from 'msw';
import { Op } from 'sequelize';

const feed = (
  items: (Pick<AkahuApiTransaction, '_id' | 'amount' | 'date'> & Partial<AkahuApiTransaction>)[],
): AkahuApiTransactionsResponse => ({
  success: true,
  cursor: { next: null },
  items: items.map((tx) => ({ _account: AKAHU_ACCOUNT_1_ID, description: `Row ${tx._id}`, type: 'EFTPOS', ...tx })),
});

const VALID_CREDENTIALS = { userToken: VALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN };

describe('Akahu Data Provider E2E', () => {
  describe('Connection management', () => {
    it('is listed as a supported provider', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      const akahuProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.AKAHU);
      expect(akahuProvider).toMatchObject({
        name: 'Akahu',
        features: { supportsAutoSync: true, supportsWebhooks: false },
      });
    });

    it('connects with a valid token pair', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();
      expect(connectionId).toBeDefined();

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectionId);
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.AKAHU);
      expect(connection?.providerName).toBe('Akahu');
      expect(connection?.isActive).toBe(true);
    });

    it('rejects an invalid token pair with Forbidden and creates no connection', async () => {
      const { connections: before } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.AKAHU}/connect`,
        payload: { credentials: { userToken: INVALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.Forbidden);

      const { connections: after } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(after.length).toBe(before.length);
    });

    it('reports an Akahu outage during connect as ServiceUnavailable and creates no connection', async () => {
      const { connections: before } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      global.mswMockServer.use(
        http.get(`${AKAHU_BASE_URL}/me`, () => HttpResponse.json({ success: false }, { status: 500 })),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.AKAHU}/connect`,
        payload: { credentials: VALID_CREDENTIALS },
      });
      expect(result.status).toEqual(ERROR_CODES.ServiceUnavailable);

      const { connections: after } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(after.length).toBe(before.length);
    });

    it('rejects missing fields with ValidationError', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.AKAHU}/connect`,
        payload: { credentials: { userToken: VALID_AKAHU_USER_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('names a second connection with a counter', async () => {
      await helpers.akahu.pairAkahuUser();
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectionId);
      expect(connection?.providerName).toBe('Akahu (2)');
    });
  });

  describe('Account listing', () => {
    it('returns ACTIVE accounts, including balance-only ones without TRANSACTIONS', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      const ids = accounts.map((a: { externalId: string }) => a.externalId);

      expect(ids).toEqual(expect.arrayContaining([AKAHU_ACCOUNT_1_ID]));
      expect(ids).toContain(AKAHU_ACCOUNT_NO_TX_ID);
      expect(ids).not.toContain(AKAHU_ACCOUNT_INACTIVE_ID);

      const first = accounts.find((a: { externalId: string }) => a.externalId === AKAHU_ACCOUNT_1_ID);
      expect(first).toMatchObject({ balance: 1523.45, currency: 'NZD', metadata: { institutionName: 'Test Bank NZ' } });
    });
  });

  describe('Transaction sync', () => {
    const MOCK_AMOUNT = 5;

    const connectAndSync = async (transactions?: AkahuApiTransactionsResponse) => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();
      return {
        connectionId,
        ...(await helpers.akahu.connectAccountsAndSync({
          connectionId,
          accountId: AKAHU_ACCOUNT_1_ID,
          mockedTransactions: transactions ?? getMockedAkahuTransactions({ amount: MOCK_AMOUNT }),
        })),
      };
    };

    it('imports the feed with signed amounts mapped to income/expense', async () => {
      const { account, transactions } = await connectAndSync();

      expect(transactions.length).toBe(MOCK_AMOUNT);
      for (const tx of transactions) {
        // Amounts are stored unsigned; direction lives in transactionType.
        expect(Number(tx.amount)).toBeGreaterThan(0);
        expect(tx.originalId).toMatch(/^trans_/);
        expect(tx.accountType).toBe('akahu');
        expect(tx.currencyCode).toBe('NZD');
      }

      const types = transactions.map((t) => t.transactionType);
      // Mock alternates: index % 3 === 0 → positive (income). 5 rows → 2 income (0,3), 3 expense.
      expect(types.filter((t) => t === TRANSACTION_TYPES.income).length).toBe(2);
      expect(types.filter((t) => t === TRANSACTION_TYPES.expense).length).toBe(3);
      expect(account.currentBalance.toNumber()).toBeCloseTo(1523.45);
    });

    it('stores absolute decimal amounts with direction and note per row', async () => {
      const date = new Date().toISOString();
      const { transactions } = await connectAndSync(
        feed([
          { _id: 'trans_in', amount: asDecimal(10), date, type: 'DIRECT CREDIT' },
          { _id: 'trans_out', amount: asDecimal(-11), date },
          {
            _id: 'trans_frac',
            amount: asDecimal(-12.35),
            date,
            description: 'COFFEE CO LTD AUCKLAND',
            merchant: { _id: 'merchant_coffee', name: 'Coffee Co' },
          },
        ]),
      );

      const byId = Object.fromEntries(transactions.map((tx) => [String(tx.originalId), tx]));
      expect(Object.keys(byId).toSorted()).toEqual(['trans_frac', 'trans_in', 'trans_out']);
      expect(byId.trans_in).toMatchObject({ transactionType: TRANSACTION_TYPES.income, amount: 10 });
      expect(byId.trans_out).toMatchObject({ transactionType: TRANSACTION_TYPES.expense, amount: 11 });
      expect(byId.trans_frac).toMatchObject({
        transactionType: TRANSACTION_TYPES.expense,
        amount: 12.35,
        note: 'COFFEE CO LTD AUCKLAND',
      });
    });

    it('does not duplicate transactions on re-sync', async () => {
      const { connectionId, account } = await connectAndSync();

      global.mswMockServer.use(getAkahuTransactionsMock({ accountId: AKAHU_ACCOUNT_1_ID }));
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId: account.id,
        raw: true,
      });

      const rows = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      expect(rows.length).toBe(MOCK_AMOUNT);
    });

    it('imports rows that settle after a newer row was already synced', async () => {
      const today = new Date();
      const firstFeed: AkahuApiTransactionsResponse = {
        success: true,
        items: [
          {
            _id: 'trans_newer',
            _account: AKAHU_ACCOUNT_1_ID,
            date: today.toISOString(),
            description: 'Newer settled',
            amount: asDecimal(-10),
            type: 'EFTPOS',
          },
        ],
        cursor: { next: null },
      };
      const { connectionId, account } = await connectAndSync(firstFeed);
      expect((await Transactions.findAll({ where: { accountId: account.id }, raw: true })).length).toBe(1);

      // Same-day late-settling card purchase revealed after the newer row.
      const secondFeed: AkahuApiTransactionsResponse = {
        success: true,
        items: [
          ...firstFeed.items,
          {
            _id: 'trans_late',
            _account: AKAHU_ACCOUNT_1_ID,
            date: today.toISOString(),
            description: 'Late-settling purchase',
            amount: asDecimal(-20),
            type: 'EFTPOS',
          },
        ],
        cursor: { next: null },
      };
      global.mswMockServer.use(getAkahuTransactionsMock({ response: secondFeed, accountId: AKAHU_ACCOUNT_1_ID }));
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId: account.id,
        raw: true,
      });

      const rows = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      expect(rows.map((r) => r.originalId).toSorted()).toEqual(['trans_late', 'trans_newer']);
    });

    it('imports rows from every cursor page', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();
      const pages: (string | null)[] = [];
      global.mswMockServer.use(
        getAkahuTransactionsMock({
          response: getMockedAkahuTransactions({ amount: 3 }),
          accountId: AKAHU_ACCOUNT_1_ID,
          pageSize: 2,
          onRequest: (params) => pages.push(params.get('cursor')),
        }),
      );

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [AKAHU_ACCOUNT_1_ID],
        raw: true,
      });

      expect(pages).toEqual([null, '2']);
      expect(await Transactions.count({ where: { accountId: syncedAccounts[0]!.id } })).toBe(3);
    });

    it('fetches the full feed first, then from 14 days before the newest imported row', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();
      const starts: (string | null)[] = [];
      global.mswMockServer.use(
        getAkahuTransactionsMock({
          response: getMockedAkahuTransactions({ amount: MOCK_AMOUNT }),
          accountId: AKAHU_ACCOUNT_1_ID,
          onRequest: (params) => starts.push(params.get('start')),
        }),
      );

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [AKAHU_ACCOUNT_1_ID],
        raw: true,
      });
      const accountId = syncedAccounts[0]!.id;
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const newest = await Transactions.findOne({ where: { accountId }, order: [['time', 'DESC']] });
      expect(starts).toEqual([
        null,
        new Date(new Date(newest!.time).getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      ]);
    });

    it('keeps the connection active on an Akahu 5xx and recovers on the next sync', async () => {
      const { connectionId, account } = await connectAndSync();

      global.mswMockServer.use(
        http.get(`${AKAHU_BASE_URL}/accounts/${AKAHU_ACCOUNT_1_ID}/transactions`, () =>
          HttpResponse.json({ success: false }, { status: 500 }),
        ),
      );
      const failed = await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId: account.id,
      });
      expect(failed.status).toBe(ERROR_CODES.ServiceUnavailable);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(true);

      global.mswMockServer.use(
        getAkahuTransactionsMock({
          response: getMockedAkahuTransactions({ amount: MOCK_AMOUNT + 2 }),
          accountId: AKAHU_ACCOUNT_1_ID,
        }),
      );
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });

      expect(await Transactions.count({ where: { accountId: account.id } })).toBe(MOCK_AMOUNT + 2);
    });

    it('resets the auth-failure count after a successful sync', async () => {
      const { connectionId, account } = await connectAndSync();
      const unauthorizedTransactions = http.get(
        `${AKAHU_BASE_URL}/accounts/${AKAHU_ACCOUNT_1_ID}/transactions`,
        () => new HttpResponse(null, { status: 401 }),
      );
      const sync = () => helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id });

      global.mswMockServer.use(unauthorizedTransactions);
      expect((await sync()).status).toBe(ERROR_CODES.Forbidden);

      global.mswMockServer.use(getAkahuTransactionsMock({ accountId: AKAHU_ACCOUNT_1_ID }));
      expect((await sync()).status).toBe(200);

      global.mswMockServer.use(unauthorizedTransactions);
      expect((await sync()).status).toBe(ERROR_CODES.Forbidden);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(true);
    });

    it('deactivates after two 401 syncs and syncs again once fresh tokens are saved', async () => {
      const { connectionId, account } = await connectAndSync(getMockedAkahuTransactions({ amount: 1 }));
      const sync = () => helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id });

      global.mswMockServer.use(
        http.all(new RegExp(`${AKAHU_BASE_URL}/.*`), () => new HttpResponse(null, { status: 401 })),
      );
      await sync();
      await sync();

      const { connection: deactivated } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(deactivated).toMatchObject({ isActive: false, deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE });

      global.mswMockServer.use(...akahuHandlers);
      await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        credentials: VALID_CREDENTIALS,
        raw: true,
      });

      const { connection: reactivated } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(reactivated).toMatchObject({ isActive: true, deactivationReason: null });

      expect((await sync()).status).toBe(200);
      expect(await Transactions.count({ where: { accountId: account.id } })).toBe(MOCK_AMOUNT);
    });

    it('deactivates when the account read succeeds but the transactions read is rejected twice', async () => {
      const { connectionId, account } = await connectAndSync();
      global.mswMockServer.use(
        http.get(
          `${AKAHU_BASE_URL}/accounts/${AKAHU_ACCOUNT_1_ID}/transactions`,
          () => new HttpResponse(null, { status: 403 }),
        ),
      );

      for (let i = 0; i < 2; i++) {
        await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId: account.id });
      }

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection).toMatchObject({ isActive: false, deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE });
    });

    const staleAccountMock = () => {
      const staleAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      return http.get(`${AKAHU_BASE_URL}/accounts/${AKAHU_ACCOUNT_1_ID}`, () =>
        HttpResponse.json({
          success: true,
          item: {
            _id: AKAHU_ACCOUNT_1_ID,
            name: 'Everyday Account',
            type: 'CHECKING',
            status: 'ACTIVE',
            balance: { available: asDecimal(100), current: asDecimal(100), currency: 'NZD' },
            attributes: ['TRANSACTIONS'],
            refreshed: { balance: staleAt, transactions: staleAt },
          },
        }),
      );
    };

    it('triggers a manual Akahu refresh of the stale account', async () => {
      let refreshContentType: string | null = null;

      global.mswMockServer.use(
        http.post(`${AKAHU_BASE_URL}/refresh/${AKAHU_ACCOUNT_1_ID}`, ({ request }) => {
          refreshContentType = request.headers.get('content-type');
          return HttpResponse.json({ success: true });
        }),
        staleAccountMock(),
      );

      const { connectionId } = await helpers.akahu.pairAkahuUser();
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [AKAHU_ACCOUNT_1_ID],
        raw: true,
      });

      expect(refreshContentType).toContain('application/json');
    });

    it('still imports the feed when the stale-account refresh request fails', async () => {
      global.mswMockServer.use(
        http.post(`${AKAHU_BASE_URL}/refresh/${AKAHU_ACCOUNT_1_ID}`, () =>
          HttpResponse.json({ success: false }, { status: 500 }),
        ),
        staleAccountMock(),
      );

      const { transactions } = await connectAndSync();

      expect(transactions.length).toBe(MOCK_AMOUNT);
    });

    it('does not request a refresh when cached data is fresh', async () => {
      let refreshRequested = false;
      global.mswMockServer.use(
        http.post(new RegExp(`${AKAHU_BASE_URL}/refresh`), () => {
          refreshRequested = true;
          return HttpResponse.json({ success: true });
        }),
      );

      await connectAndSync();

      expect(refreshRequested).toBe(false);
    });
  });

  describe('Period load', () => {
    it('imports new rows in the window and skips the already-imported one', async () => {
      const conn = await helpers.akahu.pairAkahuUser();
      const { account } = await helpers.akahu.connectAccountsAndSync({
        connectionId: conn.connectionId,
        accountId: AKAHU_ACCOUNT_1_ID,
        mockedTransactions: getMockedAkahuTransactions({ amount: 1 }),
      });
      const before = await Transactions.count({ where: { accountId: account.id } });

      const NEW_ROWS = 3;
      // Row 0 shares the id of the already-imported row.
      const response = getMockedAkahuTransactions({ amount: NEW_ROWS + 1 });
      const from = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const to = new Date();
      let sentWindow: { start: string | null; end: string | null } | undefined;
      global.mswMockServer.use(
        getAkahuTransactionsMock({
          response,
          accountId: AKAHU_ACCOUNT_1_ID,
          onRequest: (params) => (sentWindow = { start: params.get('start'), end: params.get('end') }),
        }),
      );

      const result = await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId: conn.connectionId,
        accountId: account.id,
        from: from.toISOString(),
        to: to.toISOString(),
        raw: true,
      });

      expect(sentWindow).toEqual({
        start: new Date(from.getTime() - 1).toISOString(),
        end: to.toISOString(),
      });
      expect(result.jobGroupId).toBeNull();
      expect(await Transactions.count({ where: { accountId: account.id } })).toBe(before + NEW_ROWS);
    });
  });

  describe('Credential updates', () => {
    it('accepts a fresh token pair', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectionId}`,
        payload: { credentials: { userToken: VALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN } },
      });
      expect(result.status).toBe(200);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(true);
    });

    it('rejects invalid replacement credentials', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      global.mswMockServer.use(http.get(`${AKAHU_BASE_URL}/me`, () => new HttpResponse(null, { status: 401 })));

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectionId}`,
        payload: { credentials: { userToken: INVALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.Forbidden);
    });
  });

  describe('Disconnect', () => {
    it('removes the connection row', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      await helpers.makeRequest({
        method: 'delete',
        url: `/bank-data-providers/connections/${connectionId}`,
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(connections.find((c: { id: string }) => c.id === connectionId)).toBeUndefined();
    });
  });

  describe('Linking an existing account', () => {
    it('imports only feed rows dated after the link time', async () => {
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'NZD' });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const now = new Date();
      global.mswMockServer.use(
        getAkahuTransactionsMock({
          accountId: AKAHU_ACCOUNT_1_ID,
          response: feed([
            { _id: 'trans_pre_old', amount: asDecimal(-20), date: subDays(now, 3).toISOString() },
            { _id: 'trans_pre_recent', amount: asDecimal(-15), date: subDays(now, 1).toISOString() },
            { _id: 'trans_post', amount: asDecimal(-7), date: addHours(now, 1).toISOString() },
          ]),
        }),
      );
      await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: AKAHU_ACCOUNT_1_ID,
        raw: true,
      });

      const imported = await Transactions.findAll({
        where: { accountId: account.id, originalId: { [Op.ne]: null } },
        raw: true,
      });
      expect(imported.map((tx) => tx.originalId)).toEqual(['trans_post']);
    });

    it('does not duplicate transactions when the account is unlinked and relinked', async () => {
      const MOCK_AMOUNT = 3;
      const mockedTransactions = getMockedAkahuTransactions({ amount: MOCK_AMOUNT });
      const { connectionId } = await helpers.akahu.pairAkahuUser();
      const { account } = await helpers.akahu.connectAccountsAndSync({
        connectionId,
        accountId: AKAHU_ACCOUNT_1_ID,
        mockedTransactions,
      });

      await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });

      const unlinked = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      expect(unlinked.length).toBe(MOCK_AMOUNT);
      for (const tx of unlinked) {
        expect(tx.originalId).toBeNull();
        expect(tx.externalData).toMatchObject({ originalSource: { originalId: expect.stringMatching(/^trans_/) } });
      }

      global.mswMockServer.use(
        getAkahuTransactionsMock({ response: mockedTransactions, accountId: AKAHU_ACCOUNT_1_ID }),
      );
      await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: AKAHU_ACCOUNT_1_ID,
        raw: true,
      });

      const rows = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      expect(rows.length).toBe(MOCK_AMOUNT);
      expect(rows.filter((r) => r.originalId).length).toBe(MOCK_AMOUNT);
    });
  });
});
