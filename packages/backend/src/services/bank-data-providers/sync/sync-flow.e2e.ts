import { ACCOUNT_STATUSES, BANK_PROVIDER_TYPE, DEACTIVATION_REASON } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { MOCK_IDENTIFICATION_HASH_1, getMockedTransactions } from '@tests/mocks/enablebanking/data';
import { MONOBANK_URLS_MOCK, VALID_MONOBANK_TOKEN, getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import { HttpResponse, http } from 'msw';

import { accountSyncQueue } from './account-sync-queue';
import { REDIS_KEYS, SyncStatus } from './sync-status-tracker';

/**
 * Seed a deactivated connection by mutating the metadata directly on the DB
 * row. Mirrors the state the auth-failure flow produces in production without
 * having to wire up a 403 mock here.
 */
async function deactivateConnection({
  connectionId,
  deactivationReason,
}: {
  connectionId: string;
  deactivationReason: string | null;
}) {
  const BankDataProviderConnections = (await import('@models/bank-data-provider-connections.model')).default;
  const conn = (await BankDataProviderConnections.findByPk(connectionId))!;
  const metadata = (conn.metadata ?? {}) as Record<string, unknown>;
  await conn.update({
    isActive: false,
    metadata: { ...metadata, deactivationReason },
  });
}

const EB_TRANSACTIONS_URL = 'https://api.enablebanking.com/accounts/:accountId/transactions';

/** Create an Enable Banking connection that has completed its OAuth flow. */
async function authorizeConnection(): Promise<string> {
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

  await helpers.bankDataProviders.listExternalAccounts({
    connectionId: connectResult.connectionId,
    raw: true,
  });

  return connectResult.connectionId;
}

function connectAccount({ connectionId, waitForSync }: { connectionId: string; waitForSync: boolean }) {
  return helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    waitForSync,
  });
}

useSelfHost();

