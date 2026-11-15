import type { RecordId } from '@bt/shared/types';
import TransactionAutomations from '@models/transaction-automations.model';
import { scanAutomationMatches } from '@services/transaction-automations/preview';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import { assertConcreteTargets, forUpdate, targetNotFound, transactionsAffected } from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * Running a rule on existing transactions writes only to the rows that still match its conditions
 * (and are eligible), so the card lists those rows, found by the same scan the apply re-runs, and
 * counts the ids it will skip.
 */
export const resolveApplyTransactionAutomation: PreviewResolver = async ({ userId, args, lock }) => {
  const automationId = args.automationId as string;
  const requested = [...new Set(args.transactionIds as RecordId[])];
  assertConcreteTargets({ value: [automationId, ...requested], what: 'automation or transactions' });

  const rule = await TransactionAutomations.findOne({ where: { id: automationId, userId }, ...forUpdate({ lock }) });
  if (!rule) throw targetNotFound({ what: 'automation' });

  const { rows } = await scanAutomationMatches({ userId, conditions: rule.conditions, transactionIds: requested });
  const skipped = requested.length - rows.length;

  return {
    preview: {
      affected: transactionsAffected({ rows, count: rows.length }),
      counts: { matchedCount: rows.length, skippedCount: skipped },
    },
    snapshot: {
      updatedAt: latestUpdatedAt({ dates: [rule.updatedAt, ...rows.map((row) => row.updatedAt)] }),
      targetHash: hashTargetIds({ ids: rows.map((row) => row.id) }),
      targetCount: rows.length,
    },
    affectedCount: rows.length,
    ...(skipped > 0 ? { warnings: [{ key: 'chat.warnings.automationSkipped', params: { count: skipped } }] } : {}),
  };
};
