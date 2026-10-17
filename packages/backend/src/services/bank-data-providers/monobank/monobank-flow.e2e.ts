import { ACCOUNT_STATUSES, API_ERROR_CODES, API_RESPONSE_STATUS, BANK_PROVIDER_TYPE, asCents } from '@bt/shared/types';
import { NONEXISTENT_ID, generateRandomRecordId } from '@common/lib/record-id-helpers';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import Currencies from '@models/currencies.model';
import Transactions from '@models/transactions.model';
import { redisClient } from '@root/redis-client';
import { handleCompletedBatch } from '@root/services/bank-data-providers/monobank/transaction-sync-queue';
import {
  REDIS_KEYS,
  SyncStatus,
  setAccountSyncStatus,
} from '@root/services/bank-data-providers/sync/sync-status-tracker';
import { calculateRefAmount } from '@root/services/calculate-ref-amount.service';
import * as helpers from '@tests/helpers';
import {
  INVALID_MONOBANK_TOKEN,
  MONOBANK_URLS_MOCK,
  VALID_MONOBANK_TOKEN,
  getMonobankTransactionsMock,
} from '@tests/mocks/monobank/mock-api';
import { Job } from 'bullmq';
import { HttpResponse, http } from 'msw';
import { Op } from 'sequelize';

/**
 * E2E tests for Monobank Data Provider using the new unified connection flow
 * Tests the complete flow from connection to account sync
 */
