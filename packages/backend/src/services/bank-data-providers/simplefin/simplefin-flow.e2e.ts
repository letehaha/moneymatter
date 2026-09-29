import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  type RecordId,
  TRANSACTION_TYPES,
  asDecimal,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import Transactions from '@models/transactions.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import {
  SIMPLEFIN_ACCOUNT_1,
  SIMPLEFIN_ACCOUNT_2,
  getMockedSimplefinAccountSet,
  getMockedSimplefinAccountSetV2,
  getMockedSimplefinTransactions,
  getMockedSimplefinTransactionsOnDaysAgo,
  getMockedSimplefinTransactionsWithPending,
} from '@tests/mocks/simplefin/data';
import {
  INVALID_SIMPLEFIN_SETUP_TOKEN,
  NON_URL_SIMPLEFIN_SETUP_TOKEN,
  RATE_LIMITED_SIMPLEFIN_SETUP_TOKEN,
  SERVER_ERROR_SIMPLEFIN_SETUP_TOKEN,
  VALID_SIMPLEFIN_SETUP_TOKEN,
  createSimplefinAccountsRecorder,
  getSimplefinAccountsErrorMock,
  getSimplefinAccountsMock,
} from '@tests/mocks/simplefin/mock-api';
import { addDays, subDays, subHours } from 'date-fns';
import { Op } from 'sequelize';

import { SyncStatus } from '../sync/sync-status-tracker';
import type { SimplefinTransaction } from './types';

/**
 * E2E tests for the SimpleFIN Bridge data provider.
 * Covers the full flow: setup-token claim → connect → list/import accounts →
 * transaction sync (incremental + period load), plus error and empty states.
 */
const connectSimplefin = async (setupToken: string = VALID_SIMPLEFIN_SETUP_TOKEN): Promise<string> => {
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
    credentials: { setupToken },
    raw: true,
  });
  return connectionId;
};

const importFirstAccount = async (connectionId: string): Promise<string> => {
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
    raw: true,
  });
  return syncedAccounts[0]!.id;
};

/** Connect, expose the given transactions on the first account, then import it. */
const connectAndImport = async (
  account1Transactions = getMockedSimplefinTransactions(5),
): Promise<{ connectionId: string; accountId: string }> => {
  const connectionId = await connectSimplefin();
  global.mswMockServer.use(
    getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Transactions }) }),
  );
  const accountId = await importFirstAccount(connectionId);
  return { connectionId, accountId };
};

const toEpochSeconds = ({ date }: { date: Date }): number => Math.floor(date.getTime() / 1000);

/** A bank-side copy of a spend the user already tracked manually. */
const buildBankTransaction = ({ postedAt, amount }: { postedAt: Date; amount: number }): SimplefinTransaction => ({
  id: `bank-copy-${toEpochSeconds({ date: postedAt })}`,
  posted: toEpochSeconds({ date: postedAt }),
  amount: amount.toFixed(2),
  description: 'Bank copy of a manually tracked spend',
  payee: 'Coffee Shop',
  memo: '',
  pending: false,
});

/** A manual account holding one manual expense, ready to be linked to a connection. */
const createTrackedAccount = async ({ manualSpentAt }: { manualSpentAt: Date }): Promise<string> => {
  await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({
      name: 'Manually tracked checking',
      currencyCode: 'USD',
      initialBalance: 1000,
    }),
    raw: true,
  });

  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 40,
      transactionType: TRANSACTION_TYPES.expense,
      time: manualSpentAt.toISOString(),
    }),
    raw: true,
  });

  return account.id;
};

const waitForCompletedSync = async ({ accountId }: { accountId: string }): Promise<void> => {
  await helpers.bankDataProviders.waitForAccountsSyncToSettle();
  const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
  expect(accounts.find((account) => account.accountId === accountId)?.status).toBe(SyncStatus.COMPLETED);
};

