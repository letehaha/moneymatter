import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import { namespace } from '@models/connection';
import type { Transaction } from 'sequelize';

import { refAmountCache, buildRefAmountCachePattern } from './ref-amount-cache';

/** Drops every cached converted amount of one user. Never throws: a stale entry only lives until its TTL. */
const clearUserRefAmountCache = async ({ userId }: { userId: number }): Promise<void> => {
  try {
    await refAmountCache.delete(buildRefAmountCachePattern({ userId }), true);
  } catch (error) {
    logger.error({ message: `Error clearing the ref_amount cache for user ${userId}`, error: error as Error });
    captureException({ error, context: { scope: 'clear-ref-amount-cache', userId } });
  }
};

/**
 * Drops the user's cached converted amounts once the surrounding database transaction commits, so a
 * reader that misses the cache right after sees the committed rates, and a rolled-back change leaves
 * the cache alone. Without an open transaction it clears at once.
 */
export const clearUserRefAmountCacheAfterCommit = ({ userId }: { userId: number }): void => {
  // `finished` ('commit' | 'rollback') is not on the public Transaction type; `withTransaction` reads it the same way.
  const transaction = namespace.get('transaction') as (Transaction & { finished?: string }) | undefined;

  if (transaction && !transaction.finished) {
    transaction.afterCommit(() => clearUserRefAmountCache({ userId }));
  } else {
    void clearUserRefAmountCache({ userId });
  }
};
