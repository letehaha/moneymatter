import { api } from '@/api/_api';
import { BANK_PROVIDER_TYPE, type ConnectionNeedingReauth, type ConnectionStatusSummary } from '@bt/shared/types';

export type { ConnectionNeedingReauth, ConnectionStatusSummary };

export interface BankProvider {
  type: BANK_PROVIDER_TYPE;
  name: string;
  description: string;
  logoUrl?: string;
  documentationUrl?: string;
  redirectUrl?: string;
  features: {
    supportsAccountSync: boolean;
    supportsTransactionSync: boolean;
    supportsBalanceUpdates: boolean;
    supportsWebhooks: boolean;
    supportsManualSync: boolean;
    supportsAutoSync: boolean;
    supportsRealtime: boolean;
    requiresReauth: boolean;
    defaultSyncInterval: number;
    minSyncInterval: number;
  };
}

export interface BankConnection {
  id: string;
  providerType: BANK_PROVIDER_TYPE;
  providerName: string;
  isActive: boolean;
  lastSyncAt: string | null;
  accountsCount: number;
  createdAt: string;
  bankName: string | null;
}

interface BankConnectionDetails {
  id: string;
  providerType: BANK_PROVIDER_TYPE;
  providerName: string;
  isActive: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  provider: {
    name: string;
    description: string;
    logoUrl?: string;
    documentationUrl?: string;
    features: {
      supportsWebhooks: boolean;
      supportsRealtime: boolean;
      requiresReauth: boolean;
      supportsManualSync: boolean;
      supportsAutoSync: boolean;
      defaultSyncInterval?: number;
      minSyncInterval?: number;
    };
  };
  accounts: Array<{
    id: string;
    name: string;
    externalId: string;
    currentBalance: number;
    currencyCode: string;
    type: string;
    currencyFallback: { providerCurrency: string; assignedCurrency: string } | null;
  }>;
  consent?: {
    validFrom: string | null;
    validUntil: string | null;
    daysRemaining: number | null;
    isExpired: boolean;
    isExpiringSoon: boolean;
  };
  deactivationReason?: string | null;
}

/**
 * ISO 4217 "no currency" — the provider couldn't report one for the account.
 * Connecting such an account requires an explicit currency choice from the
 * user (immutable afterwards; reconnecting is the only way to change it).
 */
export { NO_CURRENCY_CODE } from '@bt/shared/types';

export interface AvailableAccount {
  externalId: string;
  name: string;
  type: string;
  balance: number;
  creditLimit: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

interface SyncedAccount {
  id: string;
  externalId: string;
  name: string;
  balance: number;
  currency: string;
}

export const listProviders = async (): Promise<BankProvider[]> => {
  const response = await api.get<{ providers: BankProvider[] }>('/bank-data-providers');
  return response.providers;
};

export const listConnections = async (): Promise<BankConnection[]> => {
  const response = await api.get<{ connections: BankConnection[] }>('/bank-data-providers/connections');
  return response.connections;
};

export const getConnectionDetails = async (connectionId: string): Promise<BankConnectionDetails> => {
  const response = await api.get<{ connection: BankConnectionDetails }>(
    `/bank-data-providers/connections/${connectionId}`,
  );
  return response.connection;
};

export const connectProvider = async (
  providerType: BANK_PROVIDER_TYPE,
  credentials: Record<string, unknown>,
  providerName?: string,
): Promise<{ connectionId: string; authUrl?: string; message: string }> => {
  const response = await api.post(`/bank-data-providers/${providerType}/connect`, {
    credentials,
    providerName,
  });
  return response;
};

export const disconnectProvider = async ({
  connectionId,
  removeAssociatedAccounts = false,
}: {
  connectionId: string;
  removeAssociatedAccounts?: boolean;
}): Promise<{ message: string }> => {
  const response = await api.delete(`/bank-data-providers/connections/${connectionId}`, {
    query: { removeAssociatedAccounts },
  });
  return response;
};

export const reauthorizeConnection = async (connectionId: string): Promise<{ authUrl: string; message: string }> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/reauthorize`);
  return response;
};

export const updateConnectionDetails = async (
  connectionId: string,
  details: { providerName?: string; credentials?: Record<string, unknown> },
): Promise<{ message: string; connection: BankConnectionDetails }> => {
  const response = await api.patch(`/bank-data-providers/connections/${connectionId}`, details);
  return response;
};

export const getAvailableAccounts = async (connectionId: string): Promise<AvailableAccount[]> => {
  const response = await api.get<{ accounts: AvailableAccount[] }>(
    `/bank-data-providers/connections/${connectionId}/available-accounts`,
  );
  return response.accounts;
};

export const syncSelectedAccounts = async (
  connectionId: string,
  accountExternalIds: string[],
  // externalId → currency for accounts listed with NO_CURRENCY_CODE.
  currencyOverrides?: Record<string, string>,
): Promise<{ syncedAccounts: SyncedAccount[]; message: string }> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/sync-selected-accounts`, {
    accountExternalIds,
    currencyOverrides,
  });
  return response;
};

