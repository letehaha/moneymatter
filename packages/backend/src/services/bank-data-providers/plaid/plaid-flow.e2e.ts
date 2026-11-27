import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { checking, credit, posted, PLAID_ACCESS_TOKEN, PLAID_PUBLIC_TOKEN } from '@tests/mocks/plaid/data';
import { mockProvider as createMockProvider, page } from '@tests/mocks/plaid/mock-api';
import { HttpResponse } from 'msw';
import type { PlaidMetadata } from './types';

const api = helpers.bankDataProviders;
const callback = 'https://money.test/plaid-callback';
const publicToken = PLAID_PUBLIC_TOKEN;
const accessToken = PLAID_ACCESS_TOKEN;
const enabledEnv = {
  IS_SELF_HOST: 'true',
  PLAID_ENABLED: 'false',
  PLAID_ENV: 'sandbox',
  PLAID_CLIENT_ID: 'plaid-test-client',
  PLAID_SECRET: 'plaid-test-secret',
  PLAID_REDIRECT_URI: callback,
};
const envKeys = Object.keys(enabledEnv);
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, enabledEnv);
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const mockProvider = () => {
  const { state, handlers } = createMockProvider();
  global.mswMockServer.use(...handlers);
  return state;
};
const connect = () => helpers.plaid.pairPlaidUser();

const mapChecking = async ({ connectionId }: { connectionId: string }) => {
  const { syncedAccounts } = await api.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [checking().account_id],
    raw: true,
  });
  return syncedAccounts[0]!;
};

