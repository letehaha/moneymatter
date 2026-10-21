import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';

import { validateBulkDeleteTransactionsArgs } from '../../../mcp/tools/bulk-delete-transactions';
import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  assertConcreteTargets,
  keepVisibleRows,
  loadTransferTwins,
  loadUserTransactions,
  PreviewError,
  transactionsAffected,
  withTwinsAfterTheirLeg,
} from './preview-helpers';
import type { PreviewResolver } from './types';

const noTargets = () =>
  new PreviewError({
    messageKey: 'chat.cards.noTargets',
    message: 'No transaction of yours matches, so there is nothing to change',
  });

/**
 * Updates the given ids: loads them, shows the count and up to 10 sample rows. The changed fields are
 * the card's own fields (the arguments), so the preview holds only what the call touches.
 */
export const resolveBulkUpdateTransactions: PreviewResolver = async ({ userId, args, lock }) => {
  const requested = [...new Set((args.transactionIds ?? []) as string[])];
  assertConcreteTargets({ value: requested, what: 'transactions' });

  const rows = await loadUserTransactions({ userId, ids: requested, lock });
  if (rows.length === 0) throw noTargets();

  const missing = requested.length - rows.length;
  const ids = rows.map((row) => row.id);

  return {
    preview: {
      affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows }), count: rows.length }),
      counts: { transactionCount: rows.length },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: rows.map((row) => row.updatedAt) }),
      targetHash: hashTargetIds({ ids }),
      targetCount: rows.length,
    },
    affectedCount: rows.length,
    ...(missing > 0 ? { warnings: [{ key: 'chat.warnings.targetsMissing', params: { count: missing } }] } : {}),
  };
};

/**
 * Deletes by ids or by filters. Filters are validated exactly as the MCP handler validates them
 * (empty filters are refused), then resolved to the exact ids; those ids are frozen in the snapshot
 * and are what the approval deletes. The count, the sample and the typed phrase also cover the
 * transfer twins the delete removes.
 */
export const resolveBulkDeleteTransactions: PreviewResolver = async ({ userId, args, lock }) => {
  assertConcreteTargets({ value: args, what: 'transactions' });
  const target = validateBulkDeleteTransactionsArgs({ args: args as never });

  const ids = [...new Set(await resolveBulkTargetIds({ userId, ...target }))];
  if (ids.length === 0) throw noTargets();

  const rows = await loadUserTransactions({ userId, ids, lock });
  const twins = await loadTransferTwins({ rows, lock });
  const total = rows.length + twins.length;

  return {
    preview: {
      affected: transactionsAffected({
        rows: await keepVisibleRows({ userId, rows: withTwinsAfterTheirLeg({ rows, twins }) }),
        count: total,
      }),
      counts: { transactionCount: rows.length, transferTwinCount: twins.length },
    },
    snapshot: {
      targetIds: ids.toSorted(),
      targetHash: hashTargetIds({ ids }),
      targetCount: ids.length,
      updatedAt: latestUpdatedAt({ dates: [...rows, ...twins].map((row) => row.updatedAt) }),
    },
    affectedCount: total,
    ...(twins.length > 0
      ? { warnings: [{ key: 'chat.warnings.transferTwins', params: { count: twins.length } }] }
      : {}),
  };
};
