import { ACCOUNT_STATUSES, API_ERROR_CODES, type RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';

import { enqueueAccountSync } from './account-sync-queue';
import { type AccountWithConnection, getUserBankAccounts } from './get-user-sync-status';
import { shouldTriggerAutoSync, updateLastAutoSync } from './sync-status-tracker';

interface SyncResult {
  totalAccounts: number;
  queuedAccounts: number;
}

/**
 * Queue a transaction sync for every bank-connected account of a user.
 * Returns as soon as the jobs are queued — the frontend polls /sync/status,
 * which the providers update as each account moves SYNCING → COMPLETED/FAILED.
 * Records the last-sync time only when every job was queued, so a failed run
 * is retried by the next sync attempt instead of being throttled.
 */
export async function syncAllUserAccounts(userId: number): Promise<SyncResult> {
  const accounts = await getUserBankAccounts(userId);

  if (accounts.length === 0) {
    await recordLastSync({ userId });
    return { totalAccounts: 0, queuedAccounts: 0 };
  }

  // Group by connection so batch-capable providers (e.g. SimpleFIN) sync the
  // whole connection in one windowed pass instead of a per-account fan-out —
  // important for providers with a tight daily request budget.
  const accountsByConnection = new Map<RecordId, AccountWithConnection[]>();
  for (const account of accounts) {
    const connectionId = account.bankDataProviderConnectionId;
    const group = accountsByConnection.get(connectionId);
    if (group) group.push(account);
    else accountsByConnection.set(connectionId, [account]);
  }

  const connections = [...accountsByConnection];
  const outcomes = await Promise.allSettled(
    connections.map(([connectionId, connectionAccounts]) =>
      enqueueAccountSync({
        userId,
        connectionId,
        providerType: connectionAccounts[0]!.bankDataProviderConnection.providerType,
        accountIds: connectionAccounts.map((account) => account.id),
      }),
    ),
  );

  let queuedAccounts = 0;
  let firstError: unknown;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') {
      queuedAccounts += connections[index]![1].length;
      return;
    }
    logger.error({
      message: `[Sync Manager] Failed to queue sync for connection ${connections[index]![0]}`,
      error: outcome.reason as Error,
    });
    firstError ??= outcome.reason;
  });

  if (firstError) throw firstError;

  await recordLastSync({ userId });

  return { totalAccounts: accounts.length, queuedAccounts };
}

// The jobs are already queued, so a failed write costs one extra sync, not a failed request.
async function recordLastSync({ userId }: { userId: number }): Promise<void> {
  try {
    await updateLastAutoSync(userId);
  } catch (error) {
    logger.error({ message: `[Sync Manager] Failed to record last sync for user ${userId}`, error: error as Error });
  }
}

export async function queueConnectionSync({
  userId,
  connectionId,
}: {
  userId: number;
  connectionId: RecordId;
}): Promise<SyncResult> {
  const connection = await findOrThrowNotFound({
    query: BankDataProviderConnections.findOne({ where: { id: connectionId, userId } }),
    message: t({ key: 'errors.connectionNotFound' }),
    code: API_ERROR_CODES.notFound,
  });

  // An inactive connection cannot reach its provider, so a queued job could only fail.
  if (!connection.isActive) return { totalAccounts: 0, queuedAccounts: 0 };

  const accounts = await Accounts.findAll({
    where: { userId, bankDataProviderConnectionId: connectionId, status: ACCOUNT_STATUSES.active },
    attributes: ['id'],
  });
  const accountIds = accounts.map((account) => account.id);

  await enqueueAccountSync({ userId, connectionId, providerType: connection.providerType, accountIds });

  return { totalAccounts: accountIds.length, queuedAccounts: accountIds.length };
}

/**
 * Check if auto-sync should be triggered and execute if needed
 * Returns sync result if sync was triggered, null if skipped
 */
export async function checkAndTriggerAutoSync(userId: number): Promise<SyncResult | null> {
  // A base-currency recalculation is rewriting this user's ref* amounts; kicking
  // a fresh sync now would race the migration and commit old-base rows. Skip —
  // the next /sync/check tick after the lock clears triggers it.
  if (await isBaseCurrencyChangeLocked({ userId })) {
    return null;
  }

  const shouldSync = await shouldTriggerAutoSync(userId);

  if (!shouldSync) {
    return null;
  }

  return syncAllUserAccounts(userId);
}