describe('SimpleFIN Data Provider E2E', () => {
  describe('Complete connection flow', () => {
    it('completes: list providers -> connect -> list connections -> list external accounts -> import -> details', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });
      const simplefinProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.SIMPLEFIN)!;
      expect(simplefinProvider).toBeDefined();
      expect(simplefinProvider.name).toBe('SimpleFIN');

      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });
      expect(connectResult.connectionId).toBeDefined();
      const { connectionId } = connectResult;

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectionId);
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.SIMPLEFIN);
      expect(connection?.providerName).toBe('SimpleFIN');
      expect(connection?.isActive).toBe(true);

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });
      expect(externalAccounts.length).toBe(2);
      expect(externalAccounts.map((a: { externalId: string }) => a.externalId)).toEqual(
        expect.arrayContaining([SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2]),
      );

      // Embed transactions on the checking account for the initial sync.
      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({ account1Transactions: getMockedSimplefinTransactions(3) }),
        }),
      );

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2],
        raw: true,
      });
      expect(syncedAccounts.length).toBe(2);

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(details.accounts.length).toBe(2);
      details.accounts.forEach((account: { currencyCode: string }) => {
        expect(account.currencyCode).toBe('USD');
      });
    });
  });

  describe('Connect provider', () => {
    it('connects with a valid setup token', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });
      expect(result.connectionId).toBeDefined();
    });

    it('auto-names the connection "SimpleFIN"', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });
      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);
      expect(connection?.providerName).toBe('SimpleFIN');
    });

    it('fails with an invalid / used setup token', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { setupToken: INVALID_SIMPLEFIN_SETUP_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.Forbidden);
    });

    it('fails with a missing setupToken field', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { wrongField: 'value' } },
      });
      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('does not create a connection on auth failure', async () => {
      const { connections: before } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { setupToken: INVALID_SIMPLEFIN_SETUP_TOKEN } },
      });

      const { connections: after } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(after.length).toBe(before.length);
    });

    it('names a second SimpleFIN connection "SimpleFIN (2)"', async () => {
      await connectSimplefin();
      const second = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const secondConnection = connections.find((c: { id: string }) => c.id === second.connectionId);
      expect(secondConnection?.providerName).toBe('SimpleFIN (2)');
    });

    it('rejects a setup token that does not decode to a URL', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { setupToken: NON_URL_SIMPLEFIN_SETUP_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('surfaces a claim rate-limit (429) instead of calling the token invalid', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { setupToken: RATE_LIMITED_SIMPLEFIN_SETUP_TOKEN } },
      });
      expect(result.status).toEqual(ERROR_CODES.TooManyRequests);
    });

    it('propagates a claim server error (5xx) rather than masking it as a bad token', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.SIMPLEFIN}/connect`,
        payload: { credentials: { setupToken: SERVER_ERROR_SIMPLEFIN_SETUP_TOKEN } },
      });
      expect(result.status).toBeGreaterThanOrEqual(500);
    });
  });

  describe('List external accounts', () => {
    it('returns 404 for a non-existent connection', async () => {
      const result = await helpers.bankDataProviders.listExternalAccounts({ connectionId: generateRandomRecordId() });
      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('returns accounts with the expected shape', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      const account = accounts[0]!;
      expect(account).toHaveProperty('externalId');
      expect(account).toHaveProperty('name');
      expect(account).toHaveProperty('balance');
      expect(account.currency).toBe('USD');
      expect(typeof account.balance).toBe('number');
      expect(account.metadata?.institutionDomain).toBe('testbank.example');
    });

    it('skips accounts whose currency is not an ISO code (e.g. crypto URL)', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      const customSet = getMockedSimplefinAccountSet();
      customSet.accounts.push({
        org: { name: 'Crypto Exchange' },
        id: 'ACT-CRYPTO',
        name: 'BTC Wallet',
        currency: 'https://example.com/currencies/btc',
        balance: '0.5',
        'balance-date': Math.floor(Date.now() / 1000),
        transactions: [],
      });
      global.mswMockServer.use(getSimplefinAccountsMock({ response: customSet }));

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      expect(accounts.length).toBe(2);
      expect(accounts.find((a: { externalId: string }) => a.externalId === 'ACT-CRYPTO')).toBeUndefined();
    });
  });

  describe('Transaction sync', () => {
    it('syncs transactions automatically when importing accounts', async () => {
      const MOCK_AMOUNT = 5;
      const { accountId } = await connectAndImport(getMockedSimplefinTransactions(MOCK_AMOUNT));

      const transactions = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(transactions.length).toBe(MOCK_AMOUNT);
    });

    it('skips pending transactions (posted = 0)', async () => {
      const MOCK_AMOUNT = 5;
      const { accountId } = await connectAndImport(getMockedSimplefinTransactionsWithPending(MOCK_AMOUNT));

      const transactions = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(transactions.length).toBe(MOCK_AMOUNT - 1);
    });

    it('does not duplicate transactions on re-sync', async () => {
      const MOCK_AMOUNT = 3;
      const transactions = getMockedSimplefinTransactions(MOCK_AMOUNT);
      const { connectionId, accountId } = await connectAndImport(transactions);

      // Re-sync with the same data.
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Transactions: transactions }) }),
      );
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const stored = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(stored.length).toBe(MOCK_AMOUNT);
    });

    it('does not re-import a row removed via reconciliation', async () => {
      const transactions = getMockedSimplefinTransactions(3);
      const { connectionId, accountId } = await connectAndImport(transactions);
      const [removed, ...kept] = await helpers.getTransactions({ accountIds: [accountId], raw: true });
      await helpers.reconciliationRemove({ transactionIds: [removed!.id as RecordId], raw: true });

      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Transactions: transactions }) }),
      );
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const after = await helpers.getTransactions({ accountIds: [accountId], raw: true });
      expect(after.map((tx) => tx.id).toSorted()).toEqual(kept.map((tx) => tx.id).toSorted());
      expect(after.filter((tx) => tx.originalId === removed!.originalId)).toEqual([]);
    });

    it('syncs zero transactions when the account has none (empty state)', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      // Default mock returns accounts with no transactions.
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: { accountId: { [Op.in]: syncedAccounts.map((a) => a.id) } },
        raw: true,
      });
      expect(transactions.length).toBe(0);
    });
  });

  describe('Batched connection sync', () => {
    it('imports all selected accounts in one batched pass (no per-account requests)', async () => {
      const connectionId = await connectSimplefin();

      // Transactions live on the first account; the second is empty.
      const txns = getMockedSimplefinTransactions(4);
      const recorder = createSimplefinAccountsRecorder({ account1Transactions: txns });
      global.mswMockServer.use(recorder.handler);

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2],
        raw: true,
      });
      expect(syncedAccounts.length).toBe(2);

      // The whole point of batching: every `/accounts` call fetches ALL accounts
      // at once, so none carry the single-account `account` filter. The old
      // per-account path would have set it on each windowed sync request.
      expect(recorder.requests.length).toBeGreaterThan(0);
      expect(recorder.requests.every((url) => url.searchParams.get('account') === null)).toBe(true);
      // Version is still negotiated on every request.
      expect(recorder.requests.every((url) => url.searchParams.get('version') === '2')).toBe(true);

      // Both accounts were processed from the single shared response.
      const account1Id = syncedAccounts.find((a) => a.externalId === SIMPLEFIN_ACCOUNT_1)!.id;
      const account2Id = syncedAccounts.find((a) => a.externalId === SIMPLEFIN_ACCOUNT_2)!.id;
      expect(await Transactions.count({ where: { accountId: account1Id } })).toBe(4);
      expect(await Transactions.count({ where: { accountId: account2Id } })).toBe(0);
    });

    it('persists current balance and writes a Balance history snapshot for today', async () => {
      // SimpleFIN does not provide a per-transaction balance, so the batched
      // sync is the only writer of balance history for the provider — without
      // this assertion a regression to "currentBalance updated, but no Balance
      // row written" would silently flatten the analytics chart.
      const connectionId = await connectSimplefin();

      // Default mock balances: ACCOUNT_1 = "1523.45" USD, ACCOUNT_2 = "850.00" USD.
      global.mswMockServer.use(getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet() }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2],
        raw: true,
      });

      const account1Id = syncedAccounts.find((a) => a.externalId === SIMPLEFIN_ACCOUNT_1)!.id;
      const account2Id = syncedAccounts.find((a) => a.externalId === SIMPLEFIN_ACCOUNT_2)!.id;

      const account1 = await helpers.getAccount({ id: account1Id, raw: true });
      const account2 = await helpers.getAccount({ id: account2Id, raw: true });

      // Account row carries the decimal-serialized balance from the response.
      expect(Number(account1.currentBalance)).toBe(1523.45);
      expect(Number(account2.currentBalance)).toBe(850);

      // A Balance row exists for today (date-only column) for each account.
      const balances1 = await Balances.findAll({ where: { accountId: account1Id } });
      const balances2 = await Balances.findAll({ where: { accountId: account2Id } });
      const today = new Date().toISOString().slice(0, 10);
      expect(balances1.some((b) => new Date(b.date).toISOString().slice(0, 10) === today)).toBe(true);
      expect(balances2.some((b) => new Date(b.date).toISOString().slice(0, 10) === today)).toBe(true);
    });
  });

  describe('Base-currency lock', () => {
    it('rejects a sync while the user holds the base-currency lock and writes no transactions', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      const { connectionId, accountId } = await connectAndImport(getMockedSimplefinTransactions(3));
      expect(await Transactions.count({ where: { accountId } })).toBe(3);

      // Fresh (new-id) transactions the sync would otherwise import.
      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({ account1Transactions: getMockedSimplefinTransactions(4) }),
        }),
      );

      await redisClient.set(buildLockKey(userId), 'test-lock');
      let response;
      try {
        response = await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      } finally {
        await redisClient.del(buildLockKey(userId));
      }

      expect(response.statusCode).toBe(ERROR_CODES.Locked);
      // No new rows landed against the old base.
      expect(await Transactions.count({ where: { accountId } })).toBe(3);
    });
  });

  describe('Load transactions for a period', () => {
    it('loads historical transactions for a selected window', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      // Import with no transactions so the initial sync inserts nothing.
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        raw: true,
      });
      const accountId = syncedAccounts[0]!.id;
      expect(await Transactions.count({ where: { accountId } })).toBe(0);

      // Now make historical transactions available and load a 90-day window.
      const PERIOD_AMOUNT = 4;
      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            account1Transactions: getMockedSimplefinTransactions(PERIOD_AMOUNT),
          }),
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/load-transactions-for-period`,
        payload: {
          accountId,
          from: subDays(new Date(), 90).toISOString(),
          to: new Date().toISOString(),
        },
      });
      expect(result.status).toBeLessThan(400);

      const transactions = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(transactions.length).toBe(PERIOD_AMOUNT);
    });

    it('returns an inline result shape (jobGroupId null + createdCount + fetchedCount)', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      type InlineResult = { jobGroupId: string | null; createdCount?: number; fetchedCount?: number; message: string };
      const period = {
        from: subDays(new Date(), 30).toISOString(),
        to: new Date().toISOString(),
      };

      // Window the provider has no data for: nothing fetched, nothing created.
      const emptyResult = (await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId,
        accountId,
        ...period,
        raw: true,
      })) as unknown as InlineResult;
      expect(emptyResult.createdCount).toBe(0);
      expect(emptyResult.fetchedCount).toBe(0);

      const PERIOD_AMOUNT = 3;
      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            account1Transactions: getMockedSimplefinTransactions(PERIOD_AMOUNT),
          }),
        }),
      );

      const result = (await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId,
        accountId,
        ...period,
        raw: true,
      })) as unknown as InlineResult;

      expect(result.jobGroupId).toBeNull();
      expect(result.createdCount).toBe(PERIOD_AMOUNT);
      expect(result.fetchedCount).toBe(PERIOD_AMOUNT);
      expect(typeof result.message).toBe('string');

      // Same window again: everything fetched deduped away — and the message
      // must not read the same as the "provider had no data" case.
      const dupResult = (await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId,
        accountId,
        ...period,
        raw: true,
      })) as unknown as InlineResult;
      expect(dupResult.createdCount).toBe(0);
      expect(dupResult.fetchedCount).toBe(PERIOD_AMOUNT);
      expect(dupResult.message).not.toBe(emptyResult.message);
      expect(dupResult.message).not.toBe(result.message);
    });

    it('pages a >90-day window into multiple requests and stores every transaction once', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);
      expect(await Transactions.count({ where: { accountId } })).toBe(0);

      // One transaction spread across the ~44-day windows of a 200-day range.
      const txns = getMockedSimplefinTransactionsOnDaysAgo([190, 100, 10]);
      const recorder = createSimplefinAccountsRecorder({ account1Transactions: txns, windowed: true });
      global.mswMockServer.use(recorder.handler);

      const result = (await helpers.bankDataProviders.loadTransactionsForPeriod({
        connectionId,
        accountId,
        from: subDays(new Date(), 200).toISOString(),
        to: new Date().toISOString(),
        raw: true,
      })) as unknown as { createdCount?: number };

      // Multiple windows, each carrying version=2, and no double-counting.
      expect(recorder.requests.length).toBeGreaterThanOrEqual(3);
      expect(recorder.requests.every((url) => url.searchParams.get('version') === '2')).toBe(true);

      const stored = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(stored.length).toBe(3);
      expect(result.createdCount).toBe(3);
    });
  });

  describe('Accounts without provider currency', () => {
    it('lists the account as XXX, rejects connect without a currency, connects with the chosen one', async () => {
      const connectionId = await connectSimplefin();
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Currency: '' }) }),
      );

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      const noCurrencyAccount = accounts.find((a: { externalId: string }) => a.externalId === SIMPLEFIN_ACCOUNT_1);
      expect(noCurrencyAccount?.currency).toBe('XXX');

      const failed = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
      });
      expect(failed.statusCode).toBe(ERROR_CODES.ValidationError);

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2],
        // Lowercase on purpose: the endpoint normalizes currency codes.
        currencyOverrides: { [SIMPLEFIN_ACCOUNT_1]: 'eur' },
        raw: true,
      });

      const overridden = syncedAccounts.find((a: { externalId: string }) => a.externalId === SIMPLEFIN_ACCOUNT_1)!;
      expect(overridden.currency).toBe('EUR');
      // Overrides only apply to no-currency accounts; the USD one keeps its provider currency.
      const untouched = syncedAccounts.find((a: { externalId: string }) => a.externalId === SIMPLEFIN_ACCOUNT_2)!;
      expect(untouched.currency).toBe('USD');
    });

    it('rolls back already-created accounts when a later account in the batch is missing a currency choice', async () => {
      const connectionId = await connectSimplefin();
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account2Currency: '' }) }),
      );

      // Account 1 (USD) is created first; account 2 (no currency, no override)
      // then throws mid-batch — the transaction must leave nothing behind.
      const failed = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1, SIMPLEFIN_ACCOUNT_2],
      });
      expect(failed.statusCode).toBe(ERROR_CODES.ValidationError);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.accounts.length).toBe(0);
    });

    it('rejects a non-currency ISO code (XAU) as the chosen currency', async () => {
      const connectionId = await connectSimplefin();
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Currency: '' }) }),
      );

      const failed = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        currencyOverrides: { [SIMPLEFIN_ACCOUNT_1]: 'XAU' },
      });
      expect(failed.statusCode).toBe(ERROR_CODES.BadRequest);
    });
  });

  describe('Disconnect', () => {
    it('disconnects a SimpleFIN connection', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      await helpers.bankDataProviders.disconnectProvider({ connectionId, raw: true });

      const result = await helpers.makeRequest({
        method: 'get',
        url: `/bank-data-providers/connections/${connectionId}`,
      });
      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });
  });

  describe('Account type', () => {
    it('creates accounts with the simplefin account type', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        raw: true,
      });

      const account = await helpers.getAccount({ id: syncedAccounts[0]!.id, raw: true });
      expect(account.type).toBe(ACCOUNT_TYPES.simplefin);
      expect(account.externalId).toBe(SIMPLEFIN_ACCOUNT_1);
    });
  });

  describe('Protocol v2', () => {
    it('requests the /accounts endpoint with version=2', async () => {
      const connectionId = await connectSimplefin();

      const recorder = createSimplefinAccountsRecorder();
      global.mswMockServer.use(recorder.handler);

      await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });

      expect(recorder.requests.length).toBeGreaterThan(0);
      expect(recorder.requests.every((url) => url.searchParams.get('version') === '2')).toBe(true);
    });

    it('resolves institution details from the v2 connections[] array (no embedded org)', async () => {
      const connectionId = await connectSimplefin();

      global.mswMockServer.use(getSimplefinAccountsMock({ response: getMockedSimplefinAccountSetV2() }));

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({ connectionId, raw: true });
      expect(accounts.length).toBe(2);
      const checking = accounts.find((a: { externalId: string }) => a.externalId === SIMPLEFIN_ACCOUNT_1)!;
      expect(checking.metadata?.institutionName).toBe('Test Bank');
      expect(checking.metadata?.institutionDomain).toBe('testbank.example');
    });
  });

  describe('Structured errors (errlist)', () => {
    it('treats a gen.auth errlist entry on a 200 response as an auth failure', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            errlist: [{ code: 'gen.auth', msg: 'Access URL rejected' }],
          }),
        }),
      );

      // Two failures hit the deactivation threshold.
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(false);
      expect(connection.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);
    });

    it('does not abort or deactivate on a non-auth errlist entry (act.missingdata)', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            account1Transactions: getMockedSimplefinTransactions(3),
            errlist: [{ code: 'act.missingdata', msg: 'Incomplete transaction listing' }],
          }),
        }),
      );

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const stored = await Transactions.findAll({ where: { accountId }, raw: true });
      expect(stored.length).toBe(3);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(true);
    });
  });

  describe('Auth-failure tracking', () => {
    it('deactivates the connection after repeated 403s and records AUTH_FAILURE', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(getSimplefinAccountsErrorMock({ status: 403 }));

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(false);
      expect(connection.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);
    });

    it('does not deactivate on a transient rate limit (429)', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(getSimplefinAccountsErrorMock({ status: 429 }));

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(true);
      expect(connection.deactivationReason).toBeNull();
    });
  });

  describe('Refresh credentials', () => {
    it('reactivates a deactivated connection and clears the failure state', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      // Drive the connection into the deactivated state via repeated auth failures.
      global.mswMockServer.use(getSimplefinAccountsErrorMock({ status: 403 }));
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      const deactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(deactivated.connection.isActive).toBe(false);

      // Restore the bridge and re-submit a fresh setup token.
      global.mswMockServer.use(getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet() }));
      await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
        raw: true,
      });

      const reactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(reactivated.connection.isActive).toBe(true);
      expect(reactivated.connection.deactivationReason).toBeNull();
    });

    it('rejects the refresh and leaves the connection inactive when the bridge returns gen.auth on a 200', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(getSimplefinAccountsErrorMock({ status: 403 }));
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({ errlist: [{ code: 'gen.auth', msg: 'Access URL rejected' }] }),
        }),
      );

      const result = await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
      });
      expect(result.statusCode).toBe(ERROR_CODES.Forbidden);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.isActive).toBe(false);
      expect(connection.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);
    });
  });

  describe('con.auth scope handling', () => {
    const CON_AUTH_ERRLIST = [{ code: 'con.auth', msg: 'Connection credentials rejected', conn_id: 'CONN-BANK-B' }];

    it('persists the transactions of healthy accounts returned alongside a con.auth entry', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            account1Transactions: getMockedSimplefinTransactions(3),
            errlist: CON_AUTH_ERRLIST,
          }),
        }),
      );

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect(await Transactions.count({ where: { accountId } })).toBe(3);
    });

    it('accepts a fresh setup token and reactivates the connection while con.auth is reported', async () => {
      const connectionId = await connectSimplefin();
      const accountId = await importFirstAccount(connectionId);

      global.mswMockServer.use(getSimplefinAccountsErrorMock({ status: 403 }));
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId });

      const deactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(deactivated.connection.isActive).toBe(false);

      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ errlist: CON_AUTH_ERRLIST }) }),
      );

      const updateResult = await helpers.bankDataProviders.updateConnectionDetails({
        connectionId,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
      });
      expect(updateResult.statusCode).toBe(200);

      const reactivated = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(reactivated.connection.isActive).toBe(true);
      expect(reactivated.connection.deactivationReason).toBeNull();
    });

    it('creates a connection when the bridge reports con.auth for one institution', async () => {
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ errlist: CON_AUTH_ERRLIST }) }),
      );

      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        credentials: { setupToken: VALID_SIMPLEFIN_SETUP_TOKEN },
      });

      expect(result.statusCode).toBe(200);
      expect(result.body.response.connectionId).toBeDefined();
    });
  });

  describe('Future-dated anchor', () => {
    const HISTORY_DAYS_AGO = [10, 11, 12];

    /** Import three historical rows, then push a balance adjustment 400 days into the future. */
    const connectImportAndPoisonAnchor = async () => {
      const connectionId = await connectSimplefin();

      const history = getMockedSimplefinTransactionsOnDaysAgo(HISTORY_DAYS_AGO);
      global.mswMockServer.use(
        getSimplefinAccountsMock({ response: getMockedSimplefinAccountSet({ account1Transactions: history }) }),
      );
      const accountId = await importFirstAccount(connectionId);

      const account = await helpers.getAccount({ id: accountId, raw: true });
      const adjustment = await helpers.balanceAdjustment({
        id: accountId,
        payload: {
          targetBalance: asDecimal(Number(account.currentBalance) + 10),
          time: addDays(new Date(), 400).toISOString(),
        },
        raw: true,
      });
      expect(adjustment.transaction).not.toBeNull();

      return { connectionId, accountId, history };
    };

    it('never requests a window whose start-date is after its end-date', async () => {
      const { connectionId, accountId, history } = await connectImportAndPoisonAnchor();

      const recorder = createSimplefinAccountsRecorder({ account1Transactions: history, windowed: true });
      global.mswMockServer.use(recorder.handler);

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const windows = recorder.requests
        .filter((url) => url.searchParams.has('start-date'))
        .map((url) => ({
          start: Number(url.searchParams.get('start-date')),
          end: Number(url.searchParams.get('end-date')),
        }));
      expect(windows.length).toBeGreaterThan(0);
      expect(windows.filter(({ start, end }) => start > end)).toEqual([]);
    });

    it('still imports transactions posted since the latest real transaction', async () => {
      const { connectionId, accountId, history } = await connectImportAndPoisonAnchor();
      expect(await Transactions.count({ where: { accountId, originalId: { [Op.ne]: null } } })).toBe(
        HISTORY_DAYS_AGO.length,
      );

      const freshTransaction = getMockedSimplefinTransactionsOnDaysAgo([2])[0]!;
      const recorder = createSimplefinAccountsRecorder({
        account1Transactions: [...history, freshTransaction],
        windowed: true,
      });
      global.mswMockServer.use(recorder.handler);

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect(await Transactions.count({ where: { accountId, originalId: freshTransaction.id } })).toBe(1);
      expect(await Transactions.count({ where: { accountId, originalId: { [Op.ne]: null } } })).toBe(
        HISTORY_DAYS_AGO.length + 1,
      );
    });
  });

  describe('Forward-only link window', () => {
    it('does not import the bank copy of a pre-link manual transaction when linking', async () => {
      const manualSpentAt = subHours(new Date(), 3);
      const bankCopy = buildBankTransaction({ postedAt: subHours(new Date(), 2), amount: -40 });

      const accountId = await createTrackedAccount({ manualSpentAt });
      const connectionId = await connectSimplefin();

      const recorder = createSimplefinAccountsRecorder({ account1Transactions: [bankCopy], windowed: true });
      global.mswMockServer.use(recorder.handler);

      const linkTriggeredAt = toEpochSeconds({ date: new Date() });
      await helpers.linkAccountToBankConnection({
        id: accountId,
        connectionId,
        externalAccountId: SIMPLEFIN_ACCOUNT_1,
        raw: true,
      });
      await waitForCompletedSync({ accountId });

      const stored = await Transactions.findAll({ where: { accountId } });
      expect(stored.filter((tx) => tx.originalId !== null).length).toBe(0);
      expect(stored.length).toBe(1);

      const windowedRequests = recorder.requests.filter((url) => url.searchParams.has('start-date'));
      expect(windowedRequests.length).toBeGreaterThan(0);
      const earliestStart = Math.min(...windowedRequests.map((url) => Number(url.searchParams.get('start-date'))));
      expect(earliestStart).toBeGreaterThanOrEqual(linkTriggeredAt);
    });

    it('keeps a freshly linked account out of the shared window of a connection-level sync', async () => {
      const manualSpentAt = subDays(new Date(), 30);
      // Settled before the manual row, so only the connection-level window
      // widened by the anchorless savings account reaches it.
      const bankCopy = buildBankTransaction({ postedAt: subDays(new Date(), 60), amount: -40 });

      const connectionId = await connectSimplefin();

      const recorder = createSimplefinAccountsRecorder({ account1Transactions: [bankCopy], windowed: true });
      global.mswMockServer.use(recorder.handler);

      // Savings has no transactions, so it stays anchorless and drags the shared
      // window back to the initial-backfill horizon.
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_2],
        raw: true,
      });

      const accountId = await createTrackedAccount({ manualSpentAt });
      await helpers.linkAccountToBankConnection({
        id: accountId,
        connectionId,
        externalAccountId: SIMPLEFIN_ACCOUNT_1,
        raw: true,
      });

      await helpers.makeRequest({ method: 'post', url: '/bank-data-providers/sync/trigger' });
      await waitForCompletedSync({ accountId });

      const stored = await Transactions.findAll({ where: { accountId } });
      expect(stored.filter((tx) => tx.originalId !== null).length).toBe(0);
      expect(stored.length).toBe(1);
    });
  });

  describe('Amount mapping', () => {
    it('maps positive amounts to income and negative amounts to expense', async () => {
      const connectionId = await connectSimplefin();

      const posted = Math.floor(Date.now() / 1000);
      global.mswMockServer.use(
        getSimplefinAccountsMock({
          response: getMockedSimplefinAccountSet({
            account1Transactions: [
              { id: 'sf-income', posted, amount: '120.50', description: 'Salary', pending: false },
              { id: 'sf-expense', posted, amount: '-45.30', description: 'Groceries', pending: false },
            ],
          }),
        }),
      );

      const accountId = await importFirstAccount(connectionId);

      const stored = await Transactions.findAll({ where: { accountId }, raw: true });
      const income = stored.find((tx) => tx.originalId === 'sf-income')!;
      const expense = stored.find((tx) => tx.originalId === 'sf-expense')!;
      expect(income.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(expense.transactionType).toBe(TRANSACTION_TYPES.expense);
    });
  });

  /**
   * An external account already linked to a live connection cannot be attached to
   * a second live connection of the same provider, so the shared bridge feed is
   * never pulled into two separate account rows.
   */
  describe('Duplicate external account across two live connections', () => {
    it('rejects importing the same external id on another connection', async () => {
      const connectionA = await connectSimplefin();
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionA,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        raw: true,
      });

      const connectionB = await connectSimplefin();
      const response = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionB,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
      });

      expect(response.statusCode).toBe(ERROR_CODES.BadRequest);
      const { message } = helpers.extractResponse(response);
      expect(message).toContain('Test Checking');
      expect(message).toContain('"SimpleFIN"');

      const rows = await Accounts.findAll({
        where: { externalId: SIMPLEFIN_ACCOUNT_1 },
        attributes: ['id', 'externalId', 'bankDataProviderConnectionId'],
      });
      expect(rows.length).toBe(1);
    });

    it('rejects linking a system account to an external id owned by another connection', async () => {
      const connectionA = await connectSimplefin();
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionA,
        accountExternalIds: [SIMPLEFIN_ACCOUNT_1],
        raw: true,
      });

      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      const systemAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Manually tracked checking', currencyCode: 'USD' }),
        raw: true,
      });

      const connectionB = await connectSimplefin();
      const response = await helpers.linkAccountToBankConnection({
        id: systemAccount.id,
        connectionId: connectionB,
        externalAccountId: SIMPLEFIN_ACCOUNT_1,
      });

      expect(response.statusCode).toBe(ERROR_CODES.BadRequest);
      expect(helpers.extractResponse(response).message).toContain('"SimpleFIN"');

      const reloaded = (await Accounts.findByPk(systemAccount.id))!;
      expect(reloaded.externalId).toBe(null);
      expect(reloaded.bankDataProviderConnectionId).toBe(null);
    });
  });
});
