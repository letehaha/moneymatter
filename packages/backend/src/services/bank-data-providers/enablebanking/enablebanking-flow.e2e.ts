import { ACCOUNT_STATUSES, BANK_PROVIDER_TYPE, DEACTIVATION_REASON } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection as dbConnection } from '@models/index';
import Transactions from '@models/transactions.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import {
  FixedTransaction,
  INVALID_ENABLE_BANKING_APP_ID,
  INVALID_ENABLE_BANKING_PRIVATE_KEY,
  MOCK_BANK_COUNTRY,
  MOCK_BANK_NAME,
  MOCK_IDENTIFICATION_HASH_1,
  MOCK_IDENTIFICATION_HASH_2,
  MOCK_IDENTIFICATION_HASH_3,
  getAllMockAccountUIDs,
  getMockedAccountDetails,
} from '@tests/mocks/enablebanking/data';
import { AED_PER_USD, EUR_PER_USD } from '@tests/mocks/exchange-rates/data';
import { format } from 'date-fns';
import { HttpResponse, http } from 'msw';

import { SyncStatus } from '../sync/sync-status-tracker';

// getExchangeRate pivots through USD and truncates the rate to 5 decimals.
const EUR_TO_AED = Math.trunc((AED_PER_USD / EUR_PER_USD) * 100_000) / 100_000;
const utcDateDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]!;

/**
 * Create a fully-active EnableBanking connection with one linked account.
 * Shared across describe blocks that exercise post-setup state (session
 * expiry, ASPSP errors, malformed-data resilience).
 */
async function setupActiveConnection(): Promise<{
  connectionId: string;
  accountId: string;
}> {
  const connectResult = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });

  const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

  await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: {
      connectionId: connectResult.connectionId,
      code: helpers.enablebanking.mockAuthCode,
      state,
    },
  });

  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId: connectResult.connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    raw: true,
  });

  return {
    connectionId: connectResult.connectionId,
    accountId: syncedAccounts[0]!.id,
  };
}

useSelfHost();

