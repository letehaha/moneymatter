import { API_ERROR_CODES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { withTransaction } from '@root/services/common/with-transaction';
import { withLock } from '@services/common/lock';
import { retryOnDeadlock } from '@services/common/retry-on-deadlock';

import { bankProviderRegistry } from '../registry';

// Must outlive the 20 minute stale-sync threshold, or the lock expires while the account still reports SYNCING.
const SYNC_LOCK_TTL_SECONDS = 60 * 30;

/**
 * Throws LockedError when another sync holds any of the accounts.
 * Provider dedup is read-then-insert, so overlapping syncs import every row twice.
 */
export function withAccountSyncLock<R>({
  accountIds,
  fn,
}: {
  accountIds: [string, ...string[]];
  fn: () => Promise<R>;
}): Promise<R> {
  const locked = accountIds.reduce<() => Promise<R>>(
    (next, accountId) => withLock(`bank-sync:account:${accountId}`, next, { ttl: SYNC_LOCK_TTL_SECONDS }),
    fn,
  );

  return locked();
}

const runAccountSync = withTransaction(
  async ({ connectionId, userId, accountId }: { connectionId: string; userId: number; accountId: string }) => {
    // Re-loads connection + account by id to re-check ownership on every call,
    // keeping this safe as a standalone entry point. The resulting N+1 in the
    // auto-sync fan-out is by design (background work, runs after the response).
    const connection = await BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId: userId,
      },
    });

    if (!connection) {
      throw new NotFoundError({
        message: t({ key: 'errors.connectionNotFound' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    // Verify account belongs to user and is linked to this connection
    const account = await Accounts.findOne({
      where: {
        id: accountId,
        userId: userId,
        bankDataProviderConnectionId: connectionId,
      },
    });

    if (!account) {
      throw new NotFoundError({
        message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    const provider = bankProviderRegistry.get(connection.providerType);
    return provider.syncTransactions({ connectionId, systemAccountId: accountId, userId });
  },
);

// Two syncs of one user can deadlock on rows they both write (payees, transfer pairs).
// The retry stays inside the lock so another sync can't take the account in between.
export const syncTransactionsForAccount = (params: { connectionId: string; userId: number; accountId: string }) =>
  withAccountSyncLock({
    accountIds: [params.accountId],
    fn: () => retryOnDeadlock({ fn: () => runAccountSync(params) }),
  });