describe('Plaid Link endpoints', () => {
  it('creates a new Link token for the signed-in user with no existing connections', async () => {
    const upstream = mockProvider();
    const { connections } = await api.listUserConnections({ raw: true });
    expect(connections).toEqual([]);
    const res = await helpers.plaid.createLinkToken();
    expect(res.statusCode).toBe(200);
    expect(res).toHaveProperty(['headers', 'cache-control'], 'no-store');
    expect(res.body.response).toEqual({ linkToken: 'link-sandbox-new' });
    expect(upstream.links).toEqual([
      expect.objectContaining({
        user: { client_user_id: expect.stringMatching(/^\d+$/) },
        country_codes: ['US', 'CA'],
        products: ['transactions'],
        redirect_uri: callback,
      }),
    ]);
    expect(upstream.links[0]).not.toHaveProperty('access_token');
  });

  it('keeps discovery and direct Link/connect calls disabled off self-host and when credentials are incomplete', async () => {
    const upstream = mockProvider();
    const { providers } = await api.getSupportedBankProviders({ raw: true });
    expect(providers).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'plaid' })]));

    delete process.env.IS_SELF_HOST;
    const guest = await helpers.plaid.createLinkToken();
    expect(guest.statusCode).toBe(ERROR_CODES.NotAllowed);
    const hosted = await api.getSupportedBankProviders({ raw: true });
    expect(hosted.providers).not.toContainEqual(expect.objectContaining({ type: 'plaid' }));

    process.env.IS_SELF_HOST = 'true';
    delete process.env.PLAID_SECRET;
    const connectRes = await api.connectProvider({
      providerType: BANK_PROVIDER_TYPE.PLAID,
      credentials: { publicToken },
    });
    expect(connectRes.statusCode).toBe(ERROR_CODES.NotAllowed);
    expect(upstream.links).toHaveLength(0);
    expect(upstream.exchanges).toHaveLength(0);
  });

  it('rejects connect and Link and hides Plaid for each missing or invalid configuration', async () => {
    const upstream = mockProvider();
    for (const [key, value] of [
      ['IS_SELF_HOST', 'false'],
      ['PLAID_CLIENT_ID', ''],
      ['PLAID_SECRET', ''],
      ['PLAID_ENV', 'development'],
      ['PLAID_ENV', ''],
    ]) {
      Object.assign(process.env, enabledEnv, { [key!]: value });
      expect((await api.getSupportedBankProviders({ raw: true })).providers).not.toContainEqual(
        expect.objectContaining({ type: BANK_PROVIDER_TYPE.PLAID }),
      );
      expect((await helpers.plaid.createLinkToken()).statusCode).toBe(ERROR_CODES.NotAllowed);
      expect(
        (await api.connectProvider({ providerType: BANK_PROVIDER_TYPE.PLAID, credentials: { publicToken } })).statusCode,
      ).toBe(ERROR_CODES.NotAllowed);
    }
    expect(upstream.links).toHaveLength(0);
    expect(upstream.exchanges).toHaveLength(0);
  });

  it('requires a session to create a Link token', async () => {
    expect((await helpers.withoutSession(() => helpers.plaid.createLinkToken())).statusCode).toBe(401);
  });

  it('rejects an oversized connection name before exchanging a public token', async () => {
    const upstream = mockProvider();
    const response = await api.connectProvider({
      providerType: BANK_PROVIDER_TYPE.PLAID,
      credentials: { publicToken },
      providerName: 'x'.repeat(256),
    });
    expect(response.statusCode).toBe(422);
    expect(upstream.exchanges).toEqual([]);
  });


  it('exchanges only the public token and keeps stored credentials out of public connection data', async () => {
    const upstream = mockProvider();
    const { connectionId, message } = await connect();
    expect(message).toEqual(expect.any(String));
    expect(upstream.exchanges).toEqual([expect.objectContaining({ public_token: publicToken })]);
    const details = await api.getConnectionDetails({ connectionId, raw: true });
    expect(details.connection).toMatchObject({ providerType: 'plaid', isActive: true, accounts: [] });
    expect(JSON.stringify(details)).not.toMatch(/access-sandbox-fake|public-sandbox-fake|plaid-test-secret/);
    const invalid = await api.connectProvider({
      providerType: BANK_PROVIDER_TYPE.PLAID,
      credentials: { accessToken },
    });
    expect(invalid.statusCode).toBe(422);
    expect(JSON.stringify(invalid.body)).not.toContain(accessToken);
    expect(upstream.exchanges).toHaveLength(1);
  });

  it('lists normalized accounts and links a replacement Item to the existing account', async () => {
    const upstream = mockProvider();
    const linkTime = new Date();
    const sameDay = linkTime.toISOString().slice(0, 10);
    const originalPosting = { ...posted({ id: 'existing-history' }), date: sameDay };
    upstream.sync = () => page({ cursor: 'initial', added: [originalPosting] });
    const { connectionId } = await connect();
    const first = await api.listExternalAccounts({ connectionId, raw: true });
    expect(first.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          externalId: checking().account_id,
          name: 'Checking',
          type: 'checking',
          balance: 145.25,
          currency: global.BASE_CURRENCY_CODE,
        }),
        expect.objectContaining({
          externalId: credit().account_id,
          name: 'Credit card',
          type: 'credit card',
          balance: -31.5,
          creditLimit: 1000,
          currency: global.BASE_CURRENCY_CODE,
        }),
      ]),
    );
    expect(upstream.accountRequests).toEqual([expect.objectContaining({ access_token: accessToken })]);
    const account = await mapChecking({ connectionId });
    const originalRows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(originalRows).toHaveLength(1);
    const original = originalRows[0]!;
    expect(original).toMatchObject({ originalId: 'existing-history', amount: 12, accountId: account.id });
    const accountCount = (await helpers.getAccounts()).length;
    await api.disconnectProvider({ connectionId, raw: true });
    expect(upstream.removals).toEqual([expect.objectContaining({ access_token: accessToken })]);
    const { connections } = await api.listUserConnections({ raw: true });
    expect(connections.find((item) => item.id === connectionId)).toBeUndefined();
    expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toEqual([
      expect.objectContaining({
        id: original.id,
        amount: 12,
        originalId: null,
      }),
    ]);
    expect((await Transactions.findByPk(original.id))?.externalData).toMatchObject({
      originalSource: { originalId: 'existing-history' },
    });
    upstream.exchangeResult = { access_token: 'access-sandbox-replacement', item_id: 'item-replacement' };
    upstream.accounts = [{ ...checking(), account_id: 'plaid-checking-replacement' }];
    upstream.sync = () =>
      page({
        cursor: 'replacement',
        added: [
          {
            ...originalPosting,
            transaction_id: 'replacement-posted',
            account_id: upstream.accounts[0]!.account_id,
          },
          {
            ...posted({ id: 'new-same-day-posting', amount: 7, account: upstream.accounts[0] }),
            date: sameDay,
          },
        ],
      });
    const replacement = await helpers.plaid.pairPlaidUser({ publicToken: 'public-sandbox-replacement' });
    expect(upstream.exchanges).toContainEqual(expect.objectContaining({ public_token: 'public-sandbox-replacement' }));
    expect((await api.getConnectionDetails({ connectionId: replacement.connectionId, raw: true })).connection.accounts).toEqual([]);
    jest.useFakeTimers({
      now: linkTime,
      doNotFake: ['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'nextTick', 'performance'],
    });
    try {
      await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId: replacement.connectionId,
        externalAccountId: 'plaid-checking-replacement',
        raw: true,
      });
    } finally {
      jest.useRealTimers();
    }
    expect((await api.getConnectionDetails({ connectionId: replacement.connectionId, raw: true })).connection.accounts).toEqual([
      expect.objectContaining({ id: account.id }),
    ]);
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      id: account.id,
      externalId: 'plaid-checking-replacement',
      bankDataProviderConnectionId: replacement.connectionId,
    });
    const relinkedRows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(relinkedRows).toHaveLength(3);
    expect(relinkedRows).toContainEqual(
      expect.objectContaining({
        id: original.id,
        amount: 12,
        accountId: account.id,
        originalId: null,
      }),
    );
    expect((await Transactions.findByPk(original.id))?.externalData).toMatchObject({
      originalSource: { originalId: 'existing-history' },
    });
    // The inclusive UTC-midnight link cutoff admits same-day changed-ID replays and new postings.
    expect(relinkedRows).toContainEqual(
      expect.objectContaining({ originalId: 'replacement-posted', amount: 12, accountId: account.id }),
    );
    expect(relinkedRows).toContainEqual(
      expect.objectContaining({ originalId: 'new-same-day-posting', amount: 7, accountId: account.id }),
    );
    expect(await helpers.getAccounts()).toHaveLength(accountCount);
    expect(upstream.accountRequests).toContainEqual(expect.objectContaining({ access_token: 'access-sandbox-replacement' }));
  });

  it('rolls back a manual link while persisting a sync-only Plaid authentication failure', async () => {
    const upstream = mockProvider();
    const { connectionId } = await connect();
    const account = await helpers.createAccount({ raw: true });
    const before = await helpers.getAccount({ id: account.id, raw: true });
    const beforeConnection = await BankDataProviderConnections.findByPk(connectionId);
    upstream.sync = () => HttpResponse.json({ error_code: 'ITEM_LOGIN_REQUIRED' }, { status: 400 });

    const result = await helpers.linkAccountToBankConnection({
      id: account.id,
      connectionId,
      externalAccountId: checking().account_id,
    });

    expect(result.statusCode).toBe(ERROR_CODES.Forbidden);
    expect(upstream.accountRequests).toHaveLength(2);
    expect(upstream.syncRequests).toHaveLength(1);
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      type: ACCOUNT_TYPES.system,
      currentBalance: before.currentBalance,
      bankDataProviderConnectionId: before.bankDataProviderConnectionId,
    });
    const after = await BankDataProviderConnections.findByPk(connectionId);
    expect(after!.isActive).toBe(true);
    expect(after!.lastSyncAt).toEqual(beforeConnection!.lastSyncAt);
    expect(after!.metadata).toMatchObject({ consecutiveAuthFailures: 1 });
    expect((after!.metadata as PlaidMetadata).plaidCursors).toEqual((beforeConnection!.metadata as PlaidMetadata | null)?.plaidCursors);
    expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toEqual([]);
  });

});

