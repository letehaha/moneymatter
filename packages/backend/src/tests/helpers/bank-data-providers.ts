import type { RecordId } from '@bt/shared/types';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { ListExternalAccountsResponseData } from '@controllers/bank-data-providers/connections/list-external-accounts';
import * as connectProviderService from '@services/bank-data-providers/connection/connect-provider';
import * as getConnectionDetailsService from '@services/bank-data-providers/connection/get-connection-details';
import * as listUserConnectionsService from '@services/bank-data-providers/connection/list-user-connections';
import * as reconcileDuplicatesService from '@services/bank-data-providers/enablebanking/reconcile-duplicates';
import { listSupportedProviders } from '@services/bank-data-providers/list-supported-providers.service';
import type * as getUserAccountsSyncStatusService from '@services/bank-data-providers/sync/get-user-sync-status';
import type { queueConnectionSync } from '@services/bank-data-providers/sync/sync-manager';

import { MakeRequestReturn, UtilizeReturnType, makeRequest } from './common';

export function getSupportedBankProviders<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<{ providers: Awaited<ReturnType<typeof listSupportedProviders>> }, R>({
    method: 'get',
    url: '/bank-data-providers',
    raw,
  });
}

export function connectProvider<R extends boolean | undefined = false>({
  providerType,
  credentials,
  providerName,
  raw,
}: {
  providerType: BANK_PROVIDER_TYPE;
  credentials: Record<string, unknown>;
  providerName?: string;
  raw?: R;
}): UtilizeReturnType<typeof connectProviderService.connectProvider, R> {
  return makeRequest<Awaited<ReturnType<typeof connectProviderService.connectProvider>>, R>({
    method: 'post',
    url: `/bank-data-providers/${providerType}/connect`,
    payload: {
      credentials,
      ...(providerName && { providerName }),
    },
    raw,
  });
}

export function listUserConnections<R extends boolean | undefined = false>({
  raw,
}: {
  raw?: R;
} = {}) {
  return makeRequest<{ connections: Awaited<ReturnType<typeof listUserConnectionsService.listUserConnections>> }, R>({
    method: 'get',
    url: '/bank-data-providers/connections',
    raw,
  });
}

export function getConnectionDetails<R extends boolean | undefined = false>({
  connectionId,
  raw,
}: {
  connectionId: string;
  raw?: R;
}) {
  return makeRequest<{ connection: Awaited<ReturnType<typeof getConnectionDetailsService.getConnectionDetails>> }, R>({
    method: 'get',
    url: `/bank-data-providers/connections/${connectionId}`,
    raw,
  });
}

export function listExternalAccounts<R extends boolean | undefined = false>({
  connectionId,
  raw,
}: {
  connectionId: string;
  raw?: R;
}): Promise<MakeRequestReturn<ListExternalAccountsResponseData, R>> {
  return makeRequest<ListExternalAccountsResponseData, R>({
    method: 'get',
    url: `/bank-data-providers/connections/${connectionId}/available-accounts`,
    raw,
  });
}

export type SyncStatusResponse = Awaited<ReturnType<typeof getUserAccountsSyncStatusService.getUserAccountsSyncStatus>>;

export function getAccountsSyncStatus<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<SyncStatusResponse, R>({
    method: 'get',
    url: '/bank-data-providers/sync/status',
    raw,
  });
}

/**
 * Polls /sync/status until no account is queued or syncing. The connect
 * endpoint returns before the initial sync finishes, so tests that inspect
 * synced transactions right after connecting need this.
 */
export async function waitForAccountsSyncToSettle({
  timeoutMs = 30000,
  pollIntervalMs = 200,
}: { timeoutMs?: number; pollIntervalMs?: number } = {}): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const { summary } = await getAccountsSyncStatus({ raw: true });
    if (summary.queued + summary.syncing === 0) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Account sync did not settle within ${timeoutMs}ms`);
}

export async function connectSelectedAccounts<R extends boolean | undefined = false>({
  connectionId,
  accountExternalIds,
  currencyOverrides,
  raw,
  waitForSync = true,
}: {
  connectionId: string;
  accountExternalIds: string[];
  currencyOverrides?: Record<string, string>;
  raw?: R;
  /** Pass false to assert on the in-progress sync state right after connecting. */
  waitForSync?: boolean;
}) {
  const result = await makeRequest<
    {
      syncedAccounts: {
        id: RecordId;
        externalId: string;
        name: string;
        balance: number;
        currency: string;
      }[];
      message: string;
    },
    R
  >({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/sync-selected-accounts`,
    payload: {
      accountExternalIds,
      currencyOverrides,
    },
    raw,
  });

  if (waitForSync) await waitForAccountsSyncToSettle();

  return result;
}

