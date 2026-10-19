import {
  AI_FEATURE,
  TRACKER_SUGGESTION_STATUS,
  type TrackerScanPausedReason,
  type TrackerSuggestionsResponse,
  hasServerAiEntitlement,
} from '@bt/shared/types';
import BudgetTransactions from '@models/budget-transactions.model';
import type Budgets from '@models/budget.model';
import TrackerSuggestions from '@models/tracker-suggestions.model';
import { findTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { resolveAIConfiguration } from '@services/ai';
import { isWithinAiAllowance } from '@services/ai/ai-allowance';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';
import { getConnectionInfos } from '@services/user-settings/ai-connections';
import { Op } from 'sequelize';

import { findOwnedTracker } from './find-owned-tracker';
import { getTrackerScanBlocker } from './run-tracker-scan';
import { getTrackerScanState } from './tracker-scan-queue';

const resolvePausedReason = async ({ budget }: { budget: Budgets }): Promise<TrackerScanPausedReason | null> => {
  if (!budget.aiEnabled) return null;

  const blocker = getTrackerScanBlocker({ budget, now: new Date() });
  if (blocker) return blocker;

  const userId = budget.userId;
  const feature = AI_FEATURE.trackerMatching;
  if (await resolveAIConfiguration({ userId, feature })) return null;

  if ((await getConnectionInfos({ userId })).length === 0) {
    const entitlements = await getEntitlementsByUserId({ userId });
    if (!hasServerAiEntitlement({ entitlements, feature })) return 'plan';
    if (!(await isWithinAiAllowance({ userId, entitlements }))) return 'allowance';
  }
  return 'unavailable';
};

export const getTrackerSuggestions = async ({
  userId,
  budgetId,
}: {
  userId: number;
  budgetId: string;
}): Promise<TrackerSuggestionsResponse<Transactions>> => {
  const budget = await findOwnedTracker({ userId, budgetId });

  const [pendingRows, matchedRows] = await Promise.all([
    TrackerSuggestions.findAll({
      where: { budgetId, status: TRACKER_SUGGESTION_STATUS.pending },
      order: [
        ['score', 'DESC'],
        ['createdAt', 'ASC'],
      ],
    }),
    // Rows an unlink or a manual link created carry score 0, so they are not AI matches.
    TrackerSuggestions.findAll({
      where: {
        budgetId,
        status: [TRACKER_SUGGESTION_STATUS.autoLinked, TRACKER_SUGGESTION_STATUS.accepted],
        score: { [Op.gt]: 0 },
      },
      attributes: ['id', 'transactionId', 'reason'],
    }),
  ]);

  const [transactions, stillLinked, scanState, pausedReason] = await Promise.all([
    pendingRows.length
      ? findTransactions({
          planned: 'include',
          access: { creator: userId },
          balanceAdjustments: 'include',
          completeness: 'all',
          where: { id: pendingRows.map((row) => row.transactionId) },
        })
      : ([] as Transactions[]),
    matchedRows.length
      ? BudgetTransactions.findAll({
          where: { budgetId, transactionId: matchedRows.map((row) => row.transactionId) },
          attributes: ['transactionId'],
        })
      : ([] as BudgetTransactions[]),
    getTrackerScanState({ budgetId }),
    resolvePausedReason({ budget }),
  ]);

  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const linkedIds = new Set(stillLinked.map((row) => row.transactionId));

  return {
    pending: pendingRows.flatMap((row) => {
      const transaction = transactionById.get(row.transactionId);
      return transaction ? [{ id: row.id, score: row.score, reason: row.reason, transaction }] : [];
    }),
    aiMatched: matchedRows
      .filter((row) => linkedIds.has(row.transactionId))
      .map((row) => ({ id: row.id, transactionId: row.transactionId, reason: row.reason })),
    scan: { ...scanState, lastScannedAt: budget.aiLastScannedAt, pausedReason },
  };
};