describe('Monobank Data Provider E2E', () => {
  describe('Complete connection flow', () => {
    it('should complete the full flow: list providers -> connect -> list connections -> list external accounts -> connect accounts -> get details', async () => {
      // Step 1: Fetch supported providers
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);

      // Verify Monobank is in the list
      const monobankProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.MONOBANK)!;
      expect(monobankProvider).toBeDefined();
      expect(monobankProvider.name).toBe('Monobank');

      // Step 2: Connect to selected provider
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'My Monobank Connection',
        raw: true,
      });

      expect(connectResult).toHaveProperty('connectionId');
      expect(connectResult.connectionId).toBeDefined();

      const connectionId = connectResult.connectionId;

      // Step 3: Fetch user's connected providers
      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      expect(Array.isArray(connections)).toBe(true);
      expect(connections.length).toBeGreaterThan(0);

      const connection = connections.find((c: { id: string }) => c.id === connectionId);
      expect(connection).toBeDefined();
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.MONOBANK);
      expect(connection?.providerName).toBe('My Monobank Connection');
      expect(connection?.isActive).toBe(true);
      expect(connection?.accountsCount).toBe(0); // No accounts connected yet

      // Step 4: List external accounts of the connected provider
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      expect(Array.isArray(externalAccounts)).toBe(true);
      expect(externalAccounts.length).toBeGreaterThan(0);

      // Verify account structure
      const firstAccount = externalAccounts[0];
      expect(firstAccount).toHaveProperty('externalId');
      expect(firstAccount).toHaveProperty('name');
      expect(firstAccount).toHaveProperty('type');
      expect(firstAccount).toHaveProperty('balance');
      expect(firstAccount).toHaveProperty('currency');

      // Step 5: Connect selected accounts
      const accountIdsToConnect = externalAccounts.slice(0, 2).map((acc: { externalId: string }) => acc.externalId);

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: accountIdsToConnect,
        raw: true,
      });

      expect(Array.isArray(syncedAccounts)).toBe(true);
      expect(syncedAccounts.length).toBe(accountIdsToConnect.length);

      // Verify created accounts
      syncedAccounts.forEach((account, idx: number) => {
        expect(account.externalId).toBe(accountIdsToConnect[idx]);
      });

      // Step 6: Fetch connection details
      const { connection: connectionDetails } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(connectionDetails).toBeDefined();
      expect(connectionDetails.id).toBe(connectionId);
      expect(connectionDetails.providerType).toBe(BANK_PROVIDER_TYPE.MONOBANK);
      expect(connectionDetails.providerName).toBe('My Monobank Connection');
      expect(connectionDetails.isActive).toBe(true);

      // Verify provider metadata
      expect(connectionDetails.provider).toBeDefined();
      expect(connectionDetails.provider.name).toBe('Monobank');
      expect(connectionDetails.provider.description).toBeDefined();
      expect(connectionDetails.provider.features).toBeDefined();

      // Verify connected accounts are in details
      expect(Array.isArray(connectionDetails.accounts)).toBe(true);
      expect(connectionDetails.accounts.length).toBe(accountIdsToConnect.length);

      connectionDetails.accounts.forEach(
        (account: { externalId: string; id: string; name: string; currentBalance: number; currencyCode: string }) => {
          expect(accountIdsToConnect).toContain(account.externalId);
          expect(account).toHaveProperty('id');
          expect(account).toHaveProperty('name');
          expect(account).toHaveProperty('currentBalance');
          expect(account).toHaveProperty('currencyCode');
        },
      );

      // Verify connections list now shows updated account count
      const { connections: updatedConnections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const updatedConnection = updatedConnections.find((c: { id: string }) => c.id === connectionId);
      expect(updatedConnection?.accountsCount).toBe(accountIdsToConnect.length);
    });
  });

  describe('Step 1: List supported providers', () => {
    it('should return list of available providers', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);
    });

    it('should include provider metadata with correct structure', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      const provider = providers[0]!;
      expect(provider).toHaveProperty('type');
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('description');
      expect(provider).toHaveProperty('features');

      // Verify features structure
      expect(provider.features).toHaveProperty('supportsWebhooks');
      expect(provider.features).toHaveProperty('supportsRealtime');
      expect(provider.features).toHaveProperty('requiresReauth');
      expect(provider.features).toHaveProperty('supportsManualSync');
      expect(provider.features).toHaveProperty('supportsAutoSync');
    });

    it('should include Monobank provider', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      const monobankProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.MONOBANK)!;
      expect(monobankProvider).toBeDefined();
      expect(monobankProvider.name).toBe('Monobank');
    });
  });

  describe('Step 2: Connect provider', () => {
    it('should return validation error if credentials are missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await helpers.bankDataProviders.connectProvider({} as any);

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should return validation error for invalid provider type', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/invalid-provider/connect',
        payload: {
          credentials: { apiToken: 'test' },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should successfully connect with valid credentials', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      expect(result).toHaveProperty('connectionId');
      expect(typeof result.connectionId).toBe('string');
    });

    it('should fail with invalid credentials', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.MONOBANK}/connect`,
        payload: {
          credentials: { apiToken: INVALID_MONOBANK_TOKEN },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.Forbidden);
    });

    it('should accept optional provider name', async () => {
      const customName = 'My Custom Provider Name';
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: customName,
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);
      expect(connection?.providerName).toBe(customName);
    });

    it('should validate Monobank requires apiToken', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.MONOBANK}/connect`,
        payload: {
          credentials: { wrongField: 'value' },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });
  });

  describe('Step 3: List user connections', () => {
    it('should return empty array when no connections exist', async () => {
      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      expect(Array.isArray(connections)).toBe(true);
    });

    it('should list user connection after connecting', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'My Connection',
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      expect(connections.length).toBeGreaterThanOrEqual(1);
      expect(connections.find((c: { id: string }) => c.id === result.connectionId)).toBeDefined();
    });

    it('should return connections with correct structure', async () => {
      await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections[0];

      expect(connection).toHaveProperty('id');
      expect(connection).toHaveProperty('providerType');
      expect(connection).toHaveProperty('providerName');
      expect(connection).toHaveProperty('isActive');
      expect(connection).toHaveProperty('lastSyncAt');
      expect(connection).toHaveProperty('accountsCount');
      expect(connection).toHaveProperty('createdAt');
    });

    it('should show accountsCount as 0 for newly connected providers', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);

      expect(connection?.accountsCount).toBe(0);
    });

    it('should allow multiple connections to the same provider', async () => {
      const result1 = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'Monobank 1',
        raw: true,
      });

      const result2 = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'Monobank 2',
        raw: true,
      });

      expect(result1.connectionId).not.toBe(result2.connectionId);

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const monobankConnections = connections.filter(
        (c: { providerType: string }) => c.providerType === BANK_PROVIDER_TYPE.MONOBANK,
      );

      expect(monobankConnections.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Step 4: List external accounts', () => {
    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: generateRandomRecordId(),
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('should list external accounts from provider', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
    });

    it('should return accounts with correct structure', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const account = accounts[0];
      expect(account).toHaveProperty('externalId');
      expect(account).toHaveProperty('name');
      expect(account).toHaveProperty('type');
      expect(account).toHaveProperty('balance');
      expect(account).toHaveProperty('currency');
      expect(typeof account!.balance).toBe('number');
      expect(typeof account!.currency).toBe('string');
    });

    it('should return accounts matching mocked data', async () => {
      const mockedData = helpers.monobank.mockedClientData();
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(accounts.length).toBe(mockedData.accounts.length);
    });
  });

  describe('Step 5: Connect selected accounts', () => {
    it('should automatically sync transactions when connecting accounts', async () => {
      const MOCK_AMOUNT = 5;

      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const accountIds = externalAccounts.slice(0, 2).map((acc: { externalId: string }) => acc.externalId);

      global.mswMockServer.use(
        ...accountIds.map((id) =>
          getMonobankTransactionsMock({ accountId: id, response: helpers.monobank.mockedTransactionData(MOCK_AMOUNT) }),
        ),
      );

      // Connect accounts - this should trigger automatic transaction sync
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      // Monobank uses queues, they require some delay
      await helpers.sleep(5000);

      // Verify transactions were automatically synced by checking if any transactions exist for this account
      const transactions = await Transactions.findAll({
        where: {
          accountId: {
            [Op.in]: syncedAccounts.map((i) => i.id),
          },
        },
        raw: true,
      });

      // Transactions should have been automatically synced
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBe(MOCK_AMOUNT * accountIds.length);
    });

    it('stores the fiscal receipt id as externalReference', async () => {
      const { account } = await helpers.monobank.mockTransactions({
        transactions: [
          { amount: -1000, description: 'WITH RECEIPT', receiptId: 'AAAA-BBBB-CCCC-DDDD' },
          { amount: -2000, description: 'WITH INVOICE', invoiceId: '2103.в.27' },
          { amount: -3000, description: 'WITH NEITHER' },
        ],
      });

      let rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      for (let attempt = 0; attempt < 10 && rows.length < 3; attempt += 1) {
        await helpers.sleep(300);
        rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
      }
      expect(rows).toHaveLength(3);

      const byNote = (note: string) => rows.find((row) => row.note === note)!;
      expect(byNote('WITH RECEIPT').externalReference).toBe('AAAA-BBBB-CCCC-DDDD');
      expect(byNote('WITH INVOICE').externalReference).toBe('2103.в.27');
      expect(byNote('WITH NEITHER').externalReference).toBeNull();
    }, 30000);

    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: generateRandomRecordId(),
        accountExternalIds: ['account-1'],
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('should fail with invalid account IDs', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionResult.connectionId}/sync-selected-accounts`,
        payload: {
          accountExternalIds: ['non-existent-id'],
        },
      });

      expect(result.status).toEqual(ERROR_CODES.BadRequest);
    });

    it('should successfully connect valid accounts', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const accountIds = externalAccounts.slice(0, 2).map((acc: { externalId: string }) => acc.externalId);

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      expect(syncedAccounts.length).toBe(2);
      syncedAccounts.forEach((account) => {
        expect(accountIds).toContain(account.externalId);
      });
    });

    it('should create accounts with correct balances and currency', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const selectedExternal = externalAccounts[0]!;

      const { syncedAccounts: connectedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [selectedExternal.externalId],
        raw: true,
      });

      const createdAccount = connectedAccounts[0]!;

      const account = await helpers.getAccount({ id: createdAccount.id, raw: true });

      expect(account.currentBalance).toBe(selectedExternal.balance);
      expect(account.initialBalance).toBe(selectedExternal.balance);
      expect(account.currencyCode).toBe(selectedExternal.currency);
    });

    it('should convert refCreditLimit to base currency when account currency differs', async () => {
      // Regression: refCreditLimit used to be copied raw from the provider's
      // native cents — causing order-of-magnitude errors in base-currency
      // credit totals for non-base-currency accounts. It must now be converted
      // via calculateRefAmount, consistent with refInitialBalance/refCurrentBalance.
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      // Mock has a UAH account with creditLimit = 2000 UAH (200_000 cents).
      // Test base currency is AED (set in setupIntegrationTests.ts).
      const uahExternal = externalAccounts.find((a: { currency: string }) => a.currency === 'UAH')!;
      expect(uahExternal).toBeDefined();

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [uahExternal.externalId],
        raw: true,
      });

      const created = await Accounts.findByPk(syncedAccounts[0]!.id);
      const creditLimitCents = created!.creditLimit.toCents();
      const refCreditLimitCents = created!.refCreditLimit!.toCents();

      expect(creditLimitCents).toBe(200000);
      expect(refCreditLimitCents).not.toBe(creditLimitCents);

      const expected = await calculateRefAmount({
        amount: Money.fromCents(creditLimitCents),
        userId: created!.userId,
        date: new Date(),
        baseCode: 'UAH',
      });
      expect(refCreditLimitCents).toEqualRefValue(expected.toCents());
    });

    it('should set refCreditLimit = 0 when the account has no credit limit', async () => {
      // Mock's USD account has creditLimit = 0. Both fields must be zero.
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const usdExternal = externalAccounts.find((a: { currency: string }) => a.currency === 'USD')!;
      expect(usdExternal).toBeDefined();

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [usdExternal.externalId],
        raw: true,
      });

      const created = await Accounts.findByPk(syncedAccounts[0]!.id);
      expect(created!.creditLimit.toCents()).toBe(0);
      expect(created!.refCreditLimit!.toCents()).toBe(0);
    });

    it('should update connection lastSyncAt after connecting accounts', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connections: connectionsBefore } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connectionBefore = connectionsBefore.find((c: { id: string }) => c.id === connectionResult.connectionId);
      expect(connectionBefore?.lastSyncAt).toBeNull();

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const { connections: connectionsAfter } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connectionAfter = connectionsAfter.find((c: { id: string }) => c.id === connectionResult.connectionId);
      expect(connectionAfter?.lastSyncAt).not.toBeNull();
    });

    it('should advance connection lastSyncAt after a repeat Monobank sync', async () => {
      // Regression: Monobank's queue-based sync wrote lastSyncAt only on the
      // initial connect (via connect-selected-accounts). Subsequent syncs ran
      // through the BullMQ worker, which updated account-level externalData
      // timestamps but never the connection row — so the list view's "Last
      // synced" column was frozen at connect-time.
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      // Give the initial sync time to hit the worker's 'completed' handler.
      await helpers.sleep(1000);

      const { connection: afterConnect } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectionResult.connectionId,
        raw: true,
      });
      const initialLastSyncAt = afterConnect.lastSyncAt;
      expect(initialLastSyncAt).not.toBeNull();

      // Wait so a new timestamp would be visibly different.
      await helpers.sleep(1100);

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));
      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId: connectionResult.connectionId,
        accountId: syncedAccounts[0]!.id,
        raw: true,
      });

      // Wait for all queued batches to complete.
      await helpers.sleep(2000);

      const { connection: afterResync } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(new Date(afterResync.lastSyncAt!).getTime()).toBeGreaterThan(new Date(initialLastSyncAt!).getTime());
    });

    it('should return a 4xx error when the provider returns an unsupported currency', async () => {
      // We pick DJF (Djiboutian Franc, ISO 4217 code 262), delete it from the
      // Currencies table, and then mock Monobank to return an account with that currency.

      // Pre-flight: make sure DJF is present, then remove it.
      const djfBefore = await Currencies.findOne({ where: { code: 'DJF' } });
      expect(djfBefore).not.toBeNull();
      await Currencies.destroy({ where: { code: 'DJF' } });

      try {
        // Override /personal/client-info to return a single account in DJF.
        global.mswMockServer.use(
          http.get(MONOBANK_URLS_MOCK.clientInfo, () => {
            return HttpResponse.json({
              clientId: 'test-client',
              name: 'Test User',
              webHookUrl: '',
              permissions: '',
              accounts: [
                {
                  id: 'djf-account',
                  sendId: 'sid-djf',
                  balance: asCents(10000),
                  creditLimit: asCents(0),
                  type: 'black',
                  currencyCode: 262, // DJF
                  cashbackType: 'None',
                  maskedPan: [],
                  iban: 'djf-iban',
                },
              ],
              jars: [],
            });
          }),
        );

        const { connectionId } = await helpers.bankDataProviders.connectProvider({
          providerType: BANK_PROVIDER_TYPE.MONOBANK,
          credentials: { apiToken: VALID_MONOBANK_TOKEN },
          raw: true,
        });

        const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
          connectionId,
          raw: true,
        });
        const djfExternal = externalAccounts.find((a: { currency: string }) => a.currency === 'DJF')!;
        expect(djfExternal).toBeDefined();

        global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

        const response = await helpers.bankDataProviders.connectSelectedAccounts({
          connectionId,
          accountExternalIds: [djfExternal.externalId],
        });

        // The endpoint must respond with a handled 4xx error, not a 500/crash from
        // `currency.code` on null.
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);
        expect(response.body.status).toBe(API_RESPONSE_STATUS.error);
        expect((response.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.BadRequest);
      } finally {
        // Restore DJF so later tests in the suite are unaffected.
        await Currencies.create(djfBefore!.get({ plain: true }));
      }
    });

    it('should enable existing disabled accounts when reconnecting', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const accountId = externalAccounts[0]!.externalId;

      // Connect account first time
      const { syncedAccounts: firstConnect } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [accountId],
        raw: true,
      });

      const firstAccountId = firstConnect[0]!.id;

      // Archive the account (this also unlinks bank connection)
      await helpers.updateAccount({
        id: firstAccountId,
        payload: { status: ACCOUNT_STATUSES.archived },
      });

      // Reconnect the same account
      const { syncedAccounts: secondConnect } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [accountId],
        raw: true,
      });

      expect(secondConnect[0]!.id).toBe(firstAccountId);

      const account = await helpers.getAccount({
        id: secondConnect[0]!.id,
        raw: true,
      });

      expect(account.status).toBe('active');
    });

    it('should update accountsCount after connecting accounts', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId, externalAccounts[1]!.externalId],
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectionResult.connectionId);
      expect(connection?.accountsCount).toBe(2);
    });
  });

  describe('Step 6: Get connection details', () => {
    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.makeRequest({
        method: 'get',
        url: `/bank-data-providers/connections/${NONEXISTENT_ID}`,
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('should return connection details with provider metadata', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'Test Connection',
        raw: true,
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(details.id).toBe(connectionResult.connectionId);
      expect(details.providerType).toBe(BANK_PROVIDER_TYPE.MONOBANK);
      expect(details.providerName).toBe('Test Connection');
      expect(details.isActive).toBe(true);

      expect(details.provider).toBeDefined();
      expect(details.provider.name).toBe('Monobank');
      expect(details.provider.description).toBeDefined();
      expect(details.provider.features).toBeDefined();
    });

    it('should include connected accounts in details', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId, externalAccounts[1]!.externalId],
        raw: true,
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(details.accounts).toBeDefined();
      expect(details.accounts.length).toBe(2);

      details.accounts.forEach(
        (account: {
          id: string;
          name: string;
          externalId: string;
          currentBalance: number;
          currencyCode: string;
          type: string;
        }) => {
          expect(account).toHaveProperty('id');
          expect(account).toHaveProperty('name');
          expect(account).toHaveProperty('externalId');
          expect(account).toHaveProperty('currentBalance');
          expect(account).toHaveProperty('currencyCode');
          expect(account).toHaveProperty('type');
        },
      );
    });

    it('should return empty accounts array when no accounts connected', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      expect(details.accounts).toEqual([]);
    });
  });

  describe('Connection persistence and state', () => {
    it('should store credentials securely (encrypted)', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      // Get connection details
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: result.connectionId,
        raw: true,
      });

      expect(connection).toBeDefined();
      expect(connection.id).toBe(result.connectionId);
      expect(connection.providerType).toBe(BANK_PROVIDER_TYPE.MONOBANK);
      expect(connection.isActive).toBe(true);
    });

    it('should create connection with correct initial state', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);

      expect(connection).toBeDefined();
      expect(connection?.isActive).toBe(true);
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.MONOBANK);
      expect(connection?.lastSyncAt).toBeNull();
      expect(connection?.createdAt).toBeDefined();
      expect(connection?.accountsCount).toBe(0); // No accounts synced yet
    });

    it('should rollback transaction on connection failure', async () => {
      const { connections: connectionsBefore } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const countBefore = connectionsBefore.length;

      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.MONOBANK}/connect`,
        payload: {
          credentials: { apiToken: INVALID_MONOBANK_TOKEN },
        },
      });

      const { connections: connectionsAfter } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const countAfter = connectionsAfter.length;

      expect(countAfter).toBe(countBefore); // No new connection created
    });
  });

  describe('Multi-batch completion accounting', () => {
    // Regression: the 'completed' handler used to derive "all batches done"
    // from the queue's completed set. Under concurrent syncs the queue's
    // `removeOnComplete` eviction removes earlier batches from that set,
    // so the query returns fewer than `totalBatches` and the final
    // COMPLETED transition is never triggered — the account sits SYNCING
    // until the 20-minute stale sweep. The counter-based implementation
    // increments a dedicated Redis key per jobGroupId, so each batch
    // contributes exactly one INCR no matter how the queue trims itself.
    //
    // This test calls `handleCompletedBatch` directly for N fabricated
    // batches of a single group. None of them are real jobs in BullMQ, so
    // any queue-snapshot-based implementation would see zero completed
    // jobs in the group on every call and never fire the transition.
    // Only the counter approach accumulates across calls, reaches
    // totalBatches, and sets COMPLETED.
    const buildFakeJob = (params: {
      jobGroupId: string;
      batchIndex: number;
      totalBatches: number;
      userId: number;
      accountId: string;
      connectionId: string;
      externalAccountId: string;
    }): Job =>
      ({
        id: `${params.jobGroupId}-${params.batchIndex}`,
        data: {
          userId: params.userId,
          accountId: params.accountId,
          connectionId: params.connectionId,
          externalAccountId: params.externalAccountId,
          apiToken: 'unused-in-handler',
          fromTimestamp: 0,
          toTimestamp: 0,
          batchIndex: params.batchIndex,
          totalBatches: params.totalBatches,
        },
      }) as unknown as Job;

    // `connectSelectedAccounts` enqueues a real BullMQ job. The worker
    // processes it asynchronously and its 'completed' listener fires
    // `handleCompletedBatch` for the real job, which writes COMPLETED to
    // the same Redis key these tests assert on. If we start the manual
    // scenario before that real-job listener has run, it can land between
    // a `setAccountSyncStatus(SYNCING)` and the next status read, flipping
    // the assertion. Wait for the real sync to reach a terminal state so
    // its writes are settled before manipulating state by hand.
    const waitForBackgroundSyncToSettle = async (accountId: string, timeoutMs = 10_000): Promise<void> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
        if (raw) {
          const { status } = JSON.parse(raw) as { status: SyncStatus };
          if (status === SyncStatus.COMPLETED || status === SyncStatus.FAILED) return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Background sync for account ${accountId} did not settle within ${timeoutMs}ms`);
    };

    it('should flip account to COMPLETED exactly when the Nth batch of N completes', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;
      const account = await Accounts.findByPk(accountId);
      const userId = account!.userId;

      await waitForBackgroundSyncToSettle(accountId);

      // Put the account into SYNCING, mirroring the worker's mid-sync state.
      await setAccountSyncStatus({ accountId, status: SyncStatus.SYNCING, userId });

      const totalBatches = 3;
      const jobGroupId = `${userId}-${accountId}-${Date.now()}`;

      for (let i = 0; i < totalBatches; i++) {
        await handleCompletedBatch(
          buildFakeJob({
            jobGroupId,
            batchIndex: i,
            totalBatches,
            userId,
            accountId,
            connectionId,
            externalAccountId: externalAccounts[0]!.externalId,
          }),
        );

        const raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
        const parsed = JSON.parse(raw!);

        if (i < totalBatches - 1) {
          // Intermediate batches must not fire the final transition.
          expect(parsed.status).toBe(SyncStatus.SYNCING);
        } else {
          // Last batch flips it.
          expect(parsed.status).toBe(SyncStatus.COMPLETED);
        }
      }

      // The connection's lastSyncAt is also bumped so the list view's
      // "Last synced" column reflects this group, not just connect-time.
      const reloadedConnection = await BankDataProviderConnections.findByPk(connectionId);
      expect(reloadedConnection!.lastSyncAt).not.toBeNull();

      // And the counter key is cleaned up once the group is settled —
      // otherwise Redis slowly fills with orphan keys from every sync.
      const counterKey = `jobgroup:${jobGroupId}:completions`;
      const counterValue = await redisClient.get(counterKey);
      expect(counterValue).toBeNull();
    });

    it('should not be confused by two concurrent groups on the same account', async () => {
      // Two sync operations for one account running in parallel (rare but
      // possible — e.g., auto-sync kicks in just as a manual load-for-period
      // is triggered). Each group has its own jobGroupId → its own counter.
      // The second group must be able to complete independently, even after
      // the first already cleared its counter.
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;
      const account = await Accounts.findByPk(accountId);
      const userId = account!.userId;

      await waitForBackgroundSyncToSettle(accountId);

      const groupA = `${userId}-${accountId}-${Date.now()}-a`;
      const groupB = `${userId}-${accountId}-${Date.now()}-b`;
      const commonArgs = {
        totalBatches: 2,
        userId,
        accountId,
        connectionId,
        externalAccountId: externalAccounts[0]!.externalId,
      };

      await setAccountSyncStatus({ accountId, status: SyncStatus.SYNCING, userId });

      // Finish group A completely.
      await handleCompletedBatch(buildFakeJob({ ...commonArgs, jobGroupId: groupA, batchIndex: 0 }));
      await handleCompletedBatch(buildFakeJob({ ...commonArgs, jobGroupId: groupA, batchIndex: 1 }));

      let raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
      expect(JSON.parse(raw!).status).toBe(SyncStatus.COMPLETED);

      // Back to SYNCING for group B, then finish it.
      await setAccountSyncStatus({ accountId, status: SyncStatus.SYNCING, userId });
      await handleCompletedBatch(buildFakeJob({ ...commonArgs, jobGroupId: groupB, batchIndex: 0 }));

      raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
      expect(JSON.parse(raw!).status).toBe(SyncStatus.SYNCING);

      await handleCompletedBatch(buildFakeJob({ ...commonArgs, jobGroupId: groupB, batchIndex: 1 }));

      raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
      expect(JSON.parse(raw!).status).toBe(SyncStatus.COMPLETED);
    });
  });

  describe('Provider outage vs. invalid credentials', () => {
    it('connect: should not treat a provider 5xx as invalid credentials', async () => {
      global.mswMockServer.use(
        http.get(MONOBANK_URLS_MOCK.clientInfo, () => {
          return new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.MONOBANK}/connect`,
        payload: {
          credentials: { apiToken: VALID_MONOBANK_TOKEN },
        },
      });

      // A provider outage must NOT be reported to the user as an auth failure.
      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });

    it('connect: should surface a 429 as TooManyRequests, not as invalid credentials', async () => {
      global.mswMockServer.use(
        http.get(MONOBANK_URLS_MOCK.clientInfo, () => {
          return HttpResponse.json(
            { errorDescription: 'Too many requests' },
            { status: 429, statusText: 'Too Many Requests' },
          );
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.MONOBANK}/connect`,
        payload: {
          credentials: { apiToken: VALID_MONOBANK_TOKEN },
        },
      });

      // Rate limiting is distinct from invalid credentials.
      expect(result.status).toEqual(ERROR_CODES.TooManyRequests);
    });

    it('refreshCredentials: should not treat a provider 5xx as invalid credentials', async () => {
      // Set up an active connection with valid credentials first.
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      // Simulate provider outage during the refresh attempt.
      global.mswMockServer.use(
        http.get(MONOBANK_URLS_MOCK.clientInfo, () => {
          return new HttpResponse(null, { status: 503, statusText: 'Service Unavailable' });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectResult.connectionId}`,
        payload: {
          credentials: { apiToken: VALID_MONOBANK_TOKEN },
        },
      });

      // User attempted to refresh their (valid) token but the provider was down —
      // we must NOT tell them the credentials are invalid.
      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Stale external account id', () => {
    it('sync: should fail without retrying and surface a reconnect message', async () => {
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });
      const accountId = syncedAccounts[0]!.id;

      // Let the connect-time auto-sync drain so its jobs can't be mistaken for
      // the one this test enqueues below.
      await helpers.sleep(2000);

      // Monobank's response once the stored external id no longer belongs to
      // the token's client — the card was closed, or the user reconnected under
      // a different Monobank account.
      let statementCalls = 0;
      global.mswMockServer.use(
        http.get(MONOBANK_URLS_MOCK.personalStatement, () => {
          statementCalls += 1;
          return HttpResponse.json({ errorDescription: "invalid 'account'" }, { status: 400 });
        }),
      );

      const syncResult = await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const jobResult = await helpers.bankDataProviders.waitForSyncJobsToComplete({
        connectionId,
        jobGroupId: syncResult.jobGroupId!,
        timeoutMs: 15000,
      });

      // The batch settles as failed rather than sitting delayed awaiting a
      // second attempt, and Monobank is asked exactly once.
      expect(jobResult.status).toBe('failed');
      expect(jobResult.totalBatches).toBe(1);
      expect(jobResult.failedBatches).toBe(1);
      expect(statementCalls).toBe(1);

      const raw = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
      const syncStatus = JSON.parse(raw!);

      expect(syncStatus.status).toBe(SyncStatus.FAILED);
      expect(syncStatus.error).toBe(t({ key: 'bankDataProviders.monobank.accountReconnectRequired' }));
      expect(syncStatus.error).not.toContain("invalid 'account'");
    });
  });
});
