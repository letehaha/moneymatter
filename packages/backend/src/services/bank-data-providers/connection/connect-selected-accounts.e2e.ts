import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import * as helpers from '@tests/helpers';
import { credit } from '@tests/mocks/plaid/data';
import { mockProvider } from '@tests/mocks/plaid/mock-api';
import { SyncStatus } from '@services/bank-data-providers/sync/sync-status-tracker';
import { HttpResponse } from 'msw';

const env = {
  IS_SELF_HOST: 'true',
  PLAID_ENABLED: 'false',
  PLAID_ENV: 'sandbox',
  PLAID_CLIENT_ID: 'plaid-test-client',
  PLAID_SECRET: 'plaid-test-secret',
  PLAID_REDIRECT_URI: 'https://money.test/plaid-callback',
};
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Connect selected accounts', () => {
  it('preserves the Plaid debt on a same-id credit relink even when sync fails', async () => {
    const { state, handlers } = mockProvider();
    global.mswMockServer.use(...handlers);
    const api = helpers.bankDataProviders;
    const firstConnection = await helpers.plaid.pairPlaidUser();
    const first = await api.connectSelectedAccounts({
      connectionId: firstConnection.connectionId,
      accountExternalIds: [credit().account_id],
      raw: true,
    });
    const accountId = first.syncedAccounts[0]!.id;
    await api.disconnectProvider({ connectionId: firstConnection.connectionId, raw: true });

    const replacementToken = 'access-sandbox-replacement';
    state.exchangeResult = { access_token: replacementToken, item_id: 'item-replacement' };
    const changed = { ...credit(), balances: { ...credit().balances, current: 3174.77, limit: 30000 } };
    state.accounts = [changed];
    state.sync = () => HttpResponse.json({ error_code: 'INTERNAL_SERVER_ERROR', error_message: 'unavailable' }, { status: 500 });
    const replacement = await helpers.plaid.pairPlaidUser({ publicToken: 'public-sandbox-replacement' });
    const previousSyncRequestCount = state.syncRequests.length;
    const relink = await api.connectSelectedAccounts({
      connectionId: replacement.connectionId,
      accountExternalIds: [changed.account_id],
      raw: true,
    });

    expect(relink.syncedAccounts).toEqual([expect.objectContaining({ id: accountId, balance: -3174.77 })]);
    expect(state.syncRequests.slice(previousSyncRequestCount)).toContainEqual(expect.objectContaining({ access_token: replacementToken }));
    const { accounts } = await api.getAccountsSyncStatus({ raw: true });
    expect(accounts).toContainEqual(expect.objectContaining({ accountId, status: SyncStatus.FAILED }));
    const account = await helpers.getAccount({ id: accountId, raw: true });
    expect(account).toMatchObject({ currentBalance: -3174.77, creditLimit: 1000, refCurrentBalance: -3174.77, refCreditLimit: 1000 });
    const stored = await Accounts.findByPk(accountId);
    expect(stored?.externalData?.bankConnection?.balanceReconciliation).toMatchObject({
      systemBalance: -31.5,
      externalBalance: -3174.77,
      difference: -3143.27,
    });
  });
});