describe('Sync Flow E2E', () => {
  describe('Sync Status Tracking', () => {
    it('should return empty status when no accounts are connected', async () => {
      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response).toBeDefined();
      expect(response.body.response.lastSyncAt).toBeNull();
      expect(response.body.response.accounts).toEqual([]);
      expect(response.body.response.summary.total).toBe(0);
    });

    it('should return status for connected accounts. [just now] connected account should be marked as "syncing"', async () => {
      // Setup: Connect provider and account
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
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
        waitForSync: false,
      });

      // Test: Get status
      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.accounts.length).toBe(1);
      expect(response.body.response.summary.total).toBe(1);

      const accountStatus = response.body.response.accounts[0]!;
      expect(accountStatus).toHaveProperty('accountId');
      expect(accountStatus).toHaveProperty('accountName');
      expect(accountStatus).toHaveProperty('providerType');
      expect(accountStatus).toHaveProperty('status');
      // Newly connected account has auto-sync functionality so at the moment of
      // connection it's expected for it to be "syncing" or "queued"
      expect([SyncStatus.SYNCING, SyncStatus.QUEUED].includes(accountStatus.status)).toBe(true);
    });

    /**
     * A freshly queued sync is reported as QUEUED no matter how long ago the
     * account's previous sync finished: the QUEUED record carries its own
     * `startedAt`, so the 20-minute staleness check never fires on it.
     */
    describe('Queued status after a long-finished previous sync', () => {
      const STALE_THRESHOLD_MS = 20 * 60 * 1000;
      const BLOCKER_FETCH_MS = 1500;

      const slowStatementHandler = ({ delayMs }: { delayMs: number }) =>
        http.get(MONOBANK_URLS_MOCK.personalStatement, async () => {
          await helpers.sleep(delayMs);
          return HttpResponse.json([]);
        });

      async function seedCompletedStatus({ accountId, ageMs }: { accountId: string; ageMs: number }) {
        const at = new Date(Date.now() - ageMs).toISOString();
        await redisClient.set(
          REDIS_KEYS.accountSyncStatus(accountId),
          JSON.stringify({
            accountId,
            status: SyncStatus.COMPLETED,
            startedAt: at,
            completedAt: at,
            error: null,
          }),
        );
      }

      async function waitForStatus({
        accountId,
        expected,
        timeoutMs = 8000,
      }: {
        accountId: string;
        expected: SyncStatus[];
        timeoutMs?: number;
      }) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({
            raw: true,
          });
          const account = accounts.find((item) => item.accountId === accountId);
          if (account && expected.includes(account.status)) return;
          await helpers.sleep(100);
        }

        throw new Error(`Account ${accountId} never reached ${expected.join('/')}`);
      }

      /**
       * Both accounts share one API token, so they share one BullMQ worker with
       * concurrency 1: a sync on `blockerAccountId` with a slow statement mock holds
       * the worker, keeping the next account's job in the QUEUED phase long enough to
       * observe it over HTTP.
       */
      async function connectTwoAccounts() {
        global.mswMockServer.use(getMonobankTransactionsMock({ response: [] }));

        const { connectionId } = await helpers.monobank.pair();

        const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
          connectionId,
          raw: true,
        });

        const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
          connectionId,
          accountExternalIds: externalAccounts.slice(0, 2).map((account) => account.externalId),
          raw: true,
        });

        return {
          connectionId,
          blockerAccountId: syncedAccounts[0]!.id,
          accountId: syncedAccounts[1]!.id,
        };
      }

      async function occupyWorker({
        connectionId,
        blockerAccountId,
      }: {
        connectionId: string;
        blockerAccountId: string;
      }) {
        global.mswMockServer.use(slowStatementHandler({ delayMs: BLOCKER_FETCH_MS }));

        const blockerJob = await helpers.bankDataProviders.syncTransactionsForAccount({
          connectionId,
          accountId: blockerAccountId,
          raw: true,
        });
        await waitForStatus({
          accountId: blockerAccountId,
          expected: [SyncStatus.SYNCING],
        });

        return { blockerJobGroupId: blockerJob.jobGroupId! };
      }

      it('reports a queued sync when the previous sync completed longer ago than the stale threshold', async () => {
        const { connectionId, blockerAccountId, accountId } = await connectTwoAccounts();
        const { blockerJobGroupId } = await occupyWorker({
          connectionId,
          blockerAccountId,
        });

        await seedCompletedStatus({
          accountId,
          ageMs: STALE_THRESHOLD_MS + 5 * 60 * 1000,
        });

        const { jobGroupId } = await helpers.bankDataProviders.syncTransactionsForAccount({
          connectionId,
          accountId,
          raw: true,
        });

        const { accounts, summary } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        const account = accounts.find((item) => item.accountId === accountId);

        expect(account?.status).toBe(SyncStatus.QUEUED);
        expect(summary.queued).toBe(1);
        expect(Date.now() - new Date(account!.startedAt!).getTime()).toBeLessThan(STALE_THRESHOLD_MS);

        for (const id of [blockerJobGroupId, jobGroupId!]) {
          await helpers.bankDataProviders.waitForSyncJobsToComplete({
            connectionId,
            jobGroupId: id,
            timeoutMs: 8000,
          });
        }
      });

      it('reports a queued sync when the previous sync completed recently', async () => {
        const { connectionId, blockerAccountId, accountId } = await connectTwoAccounts();
        const { blockerJobGroupId } = await occupyWorker({
          connectionId,
          blockerAccountId,
        });

        await seedCompletedStatus({ accountId, ageMs: 1000 });

        const { jobGroupId } = await helpers.bankDataProviders.syncTransactionsForAccount({
          connectionId,
          accountId,
          raw: true,
        });

        const { accounts, summary } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        const account = accounts.find((item) => item.accountId === accountId);

        expect(account?.status).toBe(SyncStatus.QUEUED);
        expect(summary.queued).toBe(1);

        for (const id of [blockerJobGroupId, jobGroupId!]) {
          await helpers.bankDataProviders.waitForSyncJobsToComplete({
            connectionId,
            jobGroupId: id,
            timeoutMs: 8000,
          });
        }
      });
    });
  });

  describe('Auto Sync Check', () => {
    it('should trigger sync when no previous sync exists', async () => {
      // Setup: Connect provider and account
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      // Mock transaction data
      const mockTransactions = helpers.monobank.mockedTransactionData(3);
      global.mswMockServer.use(getMonobankTransactionsMock({ response: mockTransactions }));

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      // Clear any sync that happened during account connection
      await redisClient.del(REDIS_KEYS.userLastAutoSync(global.userId));

      // Test: Check sync should trigger
      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/check',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.syncTriggered).toBe(true);
      expect(response.body.response).toHaveProperty('totalAccounts');
      expect(response.body.response.totalAccounts).toBeGreaterThan(0);
    });

    it('does not trigger auto-sync while a base-currency change holds the lock', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
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
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      // No prior sync — a lock-free /check would trigger. The lock must suppress it.
      await redisClient.del(REDIS_KEYS.userLastAutoSync(userId));

      await redisClient.set(buildLockKey(userId), 'test-lock');
      let lockedResponse;
      try {
        lockedResponse = await helpers.makeRequest({
          method: 'get',
          url: '/bank-data-providers/sync/check',
        });
      } finally {
        await redisClient.del(buildLockKey(userId));
      }

      expect(lockedResponse.status).toBe(200);
      expect(lockedResponse.body.response.syncTriggered).toBe(false);

      // Once the lock clears, the same setup triggers — proving the lock was the only blocker.
      const afterUnlock = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/check',
      });
      expect(afterUnlock.body.response.syncTriggered).toBe(true);
    });

    it.skip('should not trigger sync when last sync was within 4 hours', async () => {
      // TODO: This test is flaky because auto-sync from account connection
      // can update the lastSyncAt timestamp after we set it manually
      // Need to refactor to avoid race condition
    });

    it('should trigger sync when last sync was more than 4 hours ago', async () => {
      // Setup: Connect account
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
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      // Set last sync to 5 hours ago
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
      await redisClient.set(REDIS_KEYS.userLastAutoSync(global.userId), fiveHoursAgo.toString());

      // Test: Check sync should trigger
      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/check',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.syncTriggered).toBe(true);
    });
  });

  describe('Manual Sync Trigger', () => {
    it('should sync all connected accounts', async () => {
      // Setup: Connect multiple accounts
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      // Mock transactions
      const mockTransactions = helpers.monobank.mockedTransactionData(5);
      global.mswMockServer.use(getMonobankTransactionsMock({ response: mockTransactions }));

      // Connect first 2 accounts
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: externalAccounts.slice(0, 2).map((a: { externalId: string }) => a.externalId),
        raw: true,
      });

      // Test: Trigger sync
      const response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.totalAccounts).toBe(2);
      expect(response.body.response.queuedAccounts).toBe(2);

      const status = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
      expect(status.lastSyncAt).not.toBeNull();
    });

    it('should handle sync when no accounts are connected', async () => {
      const response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.totalAccounts).toBe(0);
      expect(response.body.response.queuedAccounts).toBe(0);

      const status = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
      expect(status.lastSyncAt).not.toBeNull();
    });

    it('does not throttle the next auto-sync when queueing the manual sync fails', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const mockTransactions = helpers.monobank.mockedTransactionData(5);
      global.mswMockServer.use(getMonobankTransactionsMock({ response: mockTransactions }));

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: externalAccounts.slice(0, 2).map((a: { externalId: string }) => a.externalId),
        raw: true,
      });

      // getJob is stubbed so a connect-time job still being removed can't make enqueue skip add.
      const getJobSpy = jest.spyOn(accountSyncQueue, 'getJob').mockResolvedValue(undefined);
      const addSpy = jest.spyOn(accountSyncQueue, 'add').mockRejectedValueOnce(new Error('Queue unavailable'));

      try {
        const triggerResponse = await helpers.makeRequest({
          method: 'post',
          url: '/bank-data-providers/sync/trigger',
        });

        expect(addSpy).toHaveBeenCalled();
        expect(triggerResponse.status).toBe(500);

        const status = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
        expect(status.lastSyncAt).toBeNull();

        const checkResponse = await helpers.makeRequest({
          method: 'get',
          url: '/bank-data-providers/sync/check',
        });

        expect(checkResponse.status).toBe(200);
        expect(checkResponse.body.response.syncTriggered).toBe(true);
      } finally {
        getJobSpy.mockRestore();
        addSpy.mockRestore();
      }

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();
    });

    it('should skip disabled accounts from sync', async () => {
      // Setup: Connect provider and multiple accounts
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      // Connect 2 accounts
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: externalAccounts.slice(0, 2).map((a: { externalId: string }) => a.externalId),
        raw: true,
      });

      // Disable the first account
      await helpers.updateAccount({
        id: syncedAccounts[0]!.id,
        payload: { status: ACCOUNT_STATUSES.archived },
        raw: true,
      });

      // Trigger sync
      const response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });

      expect(response.status).toBe(200);
      // Only 1 account should be synced (the enabled one)
      expect(response.body.response.totalAccounts).toBe(1);
      expect(response.body.response.queuedAccounts).toBe(1);
    });

    it('should not include account in sync after archiving and re-activating (bank connection is unlinked on archive)', async () => {
      // Setup: Connect provider and account
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Archive the account (this also unlinks the bank connection)
      await helpers.updateAccount({
        id: accountId,
        payload: { status: ACCOUNT_STATUSES.archived },
        raw: true,
      });

      // Verify sync skips archived account
      let response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });
      expect(response.body.response.totalAccounts).toBe(0);

      // Re-activate the account (but bank connection remains unlinked)
      await helpers.updateAccount({
        id: accountId,
        payload: { status: ACCOUNT_STATUSES.active },
        raw: true,
      });

      // Verify sync still excludes the account because bank connection was unlinked during archive
      response = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });
      expect(response.body.response.totalAccounts).toBe(0);
    });
  });

  // TODO: unskip and fix
  describe.skip('Sync Status Updates', () => {
    it('should update Redis status during sync lifecycle', async () => {
      // Setup
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Wait for auto-sync to complete
      await helpers.sleep(2000);

      // Trigger sync and check status updates
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });

      // Give it a tiny moment for the sync to be queued
      await helpers.sleep(50);

      // Status should be updated (Monobank goes to QUEUED first)
      const updatedStatus = await redisClient.get(REDIS_KEYS.accountSyncStatus(accountId));
      expect(updatedStatus).not.toBeNull();

      const parsed = JSON.parse(updatedStatus!);
      expect(parsed).toHaveProperty('accountId');
      expect(parsed).toHaveProperty('status');
      expect(parsed.accountId).toBe(accountId);
      // Monobank should be QUEUED or already COMPLETED (fast worker) or still COMPLETED from auto-sync
      expect(['queued', 'completed']).toContain(parsed.status);
    });

    it('should transition Monobank accounts from QUEUED to SYNCING to COMPLETED', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      // Mock transaction data
      const mockTransactions = helpers.monobank.mockedTransactionData(3);
      global.mswMockServer.use(getMonobankTransactionsMock({ response: mockTransactions }));

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      const accountId = syncedAccounts[0]!.id;

      // Clear initial sync status
      const statusKey = REDIS_KEYS.accountSyncStatus(accountId);
      await redisClient.del(statusKey);

      // Trigger sync manually
      const { jobGroupId } = await helpers.bankDataProviders.syncTransactionsForAccount({
        connectionId: connectionResult.connectionId,
        accountId,
        raw: true,
      });

      // Check status immediately - should be QUEUED
      await helpers.sleep(50);
      const queuedStatus = await redisClient.get(statusKey);
      if (queuedStatus) {
        const parsed = JSON.parse(queuedStatus);
        expect(parsed.status).toBe('queued');
      }

      // Wait for job to complete
      await helpers.bankDataProviders.waitForSyncJobsToComplete({
        connectionId: connectionResult.connectionId,
        jobGroupId: jobGroupId!,
        timeoutMs: 10000,
      });

      // Check final status - should be COMPLETED
      await helpers.sleep(5_000);
      const completedStatus = await redisClient.get(statusKey);
      expect(completedStatus).not.toBeNull();

      const parsed = JSON.parse(completedStatus!);
      expect(parsed.status).toBe('completed');
      expect(parsed.completedAt).not.toBeNull();
    });
  });

  describe('connectionsNeedingReauth', () => {
    it('returns an empty list when no connections need reauth', async () => {
      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.connectionsNeedingReauth).toEqual([]);
    });

    it('surfaces auth_failure-deactivated connections in the response', async () => {
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
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      await deactivateConnection({
        connectionId: connectionResult.connectionId,
        deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
      });

      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.connectionsNeedingReauth).toHaveLength(1);

      const reauth = response.body.response.connectionsNeedingReauth[0];
      expect(reauth).toMatchObject({
        connectionId: connectionResult.connectionId,
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        accountsCount: 1,
      });
      expect(typeof reauth.deactivatedAt).toBe('string');
    });

    it('does not surface manually-disconnected connections (no auth_failure marker)', async () => {
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
        accountExternalIds: [externalAccounts[0]!.externalId],
        raw: true,
      });

      // Inactive but no deactivationReason set — represents a manual disconnect
      await deactivateConnection({
        connectionId: connectionResult.connectionId,
        deactivationReason: null,
      });

      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.connectionsNeedingReauth).toEqual([]);
    });

    it('accountsCount only counts active accounts (archived ones excluded)', async () => {
      const connectionResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        raw: true,
      });

      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId: connectionResult.connectionId,
        raw: true,
      });

      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: connectionResult.connectionId,
        accountExternalIds: externalAccounts.slice(0, 2).map((a: { externalId: string }) => a.externalId),
        raw: true,
      });

      // Archive one of the two synced accounts
      await helpers.updateAccount({
        id: syncedAccounts[0]!.id,
        payload: { status: ACCOUNT_STATUSES.archived },
        raw: true,
      });

      await deactivateConnection({
        connectionId: connectionResult.connectionId,
        deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
      });

      const response = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/status',
      });

      expect(response.status).toBe(200);
      expect(response.body.response.connectionsNeedingReauth).toHaveLength(1);
      expect(response.body.response.connectionsNeedingReauth[0].accountsCount).toBe(1);
    });
  });

  describe('Account sync queue', () => {
    beforeEach(() => helpers.enablebanking.resetSessionCounter());

    it('connect responds before the initial sync finishes', async () => {
      const connectionId = await authorizeConnection();

      global.mswMockServer.use(
        http.get(EB_TRANSACTIONS_URL, async ({ params }) => {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return HttpResponse.json({
            transactions: getMockedTransactions(params.accountId as string, 3),
            continuation_key: null,
          });
        }),
      );

      const startedAt = Date.now();
      const result = await connectAccount({ connectionId, waitForSync: false });
      const elapsedMs = Date.now() - startedAt;

      expect(result.status).toBe(200);
      expect(elapsedMs).toBeLessThan(1000);

      const inProgress = await helpers.bankDataProviders.getAccountsSyncStatus({
        raw: true,
      });
      expect(inProgress.summary.queued + inProgress.summary.syncing).toBeGreaterThanOrEqual(1);

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      const accountId = result.body.response.syncedAccounts[0]!.id;
      const transactions = await helpers.getTransactions({
        accountIds: [accountId],
        raw: true,
      });
      expect(transactions.length).toBeGreaterThan(0);
    });

    it('provider failure surfaces as FAILED account status', async () => {
      const connectionId = await authorizeConnection();

      global.mswMockServer.use(
        http.get(
          EB_TRANSACTIONS_URL,
          () =>
            new HttpResponse(JSON.stringify({ message: 'Upstream failure' }), {
              status: 500,
            }),
        ),
      );

      const result = await connectAccount({ connectionId, waitForSync: false });
      expect(result.status).toBe(200);

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      const accountId = result.body.response.syncedAccounts[0]!.id;
      const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
      const accountStatus = accounts.find((account) => account.accountId === accountId)!;

      expect(accountStatus.status).toBe(SyncStatus.FAILED);
      expect(typeof accountStatus.error).toBe('string');
      expect(accountStatus.error!.length).toBeGreaterThan(0);
    });

    it('re-triggering a running sync is a no-op', async () => {
      const connectionId = await authorizeConnection();
      const result = await connectAccount({ connectionId, waitForSync: true });
      const accountId = result.body.response.syncedAccounts[0]!.id;

      const firstTrigger = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });
      const secondTrigger = await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/sync/trigger',
      });

      expect(firstTrigger.status).toBe(200);
      expect(secondTrigger.status).toBe(200);

      await helpers.bankDataProviders.waitForAccountsSyncToSettle();

      const { accounts } = await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true });
      expect(accounts.find((account) => account.accountId === accountId)!.status).toBe(SyncStatus.COMPLETED);
    });
  });
});
