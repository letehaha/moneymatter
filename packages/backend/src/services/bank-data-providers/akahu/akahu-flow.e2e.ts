import { BANK_PROVIDER_TYPE, TRANSACTION_TYPES, asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import type { AkahuApiTransactionsResponse } from '@services/bank-data-providers/akahu/types';
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
  getAkahuTransactionsMock,
} from '@tests/mocks/akahu/mock-api';
import { HttpResponse, http } from 'msw';

/**
 * E2E tests for the Akahu (NZ open banking, personal app) Data Provider.
 * Covers connect → list accounts → connect accounts → sync → dedup →
 * stale-data refresh trigger → period load → credential update.
 */
describe('Akahu Data Provider E2E', () => {
  describe('Connection management', () => {
    it('is listed as a supported provider', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      const akahuProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.AKAHU);
      expect(akahuProvider).toEqual(
        expect.objectContaining({
          name: 'Akahu',
          features: expect.objectContaining({ supportsAutoSync: true, supportsWebhooks: false }),
        }),
      );
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
    it('returns only ACTIVE accounts with the TRANSACTIONS attribute', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      const ids = accounts.map((a: { externalId: string }) => a.externalId);

      expect(ids).toEqual(expect.arrayContaining([AKAHU_ACCOUNT_1_ID]));
      expect(ids).not.toContain(AKAHU_ACCOUNT_NO_TX_ID);
      expect(ids).not.toContain(AKAHU_ACCOUNT_INACTIVE_ID);

      const first = accounts.find((a: { externalId: string }) => a.externalId === AKAHU_ACCOUNT_1_ID);
      expect(first).toEqual(
        expect.objectContaining({
          balance: expect.closeTo(1523.45),
          currency: 'NZD',
          metadata: expect.objectContaining({ institutionName: 'Test Bank NZ' }),
        }),
      );
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
          mockedTransactions: transactions ?? getMockedAkahuTransactions(MOCK_AMOUNT, AKAHU_ACCOUNT_1_ID),
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
      expect(rows.map((r) => r.originalId).sort()).toEqual(['trans_late', 'trans_newer']);
    });

    it('triggers a manual Akahu refresh when cached data is stale', async () => {
      let refreshRequested = false;
      const staleAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
      const staleAccount = {
        success: true,
        item: {
          _id: AKAHU_ACCOUNT_1_ID,
          name: 'Everyday Account',
          type: 'CHECKER',
          status: 'ACTIVE',
          balance: { available: asDecimal(100), current: asDecimal(100), currency: 'NZD' },
          attributes: ['TRANSACTIONS'],
          refreshed: { balance: staleAt, transactions: staleAt },
        },
      };

      global.mswMockServer.use(
        http.post(`${AKAHU_BASE_URL}/refresh`, () => {
          refreshRequested = true;
          return HttpResponse.json({ success: true });
        }),
        http.get(`${AKAHU_BASE_URL}/accounts/${AKAHU_ACCOUNT_1_ID}`, () => HttpResponse.json(staleAccount)),
      );

      const { connectionId } = await helpers.akahu.pairAkahuUser();
      // connectSelectedAccounts waits for the initial sync — which runs the
      // stale-data check that should fire POST /refresh.
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [AKAHU_ACCOUNT_1_ID],
        raw: true,
      });

      expect(refreshRequested).toBe(true);
    });
  });

  describe('Period load', () => {
    it('dedups rows already imported by the initial sync', async () => {
      const { connectionId, account } = await (async () => {
        const conn = await helpers.akahu.pairAkahuUser();
        return {
          connectionId: conn.connectionId,
          ...(await helpers.akahu.connectAccountsAndSync({
            connectionId: conn.connectionId,
            accountId: AKAHU_ACCOUNT_1_ID,
            mockedTransactions: getMockedAkahuTransactions(1, AKAHU_ACCOUNT_1_ID),
          })),
        };
      })();

      const before = await Transactions.count({ where: { accountId: account.id } });

      // Same id as the imported row, plus two older ones the incremental sync
      // never fetched. The handler must also receive the requested window.
      const feed = getMockedAkahuTransactions(3, AKAHU_ACCOUNT_1_ID);
      feed.items[0]!._id = 'trans_0_11111111';
      let sawWindow = false;
      global.mswMockServer.use(
        http.get(new RegExp(`${AKAHU_BASE_URL}/accounts/acc_[a-z0-9]+/transactions`), ({ request }) => {
          const url = new URL(request.url);
          sawWindow = Boolean(url.searchParams.get('start') && url.searchParams.get('end'));
          return HttpResponse.json(feed);
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/load-transactions-for-period`,
        payload: {
          accountId: account.id,
          from: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
          to: new Date().toISOString(),
        },
        raw: true,
      });

      expect(sawWindow).toBe(true);
      expect(result.jobGroupId).toBeNull();
      const after = await Transactions.count({ where: { accountId: account.id } });
      // The overlapping id is skipped; the two older ids are new history.
      expect(after).toBe(before + 2);
    });
  });

  describe('Credential updates', () => {
    it('accepts a fresh token pair', async () => {
      const { connectionId } = await helpers.akahu.pairAkahuUser();

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectionId}`,
        payload: { credentials: { userToken: VALID_AKAHU_USER_TOKEN, appToken: VALID_AKAHU_APP_TOKEN } },
        raw: true,
      });
      expect(result).toBeDefined();

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

  describe('Unlink → relink dedup', () => {
    it('does not duplicate transactions when the account is unlinked and relinked', async () => {
      const MOCK_AMOUNT = 3;
      const { connectionId, account } = await (async () => {
        const conn = await helpers.akahu.pairAkahuUser();
        return {
          connectionId: conn.connectionId,
          ...(await helpers.akahu.connectAccountsAndSync({
            connectionId: conn.connectionId,
            accountId: AKAHU_ACCOUNT_1_ID,
            mockedTransactions: getMockedAkahuTransactions(MOCK_AMOUNT, AKAHU_ACCOUNT_1_ID),
          })),
        };
      })();

      await helpers.makeRequest({ method: 'post', url: `/accounts/${account.id}/unlink`, raw: true });

      global.mswMockServer.use(
        getAkahuTransactionsMock({ response: getMockedAkahuTransactions(MOCK_AMOUNT, AKAHU_ACCOUNT_1_ID) }),
      );
      await helpers.makeRequest({
        method: 'post',
        url: `/accounts/${account.id}/link`,
        payload: { connectionId },
        raw: true,
      });
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId: account.id,
        raw: true,
      });

      const rows = await Transactions.findAll({ where: { accountId: account.id }, raw: true });
      // No duplicates. Relink clamps the fetch to linkedAt, which is after every
      // stored row, so the pre-link history is not re-processed and originalId stays cleared.
      expect(rows.length).toBe(MOCK_AMOUNT);
      expect(rows.every((r) => r.originalId === null)).toBe(true);
    });
  });
});
