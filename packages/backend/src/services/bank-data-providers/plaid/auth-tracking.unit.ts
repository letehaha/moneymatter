import { DEACTIVATION_REASON } from '@bt/shared/types';

jest.mock('@models/bank-data-provider-connections.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/connection', () => ({
  namespace: { get: jest.fn() },
  connection: { sequelize: { query: jest.fn() } },
  runOutsideTransaction: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('@services/accounts/lock-account-row', () => ({ lockLinkedBankAccount: jest.fn() }));
jest.mock('@services/accounts/absorb-link-residual', () => ({ runPendingLinkAbsorb: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('../sync/sync-status-tracker', () => ({ setAccountSyncStatus: jest.fn(), SyncStatus: {} }));
jest.mock('../utils/link-and-emit-synced-transactions', () => ({ linkAndEmitSyncedTransactions: jest.fn() }));
jest.mock('../utils/write-bank-balance-with-history', () => ({ writeBankBalanceWithHistory: jest.fn() }));
jest.mock('./apply-transaction-changes', () => ({ applyPlaidChanges: jest.fn() }));

/* eslint-disable import/first */
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection } from '@models/connection';

import { PlaidProvider } from './plaid.provider';
/* eslint-enable import/first */

it('tracks Plaid authentication failures with an out-of-transaction JSONB update and disconnects an inactive Item', async () => {
  const savedEnv = { ...process.env };
  Object.assign(process.env, {
    IS_SELF_HOST: 'true',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_ID: 'client',
    PLAID_SECRET: 'secret',
  });
  const cursor = { externalId: 'account', linkedAt: null, value: 'saved-cursor' };
  const siblingMetadata = { institution: 'example', nested: { preserved: true } };
  const row = {
    isActive: true,
    metadata: {
      plaidCursors: { local: cursor },
      siblingMetadata,
      consecutiveAuthFailures: 0,
      deactivationReason: null as string | null,
    },
    getDecryptedCredentials: () => ({ access_token: 'access-token', item_id: 'item-id' }),
    destroy: jest.fn(),
  };
  jest.mocked(BankDataProviderConnections.findOne).mockResolvedValue(row as never);
  const query = jest.mocked(connection.sequelize.query);
  // This stub mutates the simulated row; it does not execute or validate PostgreSQL.
  query.mockImplementation(async () => {
    row.metadata.consecutiveAuthFailures += 1;
    if (row.metadata.consecutiveAuthFailures >= 2) {
      row.isActive = false;
      row.metadata.deactivationReason = DEACTIVATION_REASON.AUTH_FAILURE;
    }
    return [[{ failures: row.metadata.consecutiveAuthFailures }]] as never;
  });
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).endsWith('/item/remove')) return Response.json({ removed: true });
    return Response.json({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'access-token' }, { status: 400 });
  });
  try {
    const provider = new PlaidProvider();
    expect(row.isActive).toBe(true);
    expect(row.metadata.consecutiveAuthFailures).toBe(0);
    await expect(provider.fetchAccounts('connection')).rejects.toThrow();
    expect(row.isActive).toBe(true);
    expect(row.metadata).toEqual({
      plaidCursors: { local: { externalId: 'account', linkedAt: null, value: 'saved-cursor' } },
      siblingMetadata: { institution: 'example', nested: { preserved: true } },
      consecutiveAuthFailures: 1,
      deactivationReason: null,
    });
    await expect(provider.fetchAccounts('connection')).rejects.toThrow();
    expect(row.isActive).toBe(false);
    expect(row.metadata).toEqual({
      plaidCursors: { local: { externalId: 'account', linkedAt: null, value: 'saved-cursor' } },
      siblingMetadata: { institution: 'example', nested: { preserved: true } },
      consecutiveAuthFailures: 2,
      deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
    });
    expect(query).toHaveBeenCalledTimes(2);
    for (const [statement, options] of query.mock.calls) {
      const sql = statement as string;
      expect(sql).toContain("jsonb_set(COALESCE(\"metadata\", '{}'::jsonb), '{consecutiveAuthFailures}'");
      expect(sql).toContain("'{deactivationReason}'");
      expect(sql).toContain('"isActive" = CASE');
      expect(sql).toContain('>= :threshold');
      expect(sql).not.toContain('plaidCursors');
      expect(options).toMatchObject({
        transaction: null,
        replacements: { connectionId: 'connection', threshold: 2, reason: DEACTIVATION_REASON.AUTH_FAILURE },
      });
    }
    await provider.disconnect('connection');
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/item/remove'))).toBe(true);
    const removal = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/item/remove'));
    expect(JSON.parse(String(removal?.[1]?.body))).toMatchObject({ access_token: 'access-token' });
    expect(row.destroy).toHaveBeenCalledTimes(1);
  } finally {
    fetchSpy.mockRestore();
    process.env = savedEnv;
  }
});
