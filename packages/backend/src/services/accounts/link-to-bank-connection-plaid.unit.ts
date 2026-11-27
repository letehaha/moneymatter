import { ACCOUNT_TYPES, API_ERROR_CODES, BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { Money } from '@common/types/money';

jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));
jest.mock('@js/utils', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@js/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@models/accounts.model', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findOne: jest.fn() },
  getAccountById: jest.fn(),
}));
jest.mock('@models/bank-data-provider-connections.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), update: jest.fn() },
}));
jest.mock('@models/accounts-groups/account-groups.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@models/accounts-groups/account-grouping.model', () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock('@models/subscriptions.model', () => ({ __esModule: true, default: { update: jest.fn() } }));
jest.mock('@models/connection', () => ({
  connection: { sequelize: { transaction: jest.fn(), query: jest.fn() } },
  namespace: { get: jest.fn() },
  runOutsideTransaction: (fn: () => Promise<unknown>) => fn(),
}));
jest.mock('@common/lib/currency-precision', () => ({ roundToCurrency: async ({ money }: { money: Money }) => money }));
jest.mock('@services/accounts.service', () => ({ updateAccount: jest.fn() }));
jest.mock('@services/accounts/absorb-link-residual', () => ({
  absorbLinkResidualWithRateFallback: jest.fn(async () => ({})),
  runPendingLinkAbsorb: jest.fn(),
}));
jest.mock('@services/accounts/lock-account-row', () => ({ lockAccountRow: jest.fn(), lockLinkedBankAccount: jest.fn() }));
jest.mock('@services/accounts/restore-relinked-transactions-account-type', () => ({ restoreRelinkedTransactionsAccountType: jest.fn() }));
jest.mock('@services/balances/revalue-balance-history.service', () => ({ stampSeamBalance: jest.fn() }));
jest.mock('@services/bank-data-providers/connection/connect-selected-accounts', () => ({
  assertExternalAccountNotLinkedElsewhere: jest.fn(),
  requireProviderBalance: jest.fn(async () => Money.fromDecimal(100)),
}));
jest.mock('@services/bank-data-providers/sync/sync-status-tracker', () => ({
  SyncStatus: { SYNCING: 'syncing', COMPLETED: 'completed', FAILED: 'failed', IDLE: 'idle' },
  setAccountSyncStatus: jest.fn(async () => undefined),
}));
jest.mock('@services/bank-data-providers/utils/write-bank-balance-with-history', () => ({ writeBankBalanceWithHistory: jest.fn() }));
jest.mock('@services/bank-data-providers/utils/link-and-emit-synced-transactions', () => ({ linkAndEmitSyncedTransactions: jest.fn() }));
jest.mock('@services/bank-data-providers/plaid/apply-transaction-changes', () => ({ applyPlaidChanges: jest.fn(async () => []) }));
jest.mock('@services/import-export/core/unfinished-import', () => ({ assertNoUnfinishedImport: jest.fn() }));
jest.mock('@services/common/lock', () => ({ withLock: (_key: string, fn: () => Promise<unknown>) => fn }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn(async () => false) }));
jest.mock('@services/bank-data-providers/plaid/api-client', () => ({
  ...jest.requireActual('@services/bank-data-providers/plaid/api-client'),
  getPlaidConfig: () => ({ clientId: 'client', secret: 'secret', environment: 'sandbox' }),
}));

import Accounts, { getAccountById } from '@models/accounts.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection as db, namespace } from '@models/connection';
import { updateAccount } from '@services/accounts.service';
import { lockAccountRow, lockLinkedBankAccount } from '@services/accounts/lock-account-row';
import { bankProviderRegistry } from '@services/bank-data-providers/registry';
import { PlaidApiClient, PlaidApiError } from '@services/bank-data-providers/plaid/api-client';
import { PlaidProvider } from '@services/bank-data-providers/plaid/plaid.provider';

