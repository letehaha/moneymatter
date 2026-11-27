import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { Sequelize } from 'sequelize';

jest.mock('@models/bank-data-provider-connections.model', () => ({
  __esModule: true,
  default: { create: jest.fn(), update: jest.fn() },
}));
jest.mock('@models/accounts.model', () => ({ __esModule: true, default: {} }));
jest.mock('@models/connection', () => ({
  namespace: { get: jest.fn() },
  connection: { sequelize: { transaction: jest.fn(async (work: () => Promise<unknown>) => work()) } },
}));
jest.mock('@services/accounts/lock-account-row', () => ({ lockLinkedBankAccount: jest.fn() }));
jest.mock('../base-provider', () => ({
  AccountUnlinkedDuringSyncError: class extends Error {},
  BaseBankDataProvider: class {
    async nextConnectionName() {
      return 'Plaid';
    }
  },
}));
jest.mock('../utils/write-bank-balance-with-history', () => ({ writeBankBalanceWithHistory: jest.fn() }));
jest.mock('./apply-transaction-changes', () => ({ applyPlaidChanges: jest.fn() }));
const mockRemoveItem = jest.fn();
const mockExchange = jest.fn(async () => ({ access_token: 'access-token', item_id: 'item-id' }));
jest.mock('./api-client', () => ({
  getPlaidConfig: () => ({ clientId: 'client', secret: 'secret', environment: 'sandbox' }),
  PlaidApiClient: class {
    exchangePublicToken = mockExchange;
    removeItem = mockRemoveItem;
  },
  PlaidApiError: class extends Error {},
}));

/* eslint-disable import/first */
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection } from '@models/connection';

import * as credentialEncryption from '../utils/credential-encryption';
import { decryptCredentials } from '../utils/credential-encryption';
import { PlaidProvider } from './plaid.provider';
/* eslint-enable import/first */

it('exposes the auto-sync interval supported by Plaid', () => {
  expect(new PlaidProvider().metadata.features).toMatchObject({
    supportsAutoSync: true,
    defaultSyncInterval: 12 * 60 * 60 * 1000,
    minSyncInterval: 5 * 60 * 1000,
  });
});

it('encrypts only the Plaid access token and item id when connecting', async () => {
  const create = jest.mocked(BankDataProviderConnections.create);
  create.mockResolvedValueOnce({ id: 'connection-id' } as never);

  const connectionId = await new PlaidProvider().connect(42, { publicToken: 'public-token' });

  expect(connectionId).toBe('connection-id');
  expect(create).toHaveBeenCalledTimes(1);
  const saved = create.mock.calls[0]![0]!;
  expect(saved).toEqual(
    expect.objectContaining({ userId: 42, providerType: BANK_PROVIDER_TYPE.PLAID, credentials: expect.any(String) }),
  );
  expect(saved.credentials).not.toContain('access-token');
  expect(saved.credentials).not.toContain('item-id');
  expect(saved.metadata).toMatchObject({ plaidCursors: {} });
  expect(decryptCredentials(saved.credentials)).toEqual({ access_token: 'access-token', item_id: 'item-id' });
});

it('removes the exchanged Item when persistence fails without exposing secrets', async () => {
  const logs = [jest.spyOn(logger, 'error'), jest.spyOn(logger, 'warn'), jest.spyOn(logger, 'info')];
  try {
    jest.mocked(BankDataProviderConnections.create).mockRejectedValueOnce(new Error('access-token secret'));
    mockRemoveItem.mockRejectedValueOnce(new Error('access-token secret'));
    const error = await new PlaidProvider().connect(42, { publicToken: 'public-token' }).catch((err) => err);
    expect(mockRemoveItem).toHaveBeenCalledWith({ accessToken: 'access-token' });
    expect(String(error)).not.toMatch(/access-token|secret|public-token/);
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toMatch(/access-token|secret|public-token/);
  } finally {
    logs.forEach((log) => log.mockRestore());
  }
});

it('removes the exchanged Item when the managed transaction rejects at commit', async () => {
  mockRemoveItem.mockClear();
  jest.mocked(BankDataProviderConnections.create).mockResolvedValueOnce({ id: 'connection-id' } as never);
  const sequelize = new Sequelize('postgres://test:test@localhost/test', { logging: false });
  const queryInterface = sequelize.getQueryInterface();
  jest.spyOn(sequelize.connectionManager, 'getConnection').mockResolvedValue({} as never);
  jest.spyOn(sequelize.connectionManager, 'destroyConnection').mockResolvedValue(undefined);
  jest.spyOn(queryInterface, 'startTransaction').mockResolvedValue(undefined);
  jest.spyOn(queryInterface, 'setIsolationLevel').mockResolvedValue(undefined);
  const commit = jest.spyOn(queryInterface, 'commitTransaction').mockRejectedValue(new Error('commit failed'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.mocked(connection.sequelize.transaction).mockImplementationOnce(sequelize.transaction.bind(sequelize));
  try {
    await expect(new PlaidProvider().connect(42, { publicToken: 'public-token' })).rejects.toThrow();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mockRemoveItem).toHaveBeenCalledWith({ accessToken: 'access-token' });
  } finally {
    warning.mockRestore();
    await sequelize.close();
  }
});

it('rejects invalid persistence inputs before exchanging the public token', async () => {
  mockExchange.mockClear();
  const provider = new PlaidProvider();
  await expect(provider.connectWithDetails({
    userId: 42, credentials: { publicToken: 'public-token' }, providerName: 'x'.repeat(256),
  })).rejects.toThrow();
  await expect(provider.connectWithDetails({
    userId: 42, credentials: { publicToken: 'public-token' }, externalUrl: 'not-a-url',
  })).rejects.toThrow();
  expect(mockExchange).not.toHaveBeenCalled();
});

it('removes the exchanged Item when updating the connection fails', async () => {
  mockRemoveItem.mockClear();
  jest.mocked(BankDataProviderConnections.create).mockResolvedValueOnce({ id: 'connection-id' } as never);
  jest.mocked(BankDataProviderConnections.update).mockRejectedValueOnce(new Error('patch failed'));
  await expect(new PlaidProvider().connectWithDetails({
    userId: 42, credentials: { publicToken: 'public-token' }, externalUrl: 'https://bank.example',
  })).rejects.toThrow();
  expect(mockRemoveItem).toHaveBeenCalledWith({ accessToken: 'access-token' });
});

it('removes the exchanged Item when encryption fails', async () => {
  mockRemoveItem.mockClear();
  const encryption = jest.spyOn(credentialEncryption, 'encryptCredentials').mockImplementationOnce(() => {
    throw new Error('access-token');
  });
  try {
    const error = await new PlaidProvider().connect(42, { publicToken: 'public-token' }).catch((err) => err);
    expect(mockRemoveItem).toHaveBeenCalledWith({ accessToken: 'access-token' });
    expect(String(error)).not.toContain('access-token');
  } finally {
    encryption.mockRestore();
  }
});
