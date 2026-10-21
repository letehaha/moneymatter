import type { ConnectionDetailsResponse } from '@services/bank-data-providers/connection/get-connection-details';
import type { listUserConnections } from '@services/bank-data-providers/connection/list-user-connections';
import type { getUserAccountsSyncStatus } from '@services/bank-data-providers/sync/get-user-sync-status';

type ConnectionListRow = Awaited<ReturnType<typeof listUserConnections>>[number];
type SyncStatus = Awaited<ReturnType<typeof getUserAccountsSyncStatus>>;

/**
 * Every presenter here copies fields by name. A connection row also carries provider credentials and
 * consent data in the database, so a field added to a service result later stays out of MCP until it
 * is listed here on purpose.
 */

/** A connection as the list shows it. */
export function presentBankConnection({ connection }: { connection: ConnectionListRow }) {
  return {
    id: connection.id,
    providerType: connection.providerType,
    providerName: connection.providerName,
    bankName: connection.bankName,
    isActive: connection.isActive,
    lastSyncAt: connection.lastSyncAt,
    accountsCount: connection.accountsCount,
    createdAt: connection.createdAt,
  };
}

/**
 * One connection with its accounts and consent window. The provider's description, logo and docs links,
 * the bank's own account identifiers (`externalId`, often an IBAN) and `updatedAt` stay out.
 */
export function presentBankConnectionDetails({ connection }: { connection: ConnectionDetailsResponse }) {
  return {
    id: connection.id,
    providerType: connection.providerType,
    providerName: connection.providerName,
    isActive: connection.isActive,
    lastSyncAt: connection.lastSyncAt,
    createdAt: connection.createdAt,
    provider: { name: connection.provider.name, features: connection.provider.features },
    accounts: connection.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      currentBalance: account.currentBalance,
      currencyCode: account.currencyCode,
      type: account.type,
      currencyFallback: account.currencyFallback,
    })),
    consent: connection.consent,
    deactivationReason: connection.deactivationReason ?? null,
  };
}

/** The sync state of the bank-connected accounts, the connections that need a reconnect and the consent windows. */
export function presentBankSyncStatus({ status }: { status: SyncStatus }) {
  return {
    lastSyncAt: status.lastSyncAt,
    summary: status.summary,
    accounts: status.accounts.map((account) => ({
      accountId: account.accountId,
      accountName: account.accountName,
      providerType: account.providerType,
      status: account.status,
      startedAt: account.startedAt,
      completedAt: account.completedAt,
      error: account.error,
    })),
    connectionsNeedingReauth: status.connectionsNeedingReauth.map((connection) => ({
      connectionId: connection.connectionId,
      providerType: connection.providerType,
      providerName: connection.providerName,
      bankName: connection.bankName,
      accountsCount: connection.accountsCount,
      deactivatedAt: connection.deactivatedAt,
    })),
    connectionStatuses: status.connectionStatuses.map((connection) => ({
      connectionId: connection.connectionId,
      isActive: connection.isActive,
      consentExpired: connection.consentExpired,
      consentExpiringSoon: connection.consentExpiringSoon,
      daysRemaining: connection.daysRemaining,
    })),
  };
}