interface SyncJobResult {
  // null for providers that load inline (e.g. SimpleFIN) rather than via a job queue.
  jobGroupId: string | null;
  totalBatches: number;
  estimatedMinutes: number;
  // Inline load (jobGroupId === null) counts: rows created vs rows the
  // provider returned before dedup.
  createdCount?: number;
  fetchedCount?: number;
  message: string;
}

export const syncTransactions = async (
  connectionId: string,
  accountId: string,
): Promise<{ message: string } | SyncJobResult> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/sync-transactions`, {
    accountId,
  });
  return response;
};

export const syncConnection = async ({ connectionId }: { connectionId: string }): Promise<SyncResult> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/sync`);
  return response;
};

interface ReconcileDuplicatesResult {
  mergedCount: number;
  skippedCount: number;
  consideredPairs: number;
  unresolvedCount: number;
}

export const reconcileDuplicates = async ({
  connectionId,
  accountId,
}: {
  connectionId: string;
  accountId: string;
}): Promise<ReconcileDuplicatesResult> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/reconcile-duplicates`, {
    accountId,
  });
  return response;
};

export const loadTransactionsForPeriod = async (
  connectionId: string,
  accountId: string,
  from: string,
  to: string,
): Promise<SyncJobResult> => {
  const response = await api.post(`/bank-data-providers/connections/${connectionId}/load-transactions-for-period`, {
    accountId,
    from,
    to,
  });
  return response;
};

// Enable Banking specific APIs
export interface ASPSP {
  /** Available authentication methods */
  auth_methods: Array<{
    approach: string;
    credentials: Array<{
      description?: string;
      name: string;
      required: boolean;
      template?: string;
      title?: string;
    }>;
    hidden_method: boolean;
    name: string;
    psu_type: 'personal' | 'business';
  }>;
  /** Whether bank is in beta */
  beta: boolean;
  /** BIC code */
  bic: string;
  /** Country code */
  country: string;
  /** Logo URL */
  logo: string;
  /** Maximum consent validity in seconds */
  maximum_consent_validity?: number;
  /** Bank name */
  name: string;
  /** Payment capabilities */
  payments?: Array<{
    allowed_auth_methods: string[];
    currencies: string[];
    payment_type: string;
    psu_type: 'personal' | 'business';
    [key: string]: unknown;
  }>;
  /** Supported PSU types */
  psu_types: Array<'personal' | 'business'>;
  /** Required PSU headers */
  required_psu_headers: string[];
}

export const getEnableBankingCountries = async (appId: string, privateKey: string): Promise<string[]> => {
  const response: { countries: string[] } = await api.post('/bank-data-providers/enablebanking/countries', {
    appId,
    privateKey,
  });
  return response.countries;
};

export const getEnableBankingBanks = async (appId: string, privateKey: string, country: string): Promise<ASPSP[]> => {
  const response: { banks: ASPSP[] } = await api.post(`/bank-data-providers/enablebanking/banks?country=${country}`, {
    appId,
    privateKey,
  });
  return response.banks;
};

export const completeEnableBankingOAuth = async (
  connectionId: string,
  code: string,
  state: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await api.post('/bank-data-providers/enablebanking/oauth-callback', {
    connectionId,
    code,
    state,
  });
  return response;
};

// Bulk account sync APIs
export enum SyncStatus {
  IDLE = 'idle',
  QUEUED = 'queued',
  SYNCING = 'syncing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface AccountSyncStatus {
  accountId: string;
  accountName: string;
  providerType: string;
  status: SyncStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

interface SyncStatusSummary {
  total: number;
  syncing: number;
  queued: number;
  completed: number;
  failed: number;
  idle: number;
}

export interface SyncStatusResponse {
  lastSyncAt: number | null;
  accounts: AccountSyncStatus[];
  connectionsNeedingReauth: ConnectionNeedingReauth[];
  connectionStatuses: ConnectionStatusSummary[];
  summary: SyncStatusSummary;
}

interface SyncResult {
  totalAccounts: number;
  queuedAccounts: number;
}

interface CheckSyncResponse {
  syncTriggered: boolean;
  message?: string;
  totalAccounts?: number;
  queuedAccounts?: number;
}

/**
 * Check if auto-sync is needed and trigger if 4+ hours have passed
 */
export const checkSync = async (): Promise<CheckSyncResponse> => {
  const response = await api.get<CheckSyncResponse>('/bank-data-providers/sync/check');
  return response;
};

/**
 * Manually trigger sync for all bank-connected accounts
 */
export const triggerSync = async (): Promise<SyncResult> => {
  const response = await api.post('/bank-data-providers/sync/trigger');
  return response;
};

/**
 * Get current sync status for all user's bank accounts
 */
export const getSyncStatus = async (): Promise<SyncStatusResponse> => {
  const response = await api.get<SyncStatusResponse>('/bank-data-providers/sync/status');
  return response;
};