export function syncTransactionsForAccount<R extends boolean | undefined = false>({
  connectionId,
  accountId,
  raw,
}: {
  connectionId: string;
  accountId: string;
  raw?: R;
}) {
  return makeRequest<
    {
      jobGroupId?: string;
      totalBatches?: number;
      estimatedMinutes?: number;
      message: string;
    },
    R
  >({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/sync-transactions`,
    payload: {
      accountId,
    },
    raw,
  });
}

export function syncConnection<R extends boolean | undefined = false>({
  connectionId,
  raw,
}: {
  connectionId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof queueConnectionSync>>, R>({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/sync`,
    raw,
  });
}

export function loadTransactionsForPeriod<R extends boolean | undefined = false>({
  connectionId,
  accountId,
  from,
  to,
  raw,
}: {
  connectionId: string;
  accountId: string;
  from: string;
  to: string;
  raw?: R;
}) {
  return makeRequest<
    {
      jobGroupId: string;
      totalBatches: number;
      estimatedMinutes: number;
      message: string;
    },
    R
  >({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/load-transactions-for-period`,
    payload: {
      accountId,
      from,
      to,
    },
    raw,
  });
}

export function reconcileDuplicates<R extends boolean | undefined = false>({
  connectionId,
  accountId,
  raw,
}: {
  connectionId: string;
  accountId: string;
  raw?: R;
}): UtilizeReturnType<typeof reconcileDuplicatesService.reconcileDuplicatesForAccount, R> {
  return makeRequest<Awaited<ReturnType<typeof reconcileDuplicatesService.reconcileDuplicatesForAccount>>, R>({
    method: 'post',
    url: `/bank-data-providers/connections/${connectionId}/reconcile-duplicates`,
    payload: {
      accountId,
    },
    raw,
  });
}

export function getSyncJobProgress<R extends boolean | undefined = false>({
  connectionId,
  jobGroupId,
  raw,
}: {
  connectionId: string;
  jobGroupId: string;
  raw?: R;
}) {
  return makeRequest<
    {
      totalBatches: number;
      completedBatches: number;
      failedBatches: number;
      activeBatches: number;
      waitingBatches: number;
      status: 'waiting' | 'active' | 'completed' | 'failed' | 'partial';
    },
    R
  >({
    method: 'get',
    url: `/bank-data-providers/connections/${connectionId}/sync-job-progress?jobGroupId=${jobGroupId}`,
    raw,
  });
}

/**
 * Wait for transaction sync jobs to complete
 * Polls the job status until completed or failed
 */
export async function waitForSyncJobsToComplete({
  connectionId,
  jobGroupId,
  timeoutMs = 30000,
  pollIntervalMs = 500,
}: {
  connectionId: string;
  jobGroupId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{
  status: 'completed' | 'failed' | 'partial';
  completedBatches: number;
  failedBatches: number;
  totalBatches: number;
}> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const progress = await getSyncJobProgress({ connectionId, jobGroupId, raw: true });

    if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'partial') {
      return {
        status: progress.status,
        completedBatches: progress.completedBatches,
        failedBatches: progress.failedBatches,
        totalBatches: progress.totalBatches,
      };
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Sync jobs did not complete within ${timeoutMs}ms`);
}

export function updateConnectionDetails<R extends boolean | undefined = false>({
  connectionId,
  providerName,
  credentials,
  raw,
}: {
  connectionId: string;
  providerName?: string;
  credentials?: Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<
    {
      connection: {
        id: string;
        providerName: string;
        providerType: string;
        isActive: boolean;
        lastSyncAt: string | null;
        createdAt: string;
        updatedAt: string;
      };
    },
    R
  >({
    method: 'patch',
    url: `/bank-data-providers/connections/${connectionId}`,
    payload: {
      ...(providerName !== undefined && { providerName }),
      ...(credentials !== undefined && { credentials }),
    },
    raw,
  });
}

export function disconnectProvider<R extends boolean | undefined = false>({
  connectionId,
  removeAssociatedAccounts = false,
  raw,
}: {
  connectionId: string;
  removeAssociatedAccounts?: boolean;
  raw?: R;
}) {
  return makeRequest<{ message: string }, R>({
    method: 'delete',
    url: `/bank-data-providers/connections/${connectionId}?removeAssociatedAccounts=${removeAssociatedAccounts}`,
    raw,
  });
}

export default {
  getSupportedBankProviders,
  connectProvider,
  disconnectProvider,
  listUserConnections,
  getConnectionDetails,
  updateConnectionDetails,
  listExternalAccounts,
  connectSelectedAccounts,
  syncTransactionsForAccount,
  syncConnection,
  loadTransactionsForPeriod,
  reconcileDuplicates,
  getSyncJobProgress,
  waitForSyncJobsToComplete,
  waitForAccountsSyncToSettle,
  getAccountsSyncStatus,
};