describe('Plaid transaction sync', () => {
  it('preserves the checkpoint when login failures deactivate the connection and removes its Item on disconnect', async () => {
    const upstream = mockProvider();
    const { connectionId } = await connect();
    const account = await mapChecking({ connectionId });
    const before = await BankDataProviderConnections.findByPk(connectionId);
    const beforeMetadata = before!.metadata as PlaidMetadata;
    const cursors = beforeMetadata.plaidCursors;
    expect(cursors?.[account.id]).toMatchObject({ value: 'initial' });

    upstream.loginRequired = true;
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id });
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id });
    const details = await api.getConnectionDetails({ connectionId, raw: true });
    expect(details.connection).toMatchObject({ isActive: false, deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE });
    const after = await BankDataProviderConnections.findByPk(connectionId);
    const afterMetadata = after!.metadata as PlaidMetadata;
    expect(afterMetadata.plaidCursors).toEqual(cursors);
    expect(upstream.syncRequests.slice(-2).map(({ cursor }) => cursor)).toEqual(['initial', 'initial']);
    const status = await api.getAccountsSyncStatus({ raw: true });
    expect(status.connectionsNeedingReauth).toContainEqual(expect.objectContaining({ connectionId }));
    await api.disconnectProvider({ connectionId, raw: true });
    expect(upstream.removals).toContainEqual(expect.objectContaining({ access_token: accessToken }));
  });

  it('keeps independent Item-stream checkpoints per mapped account and imports posted rows only', async () => {
    const upstream = mockProvider();
    upstream.sync = ({ cursor }) =>
      cursor === undefined
        ? page({
            cursor: 'initial',
            added: [
              posted({ id: 'a1' }),
              posted({ id: 'income', amount: -8 }),
              posted({ id: 'b1', account: credit() }),
              posted({ id: 'hold', pending: true }),
            ],
          })
        : page({ cursor: 'later', added: [posted({ id: 'a2' }), posted({ id: 'b2', account: credit() })] });
    const { connectionId } = await connect();
    const a = await mapChecking({ connectionId });
    const {
      syncedAccounts: [b],
    } = await api.connectSelectedAccounts({ connectionId, accountExternalIds: [credit().account_id], raw: true });
    const accountB = b!;
    expect((await api.getConnectionDetails({ connectionId, raw: true })).connection.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: a.id, currentBalance: 145.25, creditLimit: 0 }),
        expect.objectContaining({ id: accountB.id, currentBalance: -31.5, creditLimit: 1000 }),
      ]),
    );
    // The stored limit remains authoritative when Plaid changes its reported limit.
    upstream.accounts[1]!.balances.limit = 2000;

    await api.syncTransactionsForAccount({ connectionId, accountId: a.id, raw: true });
    await api.syncTransactionsForAccount({ connectionId, accountId: accountB.id, raw: true });
    await api.syncTransactionsForAccount({ connectionId, accountId: a.id, raw: true });

    expect(upstream.syncRequests.map(({ cursor }) => cursor)).toEqual([
      undefined,
      undefined,
      'initial',
      'initial',
      'later',
    ]);
    expect(upstream.syncRequests.every((request) => !request.options && request.access_token === accessToken)).toBe(
      true,
    );
    const rowsA = await helpers.getTransactions({ accountIds: [a.id], raw: true });
    const rowsB = await helpers.getTransactions({ accountIds: [accountB.id], raw: true });
    expect(rowsA.map((row) => row.originalId).sort()).toEqual(['a1', 'a2', 'income']);
    expect(rowsB.map((row) => row.originalId).sort()).toEqual(['b1', 'b2']);
    expect(rowsA.find((row) => row.originalId === 'a1')).toMatchObject({
      amount: 12,
      transactionType: TRANSACTION_TYPES.expense,
    });
    expect((await Transactions.findByPk(rowsA.find((row) => row.originalId === 'a1')!.id))?.externalData).toMatchObject({
      plaidAccountId: checking().account_id,
    });
    expect(rowsA.find((row) => row.originalId === 'income')).toMatchObject({
      amount: 8,
      transactionType: TRANSACTION_TYPES.income,
    });
    expect(await helpers.getAccount({ id: accountB.id, raw: true })).toMatchObject({
      type: ACCOUNT_TYPES.plaid,
      currentBalance: -31.5,
      creditLimit: 1000,
    });
  });

  it('overwrites a stale positive credit balance on the next successful sync', async () => {
    const upstream = mockProvider();
    upstream.accounts[1]!.balances.current = -26825.23;
    upstream.accounts[1]!.balances.limit = 30000;
    const { connectionId } = await connect();
    const { syncedAccounts } = await api.connectSelectedAccounts({
      connectionId,
      accountExternalIds: [credit().account_id],
      raw: true,
    });
    const account = syncedAccounts[0]!;
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      currentBalance: 26825.23,
      creditLimit: 30000,
    });

    upstream.accounts[1]!.balances.current = 3174.77;
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      currentBalance: -3174.77,
      refCurrentBalance: -3174.77,
      creditLimit: 30000,
    });
  });

  it('restarts mutated pages and retries the original checkpoint after a failed ledger write', async () => {
    const upstream = mockProvider();
    const { connectionId } = await connect();
    const account = await mapChecking({ connectionId });
    let first = true;
    upstream.sync = ({ cursor }) => {
      if (first) {
        first = false;
        return page({ cursor: 'discard', added: [posted({ id: 'abandoned' })], hasMore: true });
      }
      if (cursor === 'discard') {
        return HttpResponse.json({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }, { status: 400 });
      }
      return page({ cursor: 'applied', added: [posted({ id: 'stable' })] });
    };
    // Conversion at the balance write exceeds the ledger's safe minor-unit range.
    upstream.accounts[0]!.balances.current = 1e15;
    const failed = await api.syncTransactionsForAccount({ connectionId, accountId: account.id });
    expect(failed.statusCode).toBe(422);
    expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toEqual([]);
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({ currentBalance: 145.25 });

    upstream.accounts[0]!.balances.current = 107.45;
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });
    expect(upstream.syncRequests.map(({ cursor }) => cursor)).toEqual([
      undefined,
      'initial',
      'discard',
      'initial',
      'initial',
    ]);
    const rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(rows.map((row) => row.originalId)).toEqual(['stable']);
    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({ currentBalance: 107.45 });
  });

  it('updates booked amounts, hides provider removals, and preserves a linked transfer', async () => {
    const upstream = mockProvider();
    upstream.sync = () =>
      page({
        cursor: 'initial',
        added: [posted({ id: 'edit' }), posted({ id: 'drop' }), posted({ id: 'transfer', amount: 23 })],
      });
    const { connectionId } = await connect();
    const account = await mapChecking({ connectionId });
    const before = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    const transfer = before.find((row) => row.originalId === 'transfer')!;
    const manual = await helpers.createAccount({ raw: true });
    const [income] = await helpers.createTransaction({
      raw: true,
      payload: helpers.buildTransactionPayload({
        accountId: manual.id,
        transactionType: TRANSACTION_TYPES.income,
        amount: 23,
        time: new Date(transfer.time).toISOString(),
      }),
    });
    await helpers.linkTransactions({ payload: { ids: [[transfer.id, income!.id]] }, raw: true });

    upstream.sync = () =>
      page({
        cursor: 'changed',
        modified: [{ ...posted({ id: 'edit', amount: 19.22 }), name: 'New provider description' }],
        removed: [{ transaction_id: 'drop' }, { transaction_id: 'transfer' }],
      });
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });
    // A repeated provider row after removal remains hidden rather than being recreated.
    upstream.sync = () => page({ cursor: 'replay', added: [posted({ id: 'drop' })] });
    await api.syncTransactionsForAccount({ connectionId, accountId: account.id, raw: true });
    const rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.originalId === 'edit')).toMatchObject({ amount: 19.22, note: 'Statement edit' });
    expect(rows.find((row) => row.originalId === 'transfer')).toMatchObject({
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      amount: 23,
    });
  });
});