describe('Enable Banking Data Provider E2E', () => {
  // Reset mock session counter before each test to ensure predictable behavior
  // The counter determines whether mock returns original or reconnected account UIDs
  beforeEach(() => {
    helpers.enablebanking.resetSessionCounter();
  });

  // Reset transaction config after each test
  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  describe('Complete connection flow', () => {
    it('should complete the full OAuth flow: list providers -> connect -> OAuth callback -> list connections -> list external accounts -> connect accounts -> get details', async () => {
      // Step 1: Fetch supported providers
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({
        raw: true,
      });

      expect(Array.isArray(providers)).toBe(true);
      expect(providers.length).toBeGreaterThan(0);

      // Verify Enable Banking is in the list
      const enableBankingProvider = providers.find(
        (p: { type: string }) => p.type === BANK_PROVIDER_TYPE.ENABLE_BANKING,
      )!;
      expect(enableBankingProvider).toBeDefined();
      expect(enableBankingProvider.name).toBe('Enable Banking');

      // Step 2: Initiate connection (this creates a pending connection and returns auth URL)
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: 'My Enable Banking Connection',
        raw: true,
      });

      expect(connectResult).toHaveProperty('connectionId');
      expect(connectResult.connectionId).toBeDefined();

      const connectionId = connectResult.connectionId;

      // Step 3: Get connection details to verify it's pending
      const { connection: pendingConnection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(pendingConnection.isActive).toBe(false); // Not active until OAuth completes
      expect(pendingConnection.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);

      // Step 4: Extract state from connection metadata for OAuth callback
      const state = await helpers.enablebanking.getConnectionState(connectionId);
      expect(state).toBeDefined();

      // Step 5: Simulate OAuth callback (user authorized in bank)
      const oauthResult = (await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
        raw: true,
      })) as { success: boolean; connectionId: string };

      expect(oauthResult.connectionId).toBe(connectionId);

      // Step 6: Verify connection is now active
      const { connection: activeConnection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(activeConnection.isActive).toBe(true);
      expect(activeConnection.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);
      expect(activeConnection.providerName).toBe('My Enable Banking Connection');

      // Step 7: List external accounts
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

      // Step 8: Connect selected accounts
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

      // Step 9: Fetch final connection details
      const { connection: connectionDetails } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(connectionDetails.id).toBe(connectionId);
      expect(connectionDetails.isActive).toBe(true);

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
    });
  });

  // "XXX" (ISO no-currency) means the bank omitted the account currency: the
  // user must pick one explicitly during connect. Other ISO non-currency codes
  // still reject with 400.
  describe('unsupported account currency', () => {
    const connectWithMockedCurrency = async (currency: string, currencyOverrides?: Record<string, string>) => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });
      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Force every fetched account's currency while preserving its stable
      // identification_hash, so the selected account routes that currency into
      // the connect path.
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/details', ({ params }) =>
          HttpResponse.json({ ...getMockedAccountDetails(params.accountId as string), currency }),
        ),
      );

      const result = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        currencyOverrides,
      });
      return { connectionId: connectResult.connectionId, result };
    };

    it('treats an empty bank-reported currency as "XXX" and requires an explicit choice', async () => {
      const { result } = await connectWithMockedCurrency('');
      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('rejects "XXX" (no currency) without an explicit currency choice, creating nothing', async () => {
      const { connectionId, result } = await connectWithMockedCurrency('XXX');
      expect(result.status).toEqual(ERROR_CODES.ValidationError);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connection.accounts.length).toBe(0);
    });

    it('connects a "XXX" (no currency) account with the user-chosen currency', async () => {
      const { connectionId, result } = await connectWithMockedCurrency('XXX', {
        [MOCK_IDENTIFICATION_HASH_1]: 'EUR',
      });
      expect(result.status).toEqual(200);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connection.accounts.length).toBe(1);
      expect(connection.accounts[0]!.currencyCode).toBe('EUR');
      expect(connection.accounts[0]!.currencyFallback).toEqual({
        providerCurrency: 'XXX',
        assignedCurrency: 'EUR',
      });
    });

    it('rejects an account whose currency is another ISO non-currency (XAU) with a 400, creating nothing', async () => {
      const { connectionId, result } = await connectWithMockedCurrency('XAU');
      expect(result.status).toEqual(ERROR_CODES.BadRequest);

      // The account-creation transaction rolled back, so nothing is linked.
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connection.accounts.length).toBe(0);
    });
  });

  describe('Step 1: List supported providers', () => {
    it('should include Enable Banking in providers list', async () => {
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({
        raw: true,
      });

      const enableBankingProvider = providers.find(
        (p: { type: string }) => p.type === BANK_PROVIDER_TYPE.ENABLE_BANKING,
      );
      expect(enableBankingProvider).toBeDefined();
      expect(enableBankingProvider?.name).toBe('Enable Banking');
      expect(enableBankingProvider?.description).toContain('6000+');
    });
  });

  describe('Step 2: Initiate connection', () => {
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
          credentials: helpers.enablebanking.mockCredentials(),
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should successfully create pending connection with valid credentials', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      expect(result).toHaveProperty('connectionId');
      expect(result.connectionId).toBeDefined();

      // Verify connection is pending (not active)
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: result.connectionId,
        raw: true,
      });

      expect(connection.isActive).toBe(false);
    });

    it('should fail with invalid credentials', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.ENABLE_BANKING}/connect`,
        payload: {
          credentials: {
            appId: INVALID_ENABLE_BANKING_APP_ID,
            privateKey: INVALID_ENABLE_BANKING_PRIVATE_KEY,
            bankName: MOCK_BANK_NAME,
            bankCountry: MOCK_BANK_COUNTRY,
          },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should accept optional provider name', async () => {
      const customName = 'My Custom Bank Connection';
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: customName,
        raw: true,
      });

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: result.connectionId,
        raw: true,
      });

      expect(connection.providerName).toBe(customName);
    });

    it('should validate required Enable Banking fields', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.ENABLE_BANKING}/connect`,
        payload: {
          credentials: {
            appId: helpers.enablebanking.mockAppId,
            // Missing privateKey, bankName, bankCountry
          },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should store authorization details in connection metadata', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      // Access database model directly to check metadata
      const connection = await BankDataProviderConnections.findByPk(result.connectionId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = connection!.metadata as any;
      expect(metadata.state).toBeDefined();
      expect(metadata.authUrl).toBeDefined();
      expect(metadata.bankName).toBe(MOCK_BANK_NAME);
      expect(metadata.bankCountry).toBe(MOCK_BANK_COUNTRY);
    });

    it('should return user-facing validation error when Enable Banking rejects redirect URI', async () => {
      // Simulate the user not having registered our redirect URL on their
      // Enable Banking app (the cause of MONEY-MATTER-BACKEND-3Q).
      global.mswMockServer.use(
        http.post('https://api.enablebanking.com/auth', () => {
          return HttpResponse.json(
            {
              code: 400,
              error: 'REDIRECT_URI_NOT_ALLOWED',
              message: 'Redirect URI not allowed',
              detail: null,
            },
            { status: 400 },
          );
        }),
      );

      const credentials = helpers.enablebanking.mockCredentials();
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.ENABLE_BANKING}/connect`,
        payload: { credentials },
      });

      // Should NOT be a 5xx/BadGateway (which would crash to Sentry); should be
      // a clear ValidationError that the UI can display verbatim.
      expect(result.status).toEqual(ERROR_CODES.ValidationError);
      // The message must include the URL we sent, so the user knows exactly
      // which URL to add to their Enable Banking app's allowlist.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((result.body as any).response.message).toContain(credentials.redirectUrl);
    });
  });

  describe('Step 3: OAuth callback', () => {
    it('should return validation error for missing parameters', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          // Missing required fields
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should return error for invalid state parameter', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const result = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state: 'invalid-state-12345',
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should successfully activate connection with valid OAuth callback', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      const oauthResult = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
        raw: true,
      });

      expect(oauthResult.connectionId).toBe(connectResult.connectionId);

      // Verify connection is now active
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(connection.isActive).toBe(true);
    });

    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: generateRandomRecordId(),
          code: helpers.enablebanking.mockAuthCode,
          state: 'some-state',
        },
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });
  });

  describe('Step 4: List user connections', () => {
    it('should list Enable Banking connection after OAuth completes', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: 'My Enable Banking',
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      const enableBankingConnection = connections.find((c: { id: string }) => c.id === connectResult.connectionId);
      expect(enableBankingConnection).toBeDefined();
      expect(enableBankingConnection?.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);
      expect(enableBankingConnection?.isActive).toBe(true);
    });

    it('should show accountsCount as 0 for newly connected providers', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectResult.connectionId);

      expect(connection?.accountsCount).toBe(0);
    });

    it('should allow multiple Enable Banking connections', async () => {
      const result1 = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: 'Enable Banking 1',
        raw: true,
      });

      const result2 = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: 'Enable Banking 2',
        raw: true,
      });

      expect(result1.connectionId).not.toBe(result2.connectionId);

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const enableBankingConnections = connections.filter(
        (c: { providerType: string }) => c.providerType === BANK_PROVIDER_TYPE.ENABLE_BANKING,
      );

      expect(enableBankingConnections.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Step 5: List external accounts', () => {
    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: generateRandomRecordId(),
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('should list external accounts from Enable Banking', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const response = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      const { accounts } = response;

      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
    });

    it('should return accounts with correct structure', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
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

    it('should return all mocked accounts', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      const mockAccountUIDs = getAllMockAccountUIDs();
      expect(accounts.length).toBe(mockAccountUIDs.length);
    });

    it('should include account metadata (IBAN, product, etc.)', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      const account = accounts[0]!;
      expect(account.metadata).toBeDefined();
      expect(account.metadata).toHaveProperty('iban');
    });
  });

  describe('Step 6: Connect selected accounts', () => {
    it('should automatically sync transactions when connecting accounts', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const accountIds = [MOCK_IDENTIFICATION_HASH_1];

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      const createdAccountId = syncedAccounts[0]!.id;

      // Verify transactions were automatically synced by checking if any transactions exist for this account
      const transactions = await helpers.getTransactions({
        accountIds: [createdAccountId],
        raw: true,
      });

      // Transactions should have been automatically synced
      // Note: The exact number depends on mock data, but there should be at least some transactions
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions.length).toBeGreaterThan(0);

      // Verify transactions belong to the correct account
      transactions.forEach((tx: { accountId: string }) => {
        expect(tx.accountId).toBe(createdAccountId);
      });
    });

    it('should return 404 for non-existent connection', async () => {
      const result = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: generateRandomRecordId(),
        accountExternalIds: ['account-1'],
      });

      expect(result.status).toEqual(ERROR_CODES.NotFoundError);
    });

    it('should fail with invalid account IDs', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-selected-accounts`,
        payload: {
          accountExternalIds: ['non-existent-id'],
        },
      });

      expect(result.status).toEqual(ERROR_CODES.BadRequest);
    });

    it('should successfully connect valid accounts', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const accountIds = [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2];

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      expect(syncedAccounts.length).toBe(2);
      syncedAccounts.forEach((account) => {
        expect(accountIds).toContain(account.externalId);
      });
    });

    it('should create accounts with correct balances and currency', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      const selectedExternal = externalAccounts[0]!;

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [selectedExternal.externalId],
        raw: true,
      });

      const createdAccount = syncedAccounts[0]!;
      const account = await helpers.getAccount({
        id: createdAccount.id,
        raw: true,
      });

      expect(account.currentBalance).toBe(selectedExternal.balance);
      expect(account.initialBalance).toBe(selectedExternal.balance);
      expect(account.currencyCode).toBe(selectedExternal.currency);
    });

    it('should update connection lastSyncAt after connecting accounts', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { connections: connectionsBefore } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connectionBefore = connectionsBefore.find((c: { id: string }) => c.id === connectResult.connectionId);
      expect(connectionBefore?.lastSyncAt).toBeNull();

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const { connections: connectionsAfter } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connectionAfter = connectionsAfter.find((c: { id: string }) => c.id === connectResult.connectionId);
      expect(connectionAfter?.lastSyncAt).not.toBeNull();
    });

    it('should enable existing disabled accounts when reconnecting', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Connect account first time
      const { syncedAccounts: firstConnect } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
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
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
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
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2],
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === connectResult.connectionId);
      expect(connection?.accountsCount).toBe(2);
    });
  });

  describe('Step 7: Get connection details', () => {
    it('should return connection details with provider metadata', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        providerName: 'Test Connection',
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(details.id).toBe(connectResult.connectionId);
      expect(details.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);
      expect(details.providerName).toBe('Test Connection');
      expect(details.isActive).toBe(true);

      expect(details.provider).toBeDefined();
      expect(details.provider.name).toBe('Enable Banking');
      expect(details.provider.description).toBeDefined();
      expect(details.provider.features).toBeDefined();
    });

    it('should include connected accounts in details', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2],
        raw: true,
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
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
        },
      );
    });

    it('should return empty accounts array when no accounts connected', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { connection: details } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(details.accounts).toEqual([]);
    });
  });

  describe('Connection persistence and state', () => {
    it('should store credentials securely (encrypted)', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: result.connectionId,
        raw: true,
      });

      expect(connection).toBeDefined();
      expect(connection.id).toBe(result.connectionId);
      expect(connection.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);
      expect(connection.isActive).toBe(false); // Pending until OAuth
    });

    it('should create connection with correct initial state', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);

      expect(connection).toBeDefined();
      expect(connection?.isActive).toBe(false); // Not active until OAuth
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.ENABLE_BANKING);
      expect(connection?.lastSyncAt).toBeNull();
      expect(connection?.createdAt).toBeDefined();
      expect(connection?.accountsCount).toBe(0);
    });

    it('should transition from pending to active after OAuth', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      // Verify pending state
      const { connection: pendingConn } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });
      expect(pendingConn.isActive).toBe(false);

      // Complete OAuth
      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Verify active state
      const { connection: activeConn } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });
      expect(activeConn.isActive).toBe(true);
    });
  });

  describe('Reauthorization flow', () => {
    it('should allow reauthorization of an existing connection', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Reauthorize
      const reauthorizeResult = (await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
        raw: true,
      })) as { authUrl: string; message: string };

      expect(reauthorizeResult.authUrl).toBeDefined();
      expect(reauthorizeResult.authUrl).toContain('https://');

      // Connection should be inactive again
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(connection.isActive).toBe(false);
    });

    it('should complete reauthorization flow', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      let state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Reauthorize
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
      });

      // Complete OAuth again with new state
      state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      // Connection should be active again
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(connection.isActive).toBe(true);
    });

    it('should succeed when upstream deleteSession reports CLOSED_SESSION', async () => {
      // Reauthorize calls DELETE /sessions/:id on the old session before
      // starting a new OAuth flow. If the session is already gone (user
      // disconnected from the bank's side, natural expiry, etc.), Enable
      // Banking responds with HTTP 400 + `error: "CLOSED_SESSION"`. That's
      // the same end-state we wanted, so reauthorize must keep going rather
      // than fail the request and noise up Sentry.
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      global.mswMockServer.use(
        http.delete('https://api.enablebanking.com/sessions/:sessionId', () => {
          return new HttpResponse(
            JSON.stringify({
              code: 400,
              message: 'Session is closed',
              error: 'CLOSED_SESSION',
              detail: null,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }),
      );

      const reauthorizeResult = (await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
        raw: true,
      })) as { authUrl: string };

      expect(reauthorizeResult.authUrl).toBeDefined();
      expect(reauthorizeResult.authUrl).toContain('https://');

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });
      expect(connection.isActive).toBe(false);
    });
  });

  describe('Reauthorization with stable externalId', () => {
    it('should maintain stable externalId after reconnection (identification_hash is stable)', async () => {
      // Step 1: Create initial connection and connect accounts
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      let state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      // Complete initial OAuth
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Connect accounts
      const { syncedAccounts: initialAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2],
        raw: true,
      });

      // Verify initial externalIds (based on identification_hash, stable across sessions)
      expect(initialAccounts.length).toBe(2);
      const account1Id = initialAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_1)?.id;
      const account2Id = initialAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_2)?.id;
      expect(account1Id).toBeDefined();
      expect(account2Id).toBeDefined();

      // Verify accounts have externalIds based on identification_hash
      const account1Before = await helpers.getAccount({
        id: account1Id!,
        raw: true,
      });
      const account2Before = await helpers.getAccount({
        id: account2Id!,
        raw: true,
      });
      expect(account1Before.externalId).toBe(MOCK_IDENTIFICATION_HASH_1);
      expect(account2Before.externalId).toBe(MOCK_IDENTIFICATION_HASH_2);

      // Step 2: Reauthorize connection
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
      });

      // Step 3: Complete OAuth again (mock returns different UIDs but same identification_hash)
      state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      // Step 4: Verify externalIds remain STABLE (identification_hash doesn't change)
      const account1After = await helpers.getAccount({
        id: account1Id!,
        raw: true,
      });
      const account2After = await helpers.getAccount({
        id: account2Id!,
        raw: true,
      });

      // externalId should be the same since identification_hash is stable across sessions
      expect(account1After.externalId).toBe(MOCK_IDENTIFICATION_HASH_1);
      expect(account2After.externalId).toBe(MOCK_IDENTIFICATION_HASH_2);

      // The account IDs should remain the same (same database records)
      expect(account1After.id).toBe(account1Id);
      expect(account2After.id).toBe(account2Id);

      // Step 5: Verify that listing external accounts returns same identification_hash values
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      const expectedHashes = [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2];
      // Filter to only the accounts we connected
      const connectedAccounts = externalAccounts.filter((acc: { externalId: string }) =>
        expectedHashes.includes(acc.externalId),
      );
      expect(connectedAccounts.length).toBe(2);

      // Step 6: Verify connection details show correct accounts
      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId: connectResult.connectionId,
        raw: true,
      });

      expect(connection.isActive).toBe(true);
      expect(connection.accounts.length).toBe(2);

      // Accounts in connection should have stable externalIds
      const connAccount1 = connection.accounts.find((a: { id: string }) => a.id === account1Id);
      const connAccount2 = connection.accounts.find((a: { id: string }) => a.id === account2Id);
      expect(connAccount1?.externalId).toBe(MOCK_IDENTIFICATION_HASH_1);
      expect(connAccount2?.externalId).toBe(MOCK_IDENTIFICATION_HASH_2);
    });

    it('should allow transaction sync after reconnection (externalId stable)', async () => {
      // Create connection and connect an account
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      let state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Connect one account
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Get transaction count before reconnection
      const transactionsBefore = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      const txCountBefore = transactionsBefore.length;

      // Reauthorize
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
      });

      // Complete OAuth with new session
      state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      // Verify account externalId remains stable (identification_hash doesn't change)
      const accountAfterReconnect = await helpers.getAccount({
        id: accountId,
        raw: true,
      });
      expect(accountAfterReconnect.externalId).toBe(MOCK_IDENTIFICATION_HASH_1);

      // Trigger transaction sync - this should work with stable externalId
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      // Verify transactions were synced (count should be same or more)
      const transactionsAfter = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });

      // Should have at least as many transactions as before (sync doesn't duplicate)
      expect(transactionsAfter.length).toBeGreaterThanOrEqual(txCountBefore);
    });

    it('should preserve all account data after reconnection (including stable externalId)', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      let state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;
      const accountBefore = await helpers.getAccount({
        id: accountId,
        raw: true,
      });

      // Reauthorize and complete OAuth
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
      });

      state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      const accountAfter = await helpers.getAccount({
        id: accountId,
        raw: true,
      });

      // All data should be preserved including externalId (based on stable identification_hash)
      expect(accountAfter.id).toBe(accountBefore.id);
      expect(accountAfter.name).toBe(accountBefore.name);
      expect(accountAfter.currencyCode).toBe(accountBefore.currencyCode);
      expect(accountAfter.currentBalance).toBe(accountBefore.currentBalance);
      expect(accountAfter.initialBalance).toBe(accountBefore.initialBalance);
      expect(accountAfter.externalId).toBe(accountBefore.externalId);
      expect(accountAfter.externalId).toBe(MOCK_IDENTIFICATION_HASH_1);
    });
  });

  describe('Balance history tracking', () => {
    it('should create balance record when account is first connected', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Connect an account
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Get balance history for this account
      const balanceHistory = await helpers.getBalanceHistory({ raw: true });

      // Should have at least one balance record for this account
      const accountBalances = balanceHistory.filter((b: { accountId: string }) => b.accountId === accountId);
      expect(accountBalances.length).toBeGreaterThanOrEqual(1);
    });

    it('should update balance history when transactions are synced', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Get balance history count after account connection
      const balanceHistoryBefore = await helpers.getBalanceHistory({
        raw: true,
      });
      const accountBalancesBefore = balanceHistoryBefore.filter(
        (b: { accountId: string }) => b.accountId === accountId,
      );
      const balanceCountBefore = accountBalancesBefore.length;

      // Sync transactions
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      // Verify transactions were synced
      const transactions = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      expect(transactions.length).toBeGreaterThan(0);

      // Get balance history count after transaction sync
      const balanceHistoryAfter = await helpers.getBalanceHistory({
        raw: true,
      });
      const accountBalancesAfter = balanceHistoryAfter.filter((b: { accountId: string }) => b.accountId === accountId);

      // Balance history SHOULD be maintained after transaction sync
      // On the same day, the existing record is updated (not a new one created)
      // The count stays the same but the balance amount reflects the bank's current balance
      expect(accountBalancesAfter.length).toBeGreaterThanOrEqual(balanceCountBefore);
      expect(accountBalancesAfter.length).toBeGreaterThanOrEqual(1);
    });

    it('should update balance history when account is refreshed/resynced', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      let state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Get balance history after initial connection
      const balanceHistoryBefore = await helpers.getBalanceHistory({
        raw: true,
      });
      const accountBalancesBefore = balanceHistoryBefore.filter(
        (b: { accountId: string }) => b.accountId === accountId,
      );
      const balanceCountBefore = accountBalancesBefore.length;

      // Reauthorize and complete OAuth (simulating account refresh)
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/reauthorize`,
      });

      state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      // Trigger a sync to update balance from bank after reauthorization
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      // Get balance history after reauthorization and sync
      const balanceHistoryAfter = await helpers.getBalanceHistory({
        raw: true,
      });
      const accountBalancesAfter = balanceHistoryAfter.filter((b: { accountId: string }) => b.accountId === accountId);

      // Balance history SHOULD be maintained after refresh/resync
      // On the same day, the existing record is updated (not a new one created)
      expect(accountBalancesAfter.length).toBeGreaterThanOrEqual(balanceCountBefore);
      expect(accountBalancesAfter.length).toBeGreaterThanOrEqual(1);
    });

    describe('closing balance of a booking day', () => {
      // Relative so the fixtures never straddle a month or year boundary.
      const utcDaysAgo = (days: number) => {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days))
          .toISOString()
          .slice(0, 10);
      };

      const BOOKING_DATE = utcDaysAgo(20);

      const CLOSING_BALANCE_EUR = -50;

      // One bank day, settled as four rows the ASPSP displays on four earlier
      // dates. The ladder runs 5000.00 → 4000.00 → 2000.00 → 2500.00 → -50.00.
      //
      // The display dates are chosen so the closing row is neither the first nor
      // the last of the day in display order, and so ladder order and display
      // order disagree throughout: picking the earliest row, the latest row, or
      // whatever the database happens to return first all give a wrong answer.
      // The +500.00 credit makes an inverted income sign break the chain rather
      // than pass quietly.
      const ladderTransactions: FixedTransaction[] = [
        {
          entryReference: 'ladder_closing',
          amount: '2550.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: BOOKING_DATE,
          transactionDate: utcDaysAgo(22),
          balanceAfter: '-50.00',
        },
        {
          entryReference: 'ladder_credit',
          amount: '500.00',
          currency: 'EUR',
          isExpense: false,
          bookingDate: BOOKING_DATE,
          transactionDate: utcDaysAgo(21),
          balanceAfter: '2500.00',
        },
        {
          entryReference: 'ladder_middle',
          amount: '2000.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: BOOKING_DATE,
          transactionDate: utcDaysAgo(23),
          balanceAfter: '2000.00',
        },
        {
          entryReference: 'ladder_opening',
          amount: '1000.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: BOOKING_DATE,
          transactionDate: utcDaysAgo(24),
          balanceAfter: '4000.00',
        },
      ];

      // `date` is typed as a Date but the endpoint serializes it as 'yyyy-MM-dd'.
      const bookingDayCents = ({ balances }: { balances: { date: Date | string; amount: number }[] }) => {
        const row = balances.find((balance) => String(balance.date) === BOOKING_DATE);
        return row ? Math.round(row.amount * 100) : null;
      };

      const connectAccountWithLadder = async ({
        transactions = ladderTransactions,
      }: { transactions?: FixedTransaction[] } = {}) => {
        helpers.enablebanking.setFixedTransactions(transactions);

        const connectResult = await helpers.bankDataProviders.connectProvider({
          providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
          credentials: helpers.enablebanking.mockCredentials(),
          raw: true,
        });

        const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

        await helpers.makeRequest({
          method: 'post',
          url: '/bank-data-providers/enablebanking/oauth-callback',
          payload: { connectionId: connectResult.connectionId, code: helpers.enablebanking.mockAuthCode, state },
        });

        const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
          connectionId: connectResult.connectionId,
          accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
          raw: true,
        });

        const accountId = syncedAccounts[0]!.id;

        return {
          accountId,
          connectionId: connectResult.connectionId,
          ...(await readLadderState({ accountId })),
        };
      };

      const readLadderState = async ({ accountId }: { accountId: string }) => {
        const balanceHistory = await helpers.getBalanceHistory({
          from: utcDaysAgo(30),
          to: utcDaysAgo(10),
          raw: true,
        });
        const storedTransactions = await helpers.getTransactions({ accountIds: [accountId], raw: true });

        return {
          balances: balanceHistory.filter((balance) => balance.accountId === accountId),
          storedTransactions,
        };
      };

      it('files the whole ladder on the booking date, not on each display date', async () => {
        const { balances, storedTransactions } = await connectAccountWithLadder();

        expect(storedTransactions).toHaveLength(4);
        expect(balances.map((balance) => balance.date)).toEqual([BOOKING_DATE]);
      });

      it('stores the balance of the row that closes the day, converted to base currency', async () => {
        const { balances } = await connectAccountWithLadder();

        // Pinned to the value, not the sign: every other row of the day converts to
        // a different figure, and so does an unconverted, inverted or cents-scaled
        // reading of the right one.
        expect(bookingDayCents({ balances })).toEqualRefValue(CLOSING_BALANCE_EUR * EUR_TO_AED * 100);
      });

      it('leaves the day blank when its ladder does not resolve', async () => {
        // Two rows on the same balance: the day cannot be walked, and a day whose
        // close is unknown is left for the chart to carry forward rather than
        // filled with whichever row happened to be written last.
        const { balances, storedTransactions } = await connectAccountWithLadder({
          transactions: [
            { ...ladderTransactions[0]!, entryReference: 'tie_a', balanceAfter: '4000.00', amount: '1000.00' },
            { ...ladderTransactions[1]!, entryReference: 'tie_b', balanceAfter: '4000.00', amount: '1000.00' },
          ],
        });

        // Both rows landed, so a blank day is a refusal to guess rather than a sync
        // that stored nothing.
        expect(storedTransactions).toHaveLength(2);
        expect(bookingDayCents({ balances })).toBeNull();
      });

      it('leaves the day blank when a booked row carries no balance at all', async () => {
        // The remaining rows still chain, but a rung is missing, so what looks like
        // the day's close may be a mid-day row.
        const { balances, storedTransactions } = await connectAccountWithLadder({
          transactions: [
            ...ladderTransactions,
            {
              entryReference: 'ladder_unstamped',
              amount: '30.00',
              currency: 'EUR',
              isExpense: true,
              bookingDate: BOOKING_DATE,
              transactionDate: utcDaysAgo(22),
              balanceAfter: null,
            },
          ],
        });

        expect(storedTransactions).toHaveLength(5);
        expect(bookingDayCents({ balances })).toBeNull();
      });

      it('ignores a pending row, whose balance is available rather than booked', async () => {
        await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
        const { balances, storedTransactions } = await connectAccountWithLadder({
          transactions: [
            ...ladderTransactions,
            {
              entryReference: 'ladder_pending',
              amount: '900.00',
              currency: 'EUR',
              isExpense: true,
              bookingDate: BOOKING_DATE,
              transactionDate: utcDaysAgo(20),
              balanceAfter: '9999.00',
              status: 'PDNG',
            },
          ],
        });

        // The pending row is stored; it just has no say in the booked ladder. Were
        // it counted, the day would gain a second candidate and resolve to nothing.
        expect(storedTransactions).toHaveLength(5);
        expect(bookingDayCents({ balances })).toEqualRefValue(CLOSING_BALANCE_EUR * EUR_TO_AED * 100);
      });

      it('resolves a booking day whose rows arrive across two syncs', async () => {
        // The pass reads each day back from storage rather than from the batch, so
        // a day that was incomplete on the first sync settles on the second.
        const { accountId, connectionId } = await connectAccountWithLadder({
          transactions: ladderTransactions.slice(2),
        });

        helpers.enablebanking.setFixedTransactions(ladderTransactions);

        await helpers.makeRequest({
          method: 'post',
          url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
          payload: { accountId },
          raw: true,
        });

        const { balances, storedTransactions } = await readLadderState({ accountId });

        expect(storedTransactions).toHaveLength(4);
        expect(bookingDayCents({ balances })).toEqualRefValue(CLOSING_BALANCE_EUR * EUR_TO_AED * 100);
      });
    });
  });

  describe('Transaction update on re-sync', () => {
    it('should update existing transaction when booking_date appears', async () => {
      // This test verifies that when a transaction is synced initially without booking_date
      // (e.g., only value_date), and then re-synced with booking_date added,
      // the existing transaction is UPDATED with the new data.

      // Step 1: Set up fixed transactions WITHOUT booking_date (simulating initial sync)
      const entryRef = 'test_entry_ref_12345';
      const valueDate = '2024-01-16';
      const bookingDate = '2024-01-17'; // Appears later when bank finalizes the transaction

      const initialTransactions: FixedTransaction[] = [
        {
          entryReference: entryRef,
          amount: '100.00',
          currency: 'EUR',
          isExpense: true,
          valueDate: valueDate,
          // No bookingDate - simulating pending/unfinalized transaction
        },
      ];

      helpers.enablebanking.setFixedTransactions(initialTransactions);

      // Step 2: Create connection and connect account
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      // Connect account (this triggers initial sync)
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Step 3: Verify initial transaction was created
      const transactionsAfterFirstSync = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });

      expect(transactionsAfterFirstSync.length).toBe(1);
      const initialTx = transactionsAfterFirstSync[0]!;

      // Verify initial transaction uses value_date (since no booking_date was provided)
      const initialTxDate = new Date(initialTx.time).toISOString().split('T')[0];
      expect(initialTxDate).toBe(valueDate);

      // Verify externalData has only value_date, no booking_date — externalData isn't
      // exposed via the API, so read it directly from the DB.
      const initialTxRow = await Transactions.findByPk(initialTx.id, { raw: true });
      const initialExternalData = initialTxRow!.externalData as { valueDate?: string; bookingDate?: string } | null;
      expect(initialExternalData?.valueDate).toBe(valueDate);
      expect(initialExternalData?.bookingDate).toBeUndefined();

      // Step 4: Update mock to return same transaction with booking_date added
      const updatedTransactions: FixedTransaction[] = [
        {
          entryReference: entryRef, // Same entry reference = same transaction
          amount: '100.00',
          currency: 'EUR',
          isExpense: true,
          valueDate: valueDate,
          bookingDate: bookingDate, // Now includes booking_date (transaction finalized)
        },
      ];

      helpers.enablebanking.setFixedTransactions(updatedTransactions);

      // Step 5: Trigger re-sync
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      // Step 6: Verify transaction was updated, not duplicated
      const transactionsAfterSecondSync = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });

      // Should still be only 1 transaction (updated, not duplicated)
      expect(transactionsAfterSecondSync.length).toBe(1);

      const updatedTx = transactionsAfterSecondSync[0]!;

      // Verify it's the same transaction (same ID)
      expect(updatedTx.id).toBe(initialTx.id);

      // Verify externalData now has both dates — read from the DB (not exposed via API).
      const updatedTxRow = await Transactions.findByPk(updatedTx.id, { raw: true });
      const updatedExternalData = updatedTxRow!.externalData as { valueDate?: string; bookingDate?: string } | null;
      expect(updatedExternalData?.valueDate).toBe(valueDate);
      expect(updatedExternalData?.bookingDate).toBe(bookingDate);
    });

    it('should not create duplicates when syncing transactions with same entry_reference', async () => {
      // This test verifies that transactions with the same entry_reference
      // are correctly identified as duplicates and updated rather than created anew.

      const entryRef = 'unique_entry_ref_abc123';

      const transactions: FixedTransaction[] = [
        {
          entryReference: entryRef,
          amount: '50.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-01-20',
          transactionDate: '2024-01-18',
        },
      ];

      helpers.enablebanking.setFixedTransactions(transactions);

      // Create connection and connect account
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);

      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: connectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // First sync
      const txAfterFirstSync = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      expect(txAfterFirstSync.length).toBe(1);

      // Second sync (same transaction data)
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      // Verify no duplicates
      const txAfterSecondSync = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      expect(txAfterSecondSync.length).toBe(1);

      // Third sync (just to be sure)
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectResult.connectionId}/sync-transactions`,
        payload: {
          accountId,
        },
        raw: true,
      });

      const txAfterThirdSync = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      expect(txAfterThirdSync.length).toBe(1);
    });
  });

  describe('403 session expiry handling', () => {
    it('should mark connection as inactive when transactions API returns 403', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      // Verify connection is active before sync
      const { connection: connectionBefore } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connectionBefore.isActive).toBe(true);

      // Override transactions endpoint to return 403 (session expired)
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
        }),
      );

      // Trigger sync — it will fail with ForbiddenError
      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.Forbidden);

      // Connection must be marked inactive
      const { connection: connectionAfter } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connectionAfter.isActive).toBe(false);
    });

    it('should set consentValidUntil to approximately current time when 403 occurs', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      // Verify consentValidUntil is a future date before sync
      const connectionBefore = await BankDataProviderConnections.findByPk(connectionId);
      const metadataBefore = connectionBefore!.metadata as {
        consentValidUntil: string;
      };
      expect(new Date(metadataBefore.consentValidUntil).getTime()).toBeGreaterThan(Date.now());

      const syncStartedAt = new Date();

      // Override transactions endpoint to return 403
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
        }),
      );

      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      // Verify consentValidUntil is now set to approximately the current time
      const connectionAfter = await BankDataProviderConnections.findByPk(connectionId);
      const metadataAfter = connectionAfter!.metadata as {
        consentValidUntil: string;
      };
      expect(metadataAfter.consentValidUntil).toBeDefined();

      const consentValidUntil = new Date(metadataAfter.consentValidUntil);
      // Should be at or after sync start, and not more than 500ms in the future
      expect(consentValidUntil.getTime()).toBeGreaterThanOrEqual(syncStartedAt.getTime() - 1000);
      expect(consentValidUntil.getTime()).toBeLessThanOrEqual(Date.now() + 500);
    });

    it('should mark connection as inactive when balance API returns 403', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      const syncStartedAt = new Date();

      // Override balances endpoint to return 403 (transactions succeed, balance fails)
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/balances', () => {
          return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.Forbidden);

      const { connection: connectionAfter } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connectionAfter.isActive).toBe(false);

      // Verify consentValidUntil is reset to approximately current time (not a future consent date)
      const connection = await BankDataProviderConnections.findByPk(connectionId);
      const metadata = connection!.metadata as { consentValidUntil: string };
      const consentValidUntil = new Date(metadata.consentValidUntil);
      expect(consentValidUntil.getTime()).toBeGreaterThanOrEqual(syncStartedAt.getTime() - 1000);
      expect(consentValidUntil.getTime()).toBeLessThanOrEqual(Date.now() + 500);
    });

    it('should not mark connection as inactive for non-403 errors', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      // Override transactions endpoint to return 500 (server error, not session expiry)
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(JSON.stringify({ message: 'Internal Server Error' }), { status: 500 });
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      // Sync should fail with bad gateway (external provider error, not a session expiry)
      expect(syncResult.status).toEqual(ERROR_CODES.BadGateway);

      // But connection should remain active (500 is not a session expiry)
      const { connection: connectionAfter } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });
      expect(connectionAfter.isActive).toBe(true);
    });

    describe('fetchAccounts (listExternalAccounts endpoint)', () => {
      it('should mark connection as inactive when session endpoint returns 403', async () => {
        const { connectionId } = await setupActiveConnection();

        global.mswMockServer.use(
          http.get('https://api.enablebanking.com/sessions/:sessionId', () => {
            return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
          }),
        );

        const result = await helpers.bankDataProviders.listExternalAccounts({
          connectionId,
        });

        expect(result.status).toEqual(ERROR_CODES.Forbidden);

        const { connection } = await helpers.bankDataProviders.getConnectionDetails({
          connectionId,
          raw: true,
        });
        expect(connection.isActive).toBe(false);
      });

      it('should mark connection as inactive when account details endpoint returns 403', async () => {
        const { connectionId } = await setupActiveConnection();

        global.mswMockServer.use(
          http.get('https://api.enablebanking.com/accounts/:accountId/details', () => {
            return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
          }),
        );

        const result = await helpers.bankDataProviders.listExternalAccounts({
          connectionId,
        });

        expect(result.status).toEqual(ERROR_CODES.Forbidden);

        const { connection } = await helpers.bankDataProviders.getConnectionDetails({
          connectionId,
          raw: true,
        });
        expect(connection.isActive).toBe(false);
      });

      it('should set consentValidUntil to current time when fetchAccounts gets 403', async () => {
        const { connectionId } = await setupActiveConnection();

        const syncStartedAt = new Date();

        global.mswMockServer.use(
          http.get('https://api.enablebanking.com/sessions/:sessionId', () => {
            return new HttpResponse(JSON.stringify({ message: 'Session expired' }), { status: 403 });
          }),
        );

        await helpers.bankDataProviders.listExternalAccounts({ connectionId });

        const connection = await BankDataProviderConnections.findByPk(connectionId);
        const metadata = connection!.metadata as {
          consentValidUntil: string;
        };
        const consentValidUntil = new Date(metadata.consentValidUntil);

        expect(consentValidUntil.getTime()).toBeGreaterThanOrEqual(syncStartedAt.getTime() - 1000);
        expect(consentValidUntil.getTime()).toBeLessThanOrEqual(Date.now() + 500);
      });

      it('should not mark connection as inactive for non-403 errors in fetchAccounts', async () => {
        const { connectionId } = await setupActiveConnection();

        global.mswMockServer.use(
          http.get('https://api.enablebanking.com/sessions/:sessionId', () => {
            return new HttpResponse(JSON.stringify({ message: 'Internal Server Error' }), { status: 500 });
          }),
        );

        const result = await helpers.bankDataProviders.listExternalAccounts({
          connectionId,
        });

        expect(result.status).toEqual(ERROR_CODES.BadGateway);

        const { connection } = await helpers.bankDataProviders.getConnectionDetails({
          connectionId,
          raw: true,
        });
        expect(connection.isActive).toBe(true);
      });
    });
  });

  describe('getConnectionDetails resilience to malformed stored data', () => {
    it('should not crash when an account has a null currentBalance (legacy/historical rows)', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      // Simulate a historical row where currentBalance is NULL. The live schema
      // is NOT NULL, so relax the constraint for this test and restore it
      // afterwards to avoid polluting sibling tests in the same worker.
      await dbConnection.sequelize.query(`ALTER TABLE "Accounts" ALTER COLUMN "currentBalance" DROP NOT NULL`);
      try {
        await dbConnection.sequelize.query(`UPDATE "Accounts" SET "currentBalance" = NULL WHERE id = :accountId`, {
          replacements: { accountId },
        });

        const response = await helpers.bankDataProviders.getConnectionDetails({
          connectionId,
        });
        expect(response.statusCode).toBe(200);

        const { connection } = await helpers.bankDataProviders.getConnectionDetails({
          connectionId,
          raw: true,
        });

        const account = connection.accounts.find((acc) => acc.id === accountId)!;
        expect(account).toBeDefined();
        expect(account.currentBalance).toBe(0);
      } finally {
        await dbConnection.sequelize.query(`UPDATE "Accounts" SET "currentBalance" = 0 WHERE "currentBalance" IS NULL`);
        await dbConnection.sequelize.query(`ALTER TABLE "Accounts" ALTER COLUMN "currentBalance" SET NOT NULL`);
      }
    });

    it('should not crash when consentValidUntil is an unparseable date string', async () => {
      const { connectionId } = await setupActiveConnection();

      const dbRow = await BankDataProviderConnections.findByPk(connectionId);
      const existingMetadata = (dbRow!.metadata as Record<string, unknown>) || {};
      await BankDataProviderConnections.update(
        {
          metadata: {
            ...existingMetadata,
            consentValidUntil: 'not-a-date',
            consentValidFrom: 'also-bad',
          },
        },
        { where: { id: connectionId } },
      );

      const response = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
      });
      expect(response.statusCode).toBe(200);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(connection.consent).toBeDefined();
      expect(connection.consent!.validUntil).toBeNull();
      expect(connection.consent!.validFrom).toBeNull();
      expect(connection.consent!.daysRemaining).toBeNull();
      expect(connection.consent!.isExpired).toBe(false);
      expect(connection.consent!.isExpiringSoon).toBe(false);
    });
  });

  describe('Provider outage vs. invalid credentials', () => {
    const APPLICATION_URL = 'https://api.enablebanking.com/application';

    it('connect: should surface a provider 5xx as 502 BadGateway, not as invalid credentials', async () => {
      global.mswMockServer.use(
        http.get(APPLICATION_URL, () => {
          return new HttpResponse(null, {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.ENABLE_BANKING}/connect`,
        payload: {
          credentials: helpers.enablebanking.mockCredentials(),
        },
      });

      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toEqual(ERROR_CODES.BadGateway);
    });

    it('refreshCredentials: should surface a provider 5xx as 502 BadGateway, not as invalid credentials', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });

      global.mswMockServer.use(
        http.get(APPLICATION_URL, () => {
          return new HttpResponse(null, {
            status: 500,
            statusText: 'Internal Server Error',
          });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectResult.connectionId}`,
        payload: {
          credentials: helpers.enablebanking.mockCredentials(),
        },
      });

      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toEqual(ERROR_CODES.BadGateway);
    });
  });

  describe('ASPSP_ERROR auth-failure classification', () => {
    it('promotes wrapped-400 ASPSP_ERROR with nested 403 to ForbiddenError + deactivates with auth_failure marker', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(
            JSON.stringify({
              error: 'ASPSP_ERROR',
              message: 'Error interacting with ASPSP',
              detail: {
                message: 'Upstream session rejected',
                error_data: { code: '403 FORBIDDEN' },
              },
            }),
            { status: 400 },
          );
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.Forbidden);

      const connection = await BankDataProviderConnections.findByPk(connectionId);
      const metadata = connection!.metadata as { deactivationReason?: string };
      expect(connection!.isActive).toBe(false);
      expect(metadata.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);

      // And the connection now appears in connectionsNeedingReauth
      const status = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });
      expect(status.body.response.connectionsNeedingReauth).toEqual(
        expect.arrayContaining([expect.objectContaining({ connectionId })]),
      );
    });

    it('promotes a top-level 400 consent-status refusal to ForbiddenError + deactivates with auth_failure marker', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(
            JSON.stringify({
              code: 400,
              error: 'WRONG_SESSION_STATUS',
              message: 'The consent status does not allow the requested access.',
              detail: null,
            }),
            { status: 400 },
          );
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.Forbidden);

      const connection = await BankDataProviderConnections.findByPk(connectionId);
      const metadata = connection!.metadata as { deactivationReason?: string };
      expect(connection!.isActive).toBe(false);
      expect(metadata.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);

      const status = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });
      expect(status.body.response.connectionsNeedingReauth).toEqual(
        expect.arrayContaining([expect.objectContaining({ connectionId })]),
      );
    });

    it('promotes wrapped-400 with auth keyword in wrapper message only (no nested error_data)', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(
            JSON.stringify({
              error: 'ASPSP_ERROR',
              message: 'Error interacting with ASPSP',
              detail: {
                message: 'Forbidden, authenticated but access to resource is not allowed',
              },
            }),
            { status: 400 },
          );
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.Forbidden);

      const connection = await BankDataProviderConnections.findByPk(connectionId);
      const metadata = connection!.metadata as { deactivationReason?: string };
      expect(connection!.isActive).toBe(false);
      expect(metadata.deactivationReason).toBe(DEACTIVATION_REASON.AUTH_FAILURE);
    });

    it('does NOT deactivate connection for generic ASPSP_ERROR without auth signal', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(
            JSON.stringify({
              error: 'ASPSP_ERROR',
              message: 'Error interacting with ASPSP',
              detail: {
                message: 'Invalid IBAN format',
                error_data: { code: '400 BAD REQUEST' },
              },
            }),
            { status: 400 },
          );
        }),
      );

      const syncResult = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      expect(syncResult.status).toEqual(ERROR_CODES.BadRequest);

      const connection = await BankDataProviderConnections.findByPk(connectionId);
      const metadata = connection!.metadata as { deactivationReason?: string | null };
      expect(connection!.isActive).toBe(true);
      // OAuth callback clears the field to null on success; the contract is
      // "not set to AUTH_FAILURE", not "field absent".
      expect(metadata.deactivationReason ?? null).toBeNull();
    });

    it('successful OAuth reconnect clears deactivationReason and removes connection from reauth list', async () => {
      const { connectionId, accountId } = await setupActiveConnection();

      // Trigger an auth failure via wrapped 400 to deactivate the connection
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/transactions', () => {
          return new HttpResponse(
            JSON.stringify({
              error: 'ASPSP_ERROR',
              detail: {
                message: 'Session expired',
                error_data: { code: '403 FORBIDDEN' },
              },
            }),
            { status: 400 },
          );
        }),
      );

      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
      });

      const inactive = await BankDataProviderConnections.findByPk(connectionId);
      expect(inactive!.isActive).toBe(false);
      expect((inactive!.metadata as { deactivationReason?: string }).deactivationReason).toBe(
        DEACTIVATION_REASON.AUTH_FAILURE,
      );

      // Reauthorize → returns a new auth URL and keeps connection inactive until OAuth completes
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/reauthorize`,
      });

      // The bank accepts the fresh session, so the sync queued by the callback succeeds.
      global.mswMockServer.resetHandlers();

      // Complete OAuth callback with fresh state
      const newState = await helpers.enablebanking.getConnectionState(connectionId);
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state: newState,
        },
      });

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();
      const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
      expect(accounts.find((a) => a.accountId === accountId)?.status).toBe(SyncStatus.COMPLETED);

      const reactivated = await BankDataProviderConnections.findByPk(connectionId);
      expect(reactivated!.isActive).toBe(true);
      const reactivatedMetadata = reactivated!.metadata as {
        deactivationReason?: string | null;
        consecutiveAuthFailures?: number;
      };
      expect(reactivatedMetadata.deactivationReason).toBeNull();
      expect(reactivatedMetadata.consecutiveAuthFailures).toBe(0);

      // And the connection no longer appears in connectionsNeedingReauth
      const status = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });
      expect(
        status.body.response.connectionsNeedingReauth.some(
          (c: { connectionId: string }) => c.connectionId === connectionId,
        ),
      ).toBe(false);
    });
  });

  describe('Merchant name direction', () => {
    it('stores the counterparty as merchant, not the account owner', async () => {
      const expense: FixedTransaction = { amount: '10.00', currency: 'EUR', isExpense: true, entryReference: 'm_exp' };
      const income: FixedTransaction = { amount: '20.00', currency: 'EUR', isExpense: false, entryReference: 'm_inc' };
      helpers.enablebanking.setFixedTransactions([expense, income]);
      const { accountId } = await setupActiveConnection();

      const rows = await Transactions.findAll({ where: { accountId } });
      const merchants = rows.map((r) => (r.externalData as { merchantName?: string }).merchantName);
      expect(merchants).toHaveLength(2);
      expect(merchants).toEqual(['Test Company', 'Test Company']);
    });
  });

  describe('Credit limit lifecycle', () => {
    it('imports the bank limit, lets the owner edit it, and keeps stats in step', async () => {
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });
      const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: { connectionId: connectResult.connectionId, code: helpers.enablebanking.mockAuthCode, state },
      });

      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/details', ({ params }) => {
          const details = getMockedAccountDetails(params.accountId as string);
          return HttpResponse.json(
            details.identification_hash === MOCK_IDENTIFICATION_HASH_1
              ? { ...details, credit_limit: { amount: '5000.00', currency: 'GBP' } }
              : details,
          );
        }),
      );

      // Mock account 1 (EUR) reports a GBP limit whose currency does not match
      // the account, account 2 reports 1500 EUR, account 3 an unparsable amount.
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2, MOCK_IDENTIFICATION_HASH_3],
        raw: true,
      });
      const mismatchId = syncedAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_1)!.id;
      const creditId = syncedAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_2)!.id;
      const unparsableId = syncedAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_3)!.id;

      const mismatch = await helpers.getAccount({ id: mismatchId, raw: true });
      const credit = await helpers.getAccount({ id: creditId, raw: true });
      const unparsable = await helpers.getAccount({ id: unparsableId, raw: true });
      expect(mismatch.creditLimit).toBe(0);
      expect(mismatch.refCreditLimit).toBe(0);
      expect(credit.creditLimit).toBe(1500);
      expect(credit.refCreditLimit).toEqualRefValue(1500 * EUR_TO_AED);
      expect(unparsable.creditLimit).toBe(0);
      expect(unparsable.refCreditLimit).toBe(0);

      const today = format(new Date(), 'yyyy-MM-dd');
      const setIncludeLimit = ({ on }: { on: boolean }) =>
        helpers.patchUserSettings({ patch: { includeCreditLimitInStats: on }, raw: true });
      const rawTotal = await helpers.getTotalBalance({ date: today, raw: true });

      await setIncludeLimit({ on: true });
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toEqualRefValue(rawTotal - 1500 * EUR_TO_AED);

      // Owner raises the imported limit; balances stay untouched.
      const raised = await helpers.updateAccount({ id: creditId, payload: { creditLimit: 2000 }, raw: true });
      expect(raised.creditLimit).toBe(2000);
      expect(raised.refCreditLimit).toEqualRefValue(2000 * EUR_TO_AED);
      expect(raised.currentBalance).toBe(credit.currentBalance);
      expect(raised.initialBalance).toBe(credit.initialBalance);
      expect(raised.refCurrentBalance).toBe(credit.refCurrentBalance);

      // Owner adds a limit the bank never reported.
      const mismatchWithLimit = await helpers.updateAccount({
        id: mismatchId,
        payload: { creditLimit: 500 },
        raw: true,
      });
      expect(mismatchWithLimit.creditLimit).toBe(500);
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toEqualRefValue(rawTotal - 2500 * EUR_TO_AED);

      // Back to zero drops the account out of the adjustment entirely.
      const zeroed = await helpers.updateAccount({ id: creditId, payload: { creditLimit: 0 }, raw: true });
      expect(zeroed.creditLimit).toBe(0);
      expect(zeroed.refCreditLimit).toBe(0);
      expect(zeroed.currentBalance).toBe(credit.currentBalance);
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toEqualRefValue(rawTotal - 500 * EUR_TO_AED);

      // Balance itself stays bank-owned.
      const res = await helpers.updateAccount({ id: creditId, payload: { currentBalance: 1 } });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);

      await setIncludeLimit({ on: false });
      expect(await helpers.getTotalBalance({ date: today, raw: true })).toBe(rawTotal);
    }, 60_000);
  });

  describe('Pending transactions', () => {
    const CARD_PENDING: FixedTransaction = {
      amount: '20.00',
      currency: 'EUR',
      isExpense: true,
      entryReference: 'pending_card',
      status: 'PDNG',
    };

    const listIsPending = async ({ accountId }: { accountId: string }) => {
      const txs = (await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      })) as unknown as TransactionApiResponse[];
      return txs.map((tx) => tx.isPending);
    };

    it('skips PDNG and HOLD payloads by default', async () => {
      helpers.enablebanking.setFixedTransactions([
        { amount: '10.00', currency: 'EUR', isExpense: true, entryReference: 'booked_row' },
        CARD_PENDING,
        { ...CARD_PENDING, amount: '30.00', entryReference: 'held_row', status: 'HOLD' },
      ]);
      const { accountId } = await setupActiveConnection();

      const rows = await Transactions.findAll({ where: { accountId } });
      expect(rows.map((row) => row.amount.toNumber())).toEqual([10]);
      expect(await listIsPending({ accountId })).toEqual([false]);
    });

    it('marks imported pending rows and still books them after the setting is turned off', async () => {
      await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
      helpers.enablebanking.setFixedTransactions([CARD_PENDING]);
      const { connectionId, accountId } = await setupActiveConnection();

      expect(await listIsPending({ accountId })).toEqual([true]);

      await helpers.patchUserSettings({ patch: { importPendingBankTransactions: false }, raw: true });
      helpers.enablebanking.setFixedTransactions([{ ...CARD_PENDING, status: 'BOOK' }]);
      await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
        payload: { accountId },
        raw: true,
      });

      expect(await listIsPending({ accountId })).toEqual([false]);
    });

    it('keeps fetching from the oldest pending payment until it books', async () => {
      const utcDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0]!;
      const newerBooked: FixedTransaction = {
        amount: '10.00',
        currency: 'EUR',
        isExpense: true,
        entryReference: 'newer_booked',
        bookingDate: utcDaysAgo(2),
      };
      const olderPending: FixedTransaction = { ...CARD_PENDING, transactionDate: utcDaysAgo(10) };
      helpers.enablebanking.setFixedTransactions([newerBooked, olderPending]);
      const { connectionId, accountId } = await setupActiveConnection();
      const sync = () => helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      await sync();
      expect(helpers.enablebanking.lastTransactionsQuery()?.dateFrom).toBe(utcDaysAgo(10));

      helpers.enablebanking.setFixedTransactions([newerBooked, { ...olderPending, status: 'BOOK' }]);
      await sync();
      expect(await Transactions.count({ where: { accountId } })).toBe(2);

      await sync();
      expect(helpers.enablebanking.lastTransactionsQuery()?.dateFrom).toBe(utcDaysAgo(2));
    });

    describe('when the bank drops a stored pending payment before listing its booked copy', () => {
      const newerBooked: FixedTransaction = {
        amount: '10.00',
        currency: 'EUR',
        isExpense: true,
        entryReference: 'newer_booked',
        bookingDate: utcDateDaysAgo(2),
      };

      const syncWithBankGap = async ({ pendingDaysAgo }: { pendingDaysAgo: number }) => {
        await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
        const olderPending: FixedTransaction = { ...CARD_PENDING, transactionDate: utcDateDaysAgo(pendingDaysAgo) };
        helpers.enablebanking.setFixedTransactions([newerBooked, olderPending]);
        const { connectionId, accountId } = await setupActiveConnection();
        const sync = () => helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

        helpers.enablebanking.setFixedTransactions([newerBooked]);
        await sync();

        helpers.enablebanking.setFixedTransactions([newerBooked, { ...olderPending, status: 'BOOK' }]);
        await sync();

        return { accountId };
      };

      it('still fetches from the stored pending row and books it', async () => {
        const { accountId } = await syncWithBankGap({ pendingDaysAgo: 10 });

        expect(helpers.enablebanking.lastTransactionsQuery()?.dateFrom).toBe(utcDateDaysAgo(10));
        expect(await listIsPending({ accountId })).toEqual([false, false]);
      });

      it('ignores a stored pending row older than 14 days', async () => {
        await syncWithBankGap({ pendingDaysAgo: 20 });

        expect(helpers.enablebanking.lastTransactionsQuery()?.dateFrom).toBe(utcDateDaysAgo(2));
      });
    });

    it('uses the booked balance when the bank also reports a lower available one', async () => {
      global.mswMockServer.use(
        http.get('https://api.enablebanking.com/accounts/:accountId/balances', () =>
          HttpResponse.json({
            balances: [
              { balance_type: 'ITAV', balance_amount: { amount: '1473.45', currency: 'EUR' } },
              { balance_type: 'ITBD', balance_amount: { amount: '1523.45', currency: 'EUR' } },
            ],
          }),
        ),
      );

      const { accountId } = await setupActiveConnection();

      const account = await helpers.getAccount({ id: accountId, raw: true });
      expect(account.currentBalance).toBe(1523.45);
    });
  });
});