import { linkAccountToBankConnection } from './link-to-bank-connection';

describe('manual Plaid relink transaction ordering', () => {
  const accountId = 'account-id';
  const connectionId = 'connection-id';
  const externalAccountId = 'plaid-account';
  const userId = 42;
  const params = { accountId, connectionId, externalAccountId, userId };
  let events: string[];
  let rowLocked: boolean;
  let authFailures: number;
  let blockedAuthWrites: number;
  let account: Accounts;
  let bankConnection: BankDataProviderConnections;
  let activeTransaction: { LOCK: { NO_KEY_UPDATE: string } } | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    events = [];
    rowLocked = false;
    authFailures = 0;
    blockedAuthWrites = 0;
    activeTransaction = undefined;
    account = {
      id: accountId, userId, name: 'Checking', type: ACCOUNT_TYPES.system, currencyCode: 'USD',
      currentBalance: Money.fromDecimal(100), creditLimit: Money.zero(),
      externalId: null, externalData: null, bankDataProviderConnectionId: null,
      update: jest.fn(async (patch: Partial<Accounts>) => { events.push('account-update'); Object.assign(account, patch); }),
      reload: jest.fn(async () => account),
    } as unknown as Accounts;
    bankConnection = {
      id: connectionId, userId, providerType: BANK_PROVIDER_TYPE.PLAID, isActive: true,
      metadata: { plaidCursors: {} },
      getDecryptedCredentials: () => ({ access_token: 'access-token', item_id: 'item-id' }),
      update: jest.fn(async () => { events.push('connection-update'); rowLocked = true; }),
      save: jest.fn(async () => { events.push('connection-save'); rowLocked = true; }),
    } as unknown as BankDataProviderConnections;
    jest.mocked(namespace.get).mockImplementation(() => activeTransaction);
    jest.mocked(db.sequelize.transaction).mockImplementation((async (callback: () => Promise<unknown>) => {
      const snapshot = { type: account.type, externalId: account.externalId, externalData: account.externalData, bankDataProviderConnectionId: account.bankDataProviderConnectionId };
      activeTransaction = { LOCK: { NO_KEY_UPDATE: 'no-key-update' } };
      try {
        const result = await callback();
        events.push('commit');
        return result;
      } catch (error) {
        Object.assign(account, snapshot);
        events.push('rollback');
        throw error;
      } finally {
        activeTransaction = undefined;
        rowLocked = false;
      }
    }) as unknown as typeof db.sequelize.transaction);
    jest.mocked(db.sequelize.query).mockImplementation((async (sql: string, options: { transaction: null }) => {
      expect(options.transaction).toBeNull();
      if (rowLocked) {
        blockedAuthWrites++;
        events.push('blocked-auth-write');
        throw new Error('connection row locked by outer transaction');
      }
      if (sql.includes(' + 1')) {
        events.push('auth-failure');
        authFailures++;
        return [[{ failures: authFailures }], {}];
      }
      events.push('auth-reset');
      authFailures = 0;
      return [[], {}];
    }) as unknown as typeof db.sequelize.query);
    jest.mocked(getAccountById).mockResolvedValue(account);
    jest.mocked(Accounts.findOne).mockResolvedValue(account);
    jest.mocked(Accounts.findByPk).mockResolvedValue(account);
    jest.mocked(lockAccountRow).mockResolvedValue(account);
    jest.mocked(lockLinkedBankAccount).mockResolvedValue(account);
    jest.mocked(AccountGroup.findOne).mockResolvedValue(null);
    jest.mocked(BankDataProviderConnections.findOne).mockImplementation((async (options: { lock?: unknown }) => {
      if (options.lock) { events.push('connection-lock'); rowLocked = true; }
      return bankConnection;
    }) as unknown as typeof BankDataProviderConnections.findOne);
    jest.mocked(BankDataProviderConnections.update).mockImplementation((async () => {
      events.push('connection-update');
      rowLocked = true;
      return [1];
    }) as unknown as typeof BankDataProviderConnections.update);
    jest.spyOn(bankProviderRegistry, 'get').mockReturnValue(new PlaidProvider());
    jest.spyOn(PlaidApiClient.prototype, 'getAccounts').mockImplementation(async () => {
      events.push('accounts-get');
      return [{ account_id: externalAccountId, name: 'Checking', type: 'depository', subtype: 'checking', balances: { current: 100, available: 100, limit: null, iso_currency_code: 'USD' } }];
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    { providerType: BANK_PROVIDER_TYPE.PLAID, expectedBalance: 100 },
    { providerType: BANK_PROVIDER_TYPE.MONOBANK, expectedBalance: 1600 },
  ])('adopts the limit with the correct balance for $providerType', async ({ providerType, expectedBalance }) => {
    account.creditLimit = Money.fromDecimal(500);
    bankConnection.providerType = providerType;
    const provider = new PlaidProvider();
    jest.spyOn(provider, 'fetchAccounts').mockResolvedValue([{
      externalId: externalAccountId,
      name: 'Credit card',
      type: 'credit',
      currency: 'USD',
      balance: Money.fromDecimal(-50),
      creditLimit: Money.fromDecimal(2000),
      metadata: {},
    }]);
    jest.spyOn(bankProviderRegistry, 'get').mockReturnValue(provider);
    jest.mocked(lockAccountRow).mockRejectedValueOnce(new Error('stop after limit update'));

    await expect(linkAccountToBankConnection(params)).rejects.toThrow('stop after limit update');
    expect(updateAccount).toHaveBeenCalledWith(expect.objectContaining({
      id: accountId,
      userId,
      creditLimit: Money.fromDecimal(2000),
      currentBalance: Money.fromDecimal(expectedBalance),
    }));
  });

  it('records ITEM_LOGIN_REQUIRED outside the transaction and rolls back the account link', async () => {
    jest.spyOn(PlaidApiClient.prototype, 'syncTransactions').mockImplementation(async () => {
      events.push('transactions-sync');
      throw new PlaidApiError({ status: 400, code: 'ITEM_LOGIN_REQUIRED' });
    });

    await expect(linkAccountToBankConnection(params)).rejects.toMatchObject({ code: API_ERROR_CODES.invalidCredentials });
    expect(events).toEqual(['accounts-get', 'auth-reset', 'account-update', 'accounts-get', 'transactions-sync', 'auth-failure', 'rollback']);
    expect(PlaidApiClient.prototype.getAccounts).toHaveBeenCalledTimes(2);
    expect(PlaidApiClient.prototype.getAccounts).toHaveBeenCalledWith({ accessToken: 'access-token' });
    expect(blockedAuthWrites).toBe(0);
    expect(authFailures).toBe(1);
    expect(account).toMatchObject({ type: ACCOUNT_TYPES.system, externalId: null, externalData: null, bankDataProviderConnectionId: null });
  });

  it('writes the successful inline sync timestamp only after authenticated fetches', async () => {
    jest.spyOn(PlaidApiClient.prototype, 'syncTransactions').mockImplementation(async () => {
      events.push('transactions-sync');
      return { added: [], modified: [], removed: [], cursor: '' };
    });

    await linkAccountToBankConnection(params);
    expect(blockedAuthWrites).toBe(0);
    expect(events).toEqual(['accounts-get', 'auth-reset', 'account-update', 'accounts-get', 'transactions-sync', 'auth-reset', 'connection-lock', 'connection-update', 'connection-update', 'commit']);
    expect(BankDataProviderConnections.update).toHaveBeenCalledWith(
      { lastSyncAt: expect.any(Date) },
      { where: { id: connectionId } },
    );
    expect(account).toMatchObject({ type: ACCOUNT_TYPES.plaid, externalId: externalAccountId, bankDataProviderConnectionId: connectionId });
  });
});
