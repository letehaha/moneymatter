import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { getMockedWalutomatFxPair, getMockedWalutomatHistory } from '@tests/mocks/walutomat/data';
import {
  INVALID_WALUTOMAT_API_KEY,
  VALID_WALUTOMAT_API_KEY,
  VALID_WALUTOMAT_PRIVATE_KEY,
  getWalutomatBalancesMock,
  getWalutomatHistoryByCurrencyMock,
  getWalutomatHistoryMock,
} from '@tests/mocks/walutomat/mock-api';
import { HttpResponse, http } from 'msw';
import { Op } from 'sequelize';

describe('Walutomat Data Provider E2E', () => {
  describe('Complete connection flow', () => {
    it('should complete the full flow: list providers -> connect -> list connections -> list external accounts -> connect accounts -> get details', async () => {
      // Step 1: Fetch supported providers
      const { providers } = await helpers.bankDataProviders.getSupportedBankProviders({ raw: true });

      expect(Array.isArray(providers)).toBe(true);

      const walutomatProvider = providers.find((p: { type: string }) => p.type === BANK_PROVIDER_TYPE.WALUTOMAT)!;
      expect(walutomatProvider).toBeDefined();
      expect(walutomatProvider.name).toBe('Walutomat');

      // Step 2: Connect to Walutomat
      const connectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.WALUTOMAT,
        credentials: {
          apiKey: VALID_WALUTOMAT_API_KEY,
          privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
        },
        raw: true,
      });

      expect(connectResult).toHaveProperty('connectionId');
      expect(connectResult.connectionId).toBeTruthy();

      const connectionId = connectResult.connectionId;

      // Step 3: Fetch user's connections
      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });

      expect(Array.isArray(connections)).toBe(true);
      expect(connections.length).toBeGreaterThan(0);

      const connection = connections.find((c: { id: string }) => c.id === connectionId);
      expect(connection).toBeDefined();
      expect(connection?.providerType).toBe(BANK_PROVIDER_TYPE.WALUTOMAT);
      expect(connection?.providerName).toBe('Walutomat');
      expect(connection?.isActive).toBe(true);
      expect(connection?.accountsCount).toBe(0);

      // Step 4: List external accounts (wallets)
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      expect(Array.isArray(externalAccounts)).toBe(true);
      expect(externalAccounts.length).toBe(3); // EUR, PLN, USD

      const eurWallet = externalAccounts.find((a: { externalId: string }) => a.externalId === 'wallet-eur')!;
      expect(eurWallet).toBeDefined();
      expect(eurWallet.name).toBe('EUR Wallet');
      expect(eurWallet.currency).toBe('EUR');
      expect(eurWallet).toHaveProperty('balance');

      // Step 5: Connect selected wallets (set up mocks first since sync is direct)
      const accountIdsToConnect = ['wallet-eur'];

      global.mswMockServer.use(getWalutomatHistoryMock(), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: accountIdsToConnect,
        raw: true,
      });

      expect(Array.isArray(syncedAccounts)).toBe(true);
      expect(syncedAccounts.length).toBe(1);
      expect(syncedAccounts[0]!.externalId).toBe('wallet-eur');

      // Step 6: Fetch connection details
      const { connection: connectionDetails } = await helpers.bankDataProviders.getConnectionDetails({
        connectionId,
        raw: true,
      });

      expect(connectionDetails).toBeDefined();
      expect(connectionDetails.id).toBe(connectionId);
      expect(connectionDetails.providerType).toBe(BANK_PROVIDER_TYPE.WALUTOMAT);
      expect(connectionDetails.isActive).toBe(true);
      expect(connectionDetails.provider.name).toBe('Walutomat');
      expect(Array.isArray(connectionDetails.accounts)).toBe(true);
      expect(connectionDetails.accounts.length).toBe(1);
    });
  });

  describe('Connect provider', () => {
    it('should successfully connect with valid credentials', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.WALUTOMAT,
        credentials: {
          apiKey: VALID_WALUTOMAT_API_KEY,
          privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
        },
        raw: true,
      });

      expect(result).toHaveProperty('connectionId');
      expect(typeof result.connectionId).toBe('string');
    });

    it('should fail with invalid API key', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.WALUTOMAT}/connect`,
        payload: {
          credentials: {
            apiKey: INVALID_WALUTOMAT_API_KEY,
            privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
          },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.Forbidden);
    });

    it('should fail with missing privateKey field', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.WALUTOMAT}/connect`,
        payload: {
          credentials: { apiKey: VALID_WALUTOMAT_API_KEY },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should fail with missing apiKey field', async () => {
      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.WALUTOMAT}/connect`,
        payload: {
          credentials: { privateKey: VALID_WALUTOMAT_PRIVATE_KEY },
        },
      });

      expect(result.status).toEqual(ERROR_CODES.ValidationError);
    });

    it('should auto-name connection "Walutomat"', async () => {
      const result = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.WALUTOMAT,
        credentials: {
          apiKey: VALID_WALUTOMAT_API_KEY,
          privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
        },
        raw: true,
      });

      const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
      const connection = connections.find((c: { id: string }) => c.id === result.connectionId);
      expect(connection?.providerName).toBe('Walutomat');
    });
  });

  describe('List external accounts', () => {
    it('should return wallet accounts with balances after connection', async () => {
      const { connectionId } = await helpers.walutomat.pair();

      const { accounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      expect(accounts.length).toBe(3);

      // Verify wallet-eur
      const eurWallet = accounts.find((a: { externalId: string }) => a.externalId === 'wallet-eur')!;
      expect(eurWallet).toBeDefined();
      expect(eurWallet.currency).toBe('EUR');
      expect(eurWallet.name).toBe('EUR Wallet');
      expect(typeof eurWallet.balance).toBe('number');

      // Verify wallet-pln
      const plnWallet = accounts.find((a: { externalId: string }) => a.externalId === 'wallet-pln')!;
      expect(plnWallet).toBeDefined();
      expect(plnWallet.currency).toBe('PLN');
    });
  });

  describe('Transaction sync', () => {
    it('should sync transactions from history', async () => {
      const TX_COUNT = 5;
      const mockedHistory = getMockedWalutomatHistory({ amount: TX_COUNT, currency: 'EUR' });

      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      const transactions = await Transactions.findAll({
        where: { accountId },
        raw: true,
      });

      expect(transactions.length).toBe(TX_COUNT);

      // Verify transaction attributes
      transactions.forEach((tx) => {
        expect(tx.accountType).toBe(ACCOUNT_TYPES.walutomat);
        expect(tx.originalId).toBeTruthy();
        expect([TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense]).toContain(tx.transactionType);
      });
    });

    it('should not create duplicate transactions on re-sync', async () => {
      const TX_COUNT = 3;
      const mockedHistory = getMockedWalutomatHistory({ amount: TX_COUNT, currency: 'EUR' });

      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // First sync happened during connectSelectedAccounts. Sync again.
      global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());

      await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId,
        accountId,
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: { accountId },
        raw: true,
      });

      // Should still be the same count (no duplicates)
      expect(transactions.length).toBe(TX_COUNT);
    });

    it('does not re-import a row removed via reconciliation', async () => {
      const mockedHistory = getMockedWalutomatHistory({ amount: 3, currency: 'EUR' });
      const mockBank = () =>
        global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());
      const { connectionId } = await helpers.walutomat.pair();

      mockBank();
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });
      const accountId = syncedAccounts[0]!.id;
      const [removed, ...kept] = await helpers.getTransactions({ accountIds: [accountId], raw: true });
      await helpers.reconciliationRemove({ transactionIds: [removed!.id as RecordId], raw: true });

      mockBank();
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const after = await helpers.getTransactions({ accountIds: [accountId], raw: true });
      expect(after.map((tx) => tx.id).toSorted()).toEqual(kept.map((tx) => tx.id).toSorted());
      expect(after.filter((tx) => tx.originalId === removed!.originalId)).toEqual([]);
    });

    it('should store externalData with operation metadata', async () => {
      const mockedHistory = getMockedWalutomatHistory({ amount: 1, currency: 'EUR' });

      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: { accountId: syncedAccounts[0]!.id },
      });

      expect(transactions.length).toBe(1);

      const tx = transactions[0]!;
      const externalData = tx.externalData as Record<string, unknown>;
      expect(externalData).toHaveProperty('transactionId');
      expect(externalData).toHaveProperty('operationType');
      expect(externalData).toHaveProperty('operationDetailedType');
      expect(externalData).toHaveProperty('operationDetails');
      expect(externalData).toHaveProperty('historyItemId');
    });

    it('stores partnerOrderId / providerOperationId as externalReference', async () => {
      const mockedHistory = getMockedWalutomatHistory({
        amount: 3,
        currency: 'EUR',
        overrides: [
          {
            operationType: 'TRANSFER',
            operationDetailedType: 'WT_PAY',
            operationDetails: [{ key: 'partnerOrderId', value: 'PO-2024-0001' }],
          },
          {
            operationType: 'PAYIN',
            operationDetailedType: 'PAYIN_CARD',
            operationDetails: [{ key: 'providerOperationId', value: 'p24-987654' }],
          },
          {
            operationDetails: [{ key: 'title', value: 'No external reference' }],
          },
        ],
      });

      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: mockedHistory }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: { accountId: syncedAccounts[0]!.id },
      });

      expect(transactions.length).toBe(3);

      const byOriginalId = (index: number) =>
        transactions.find((tx) => tx.originalId === mockedHistory[index]!.transactionId)!;

      expect(byOriginalId(0).externalReference).toBe('PO-2024-0001');
      expect(byOriginalId(1).externalReference).toBe('p24-987654');
      expect(byOriginalId(2).externalReference).toBeNull();
    });

    it('should handle empty history gracefully', async () => {
      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: [] }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: { accountId: syncedAccounts[0]!.id },
        raw: true,
      });

      expect(transactions.length).toBe(0);
    });
  });

  describe('FX auto-linking', () => {
    it('should auto-link MARKET_FX transactions across wallets as transfers', async () => {
      const fxPair = getMockedWalutomatFxPair();

      const { connectionId } = await helpers.walutomat.pair();

      // Set up per-currency history mocks so each wallet gets its side of the FX trade
      global.mswMockServer.use(
        getWalutomatHistoryByCurrencyMock({
          responseByCurrency: {
            EUR: [fxPair.eurSide],
            USD: [fxPair.usdSide],
          },
        }),
        getWalutomatBalancesMock(),
      );

      // Connect both wallets — first sync creates the transactions
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur', 'wallet-usd'],
        raw: true,
      });

      const accountIds = syncedAccounts.map((a) => a.id);

      // Find all MARKET_FX transactions across the synced wallets
      const fxTransactions = await Transactions.findAll({
        where: {
          accountId: { [Op.in]: accountIds },
          accountType: ACCOUNT_TYPES.walutomat,
        },
      });

      // Should have exactly 2 transactions (one per wallet)
      expect(fxTransactions.length).toBe(2);

      // Both should be linked with the same transferId
      const eurTx = fxTransactions.find((tx) => tx.currencyCode === 'EUR')!;
      const usdTx = fxTransactions.find((tx) => tx.currencyCode === 'USD')!;

      expect(eurTx).toBeDefined();
      expect(usdTx).toBeDefined();

      expect(eurTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(usdTx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

      expect(eurTx.transferId).toBeTruthy();
      expect(eurTx.transferId).toBe(usdTx.transferId);

      // EUR side should be income, USD side should be expense
      expect(eurTx.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(usdTx.transactionType).toBe(TRANSACTION_TYPES.expense);
    });

    it('should not link non-FX transactions (PAYIN, PAYOUT)', async () => {
      const regularHistory = getMockedWalutomatHistory({ amount: 2, currency: 'EUR' });

      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(getWalutomatHistoryMock({ response: regularHistory }), getWalutomatBalancesMock());

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: {
          accountId: syncedAccounts[0]!.id,
          accountType: ACCOUNT_TYPES.walutomat,
        },
      });

      // All should remain as not_transfer
      transactions.forEach((tx) => {
        expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
        expect(tx.transferId).toBeNull();
      });
    });

    it('should not link FX transactions when only one side exists', async () => {
      const fxPair = getMockedWalutomatFxPair();

      const { connectionId } = await helpers.walutomat.pair();

      // Only sync the EUR wallet — the USD side won't exist
      global.mswMockServer.use(
        getWalutomatHistoryByCurrencyMock({
          responseByCurrency: {
            EUR: [fxPair.eurSide],
          },
        }),
        getWalutomatBalancesMock(),
      );

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      const transactions = await Transactions.findAll({
        where: {
          accountId: syncedAccounts[0]!.id,
          accountType: ACCOUNT_TYPES.walutomat,
        },
      });

      expect(transactions.length).toBe(1);
      expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    });
  });

  describe('Disconnect provider', () => {
    it('should disconnect and remove the connection', async () => {
      const { connectionId } = await helpers.walutomat.pair();

      await helpers.bankDataProviders.disconnectProvider({
        connectionId,
        raw: true,
      });

      const { connections: disconnectedConnections } = await helpers.bankDataProviders.listUserConnections({
        raw: true,
      });
      const connection = disconnectedConnections.find((c: { id: string }) => c.id === connectionId);
      expect(connection).toBeUndefined();
    });
  });

  describe('Provider outage vs. invalid credentials', () => {
    const WALUTOMAT_BALANCES_URL = 'https://api.walutomat.pl/api/v2.0.0/account/balances';

    it('connect: should not treat a provider 5xx as invalid credentials', async () => {
      global.mswMockServer.use(
        http.get(WALUTOMAT_BALANCES_URL, () => {
          return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'post',
        url: `/bank-data-providers/${BANK_PROVIDER_TYPE.WALUTOMAT}/connect`,
        payload: {
          credentials: {
            apiKey: VALID_WALUTOMAT_API_KEY,
            privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
          },
        },
      });

      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });

    it('refreshCredentials: should not treat a provider 5xx as invalid credentials', async () => {
      const { connectionId } = await helpers.walutomat.pair();

      global.mswMockServer.use(
        http.get(WALUTOMAT_BALANCES_URL, () => {
          return new HttpResponse(null, { status: 500, statusText: 'Internal Server Error' });
        }),
      );

      const result = await helpers.makeRequest({
        method: 'patch',
        url: `/bank-data-providers/connections/${connectionId}`,
        payload: {
          credentials: {
            apiKey: VALID_WALUTOMAT_API_KEY,
            privateKey: VALID_WALUTOMAT_PRIVATE_KEY,
          },
        },
      });

      expect(result.status).not.toEqual(ERROR_CODES.Forbidden);
      expect(result.status).toBeGreaterThanOrEqual(400);
    });
  });
});
