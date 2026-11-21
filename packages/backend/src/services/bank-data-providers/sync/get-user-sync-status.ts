import {
  ACCOUNT_STATUSES,
  type ConnectionNeedingReauth,
  type ConnectionStatusSummary,
  DEACTIVATION_REASON,
  type SyncAccountStatus,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { DatabaseError, Op, literal } from 'sequelize';

import { computeConsentValidity } from '../connection/consent-validity';
import { getConnectionBankName, resolveBankLogoDomain } from '../utils/bank-institutions';
import {
  type AccountSyncStatus,
  SyncStatus,
  getLastAutoSync,
  getMultipleAccountsSyncStatus,
} from './sync-status-tracker';

export interface AccountWithConnection extends Accounts {
  bankDataProviderConnection: BankDataProviderConnections;
}

/**
 * Shared catch-block guard: only a `DatabaseError` (the SQL query itself failing)
 * degrades to an empty list; any other error is a genuine bug and is re-thrown so
 * it surfaces as a failed request instead of looking like "nothing found".
 */
function toEmptyListOnDatabaseError({
  error,
  logMessage,
  userId,
}: {
  error: unknown;
  logMessage: string;
  userId: number;
}): never[] {
  if (!(error instanceof DatabaseError)) {
    throw error;
  }

  logger.error({ message: logMessage, error: error as Error }, { userId });
  return [];
}

/**
 * Get all bank-connected accounts for a user
 */
export async function getUserBankAccounts(userId: number): Promise<AccountWithConnection[]> {
  return Accounts.findAll({
    where: {
      userId,
      bankDataProviderConnectionId: { [Op.ne]: null },
      status: ACCOUNT_STATUSES.active,
    },
    include: [
      {
        model: BankDataProviderConnections,
        as: 'bankDataProviderConnection',
        where: { isActive: true },
        required: true,
      },
    ],
  }) as Promise<AccountWithConnection[]>;
}

/**
 * Get connections the user must reconnect: auto-deactivated after an upstream
 * auth failure (expired session, revoked consent), or brought in by a data
 * restore (credentials never travel, so a restored connection starts
 * deactivated). These don't appear in regular sync status because
 * `getUserBankAccounts` filters by `isActive: true` — but the user needs to see
 * them to know they should reconnect.
 *
 * Filters `metadata.deactivationReason` to AUTH_FAILURE or RESTORED so
 * connections the user disconnected manually stay hidden.
 *
 * Wrapped in try/catch so a DB-level failure of the raw JSONB query degrades
 * to an empty list instead of taking down the whole sync-status response —
 * the regular sync status is more important than the reauth banner. Only a
 * `DatabaseError` (the SQL query itself failing) is tolerated this way; any
 * other error is a genuine bug and is re-thrown so it surfaces as a failed
 * request instead of looking like "nothing needs reauth".
 */
async function getConnectionsNeedingReauth(userId: number): Promise<ConnectionNeedingReauth[]> {
  try {
    const connections = await BankDataProviderConnections.findAll({
      where: {
        userId,
        isActive: false,
        // Raw JSONB path query — Sequelize's nested object form is unreliable
        // across dialect versions for JSONB, so use the Postgres ->> operator
        // directly to compare the text value of metadata.deactivationReason.
        [Op.and]: [
          literal(
            `metadata->>'deactivationReason' IN ('${DEACTIVATION_REASON.AUTH_FAILURE}', '${DEACTIVATION_REASON.RESTORED}')`,
          ),
        ],
      },
      include: [
        {
          model: Accounts,
          as: 'accounts',
          where: { status: ACCOUNT_STATUSES.active },
          required: false,
        },
      ],
      order: [['updatedAt', 'DESC']],
    });

    return connections.map((conn) => {
      const bankName = getConnectionBankName({ metadata: conn.metadata });
      return {
        connectionId: conn.id,
        providerType: conn.providerType,
        providerName: conn.providerName,
        bankName,
        bankLogoDomain: resolveBankLogoDomain({ bankName }),
        accountsCount: conn.accounts?.length ?? 0,
        deactivatedAt: conn.updatedAt?.toISOString() ?? null,
      };
    });
  } catch (error) {
    return toEmptyListOnDatabaseError({ error, logMessage: 'Failed to load connectionsNeedingReauth', userId });
  }
}

/**
 * Get a consent-status summary for every connection the user has, so the
 * Accounts page can render Active / Expiring-soon / Expired badges without
 * fetching each connection's details separately.
 *
 * Wrapped in try/catch so a query failure degrades to an empty list instead of
 * taking down the whole sync-status response, mirroring getConnectionsNeedingReauth.
 * Only a `DatabaseError` (the SQL query itself failing) is tolerated this way; any
 * other error is a genuine bug (bad mapping, model/schema drift) and is re-thrown
 * so it surfaces as a failed request instead of rendering connections with no
 * consent badge.
 */
async function getConnectionStatuses(userId: number): Promise<ConnectionStatusSummary[]> {
  try {
    const connections = await BankDataProviderConnections.findAll({
      where: { userId },
      attributes: ['id', 'isActive', 'metadata'],
    });

    return connections.map((conn) => {
      const consent = computeConsentValidity({ metadata: conn.metadata });
      return {
        connectionId: conn.id,
        isActive: conn.isActive,
        consentExpired: consent?.isExpired ?? false,
        consentExpiringSoon: consent?.isExpiringSoon ?? false,
        daysRemaining: consent?.daysRemaining ?? null,
      };
    });
  } catch (error) {
    return toEmptyListOnDatabaseError({ error, logMessage: 'Failed to load connectionStatuses', userId });
  }
}

/**
 * Get sync status for all user's bank accounts
 */
export async function getUserAccountsSyncStatus(userId: number): Promise<{
  lastSyncAt: number | null;
  accounts: Array<AccountSyncStatus & SyncAccountStatus>;
  connectionsNeedingReauth: ConnectionNeedingReauth[];
  connectionStatuses: ConnectionStatusSummary[];
  summary: {
    total: number;
    syncing: number;
    queued: number;
    completed: number;
    failed: number;
    idle: number;
  };
}> {
  const accounts = await getUserBankAccounts(userId);
  const accountIds = accounts.map((a) => a.id);

  const [statuses, lastSyncAt, connectionsNeedingReauth, connectionStatuses] = await Promise.all([
    getMultipleAccountsSyncStatus(accountIds),
    getLastAutoSync(userId),
    getConnectionsNeedingReauth(userId),
    getConnectionStatuses(userId),
  ]);

  const summary = { total: 0, syncing: 0, queued: 0, completed: 0, failed: 0, idle: 0 };

  // Paired by index: a status parsed from Redis carries its own `accountId`, which nothing checks against the key.
  const enrichedStatuses = statuses.map((status, i) => {
    const account = accounts[i]!;

    summary.total++;
    switch (status.status) {
      case SyncStatus.SYNCING:
        summary.syncing++;
        break;
      case SyncStatus.QUEUED:
        summary.queued++;
        break;
      case SyncStatus.COMPLETED:
        summary.completed++;
        break;
      case SyncStatus.FAILED:
        summary.failed++;
        break;
      case SyncStatus.IDLE:
        summary.idle++;
        break;
    }

    const connection = account.bankDataProviderConnection;
    return {
      ...status,
      accountName: account.name || 'Unknown',
      providerType: connection.providerType,
      bankDataProviderConnectionId: connection.id,
      logoDomain: account.logoDomain,
      logoInitials: account.logoInitials,
      logoColor: account.logoColor,
      logoIcon: account.logoIcon,
      logoImageId: account.logoImageId,
      bankLogoDomain: resolveBankLogoDomain({ bankName: getConnectionBankName({ metadata: connection.metadata }) }),
    };
  });

  return {
    lastSyncAt,
    accounts: enrichedStatuses,
    connectionsNeedingReauth,
    connectionStatuses,
    summary,
  };
}
