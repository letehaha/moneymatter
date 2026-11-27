import { BANK_PROVIDER_TYPE } from '@bt/shared/types';

jest.mock('@models/bank-data-provider-connections.model', () => ({
  __esModule: true,
  default: { create: jest.fn() },
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
  ...jest.requireActual('./api-client'),
  getPlaidConfig: () => ({ clientId: 'client', secret: 'secret', environment: 'sandbox' }),
  PlaidApiClient: class {
    exchangePublicToken = mockExchange;
    removeItem = mockRemoveItem;
  },
}));

/* eslint-disable import/first */
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';

import { decryptCredentials } from '../utils/credential-encryption';
import { PlaidProvider } from './plaid.provider';
/* eslint-enable import/first */

beforeEach(() => mockRemoveItem.mockReset());

it('encrypts only the Plaid access token and item id when connecting', async () => {
  const create = jest.mocked(BankDataProviderConnections.create);
  create.mockResolvedValueOnce({ id: 'connection-id' } as never);

  const connectionId = await new PlaidProvider().connect(42, { publicToken: 'public-token' });

  expect(connectionId).toBe('connection-id');
  expect(mockRemoveItem).not.toHaveBeenCalled();
  const saved = create.mock.calls[0]![0]!;
  expect(saved).toEqual(
    expect.objectContaining({ userId: 42, providerType: BANK_PROVIDER_TYPE.PLAID, credentials: expect.any(String) }),
  );
  expect(saved.credentials).not.toContain('access-token');
  expect(saved.metadata).toMatchObject({ plaidCursors: {} });
  expect(decryptCredentials(saved.credentials)).toEqual({ access_token: 'access-token', item_id: 'item-id' });
});

it('removes the exchanged Item when the local create fails, without logging secrets', async () => {
  const logs = [jest.spyOn(logger, 'error'), jest.spyOn(logger, 'warn')];
  try {
    jest.mocked(BankDataProviderConnections.create).mockRejectedValueOnce(new Error('db down'));
    mockRemoveItem.mockRejectedValueOnce(new Error('remove failed'));
    await expect(new PlaidProvider().connect(42, { publicToken: 'public-token' })).rejects.toThrow();
    expect(mockRemoveItem).toHaveBeenCalledWith({ accessToken: 'access-token' });
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).toContain('item-id');
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toMatch(/access-token|public-token/);
  } finally {
    logs.forEach((log) => log.mockRestore());
  }
});
