import {
  AI_FEATURE,
  TRACKER_SUGGESTION_STATUS,
  type TrackerScanPausedReason,
  type TrackerSuggestionsResponse,
  hasServerAiEntitlement,
} from '@bt/shared/types';
import TrackerSuggestions from '@models/tracker-suggestions.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import type Trackers from '@models/trackers.model';
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

const resolvePausedReason = async ({ tracker }: { tracker: Trackers }): Promise<TrackerScanPausedReason | null> => {
  if (!tracker.aiEnabled) return null;

  const blocker = getTrackerScanBlocker({ tracker, now: new Date() });
  if (blocker) return blocker;

  const userId = tracker.userId;
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
  trackerId,
}: {
  userId: number;
  trackerId: string;
}): Promise<TrackerSuggestionsResponse<Transactions>> => {
  const tracker = await findOwnedTracker({ userId, trackerId });

  const [pendingRows, rejectedRows, matchedRows] = await Promise.all([
    TrackerSuggestions.findAll({
      where: { trackerId, status: TRACKER_SUGGESTION_STATUS.pending },
      order: [
        ['score', 'DESC'],
        ['createdAt', 'ASC'],
      ],
    }),
    TrackerSuggestions.findAll({
      where: { trackerId, status: TRACKER_SUGGESTION_STATUS.rejected },
      order: [['resolvedAt', 'DESC']],
    }),
    // Rows an unlink or a manual link created carry score 0, so they are not AI matches.
    TrackerSuggestions.findAll({
      where: {
        trackerId,
        status: [TRACKER_SUGGESTION_STATUS.autoLinked, TRACKER_SUGGESTION_STATUS.accepted],
        score: { [Op.gt]: 0 },
      },
      attributes: ['id', 'transactionId', 'reason'],
    }),
  ]);

  const [transactions, stillLinked, scanState, pausedReason] = await Promise.all([
    pendingRows.length || rejectedRows.length
      ? findTransactions({
          planned: 'include',
          access: { creator: userId },
          balanceAdjustments: 'include',
          completeness: 'all',
          where: { id: [...pendingRows, ...rejectedRows].map((row) => row.transactionId) },
        })
      : ([] as Transactions[]),
    matchedRows.length
      ? TrackerTransactions.findAll({
          where: { trackerId, transactionId: matchedRows.map((row) => row.transactionId) },
          attributes: ['transactionId'],
        })
      : ([] as TrackerTransactions[]),
    getTrackerScanState({ trackerId }),
    resolvePausedReason({ tracker }),
  ]);

  const transactionById = new Map(transactions.map((tx) => [tx.id, tx]));
  const linkedIds = new Set(stillLinked.map((row) => row.transactionId));

  const withTransactions = ({ rows }: { rows: TrackerSuggestions[] }) =>
    rows.flatMap((row) => {
      const transaction = transactionById.get(row.transactionId);
      return transaction ? [{ id: row.id, score: row.score, reason: row.reason, transaction }] : [];
    });

  return {
    pending: withTransactions({ rows: pendingRows }),
    rejected: withTransactions({ rows: rejectedRows }),
    aiMatched: matchedRows
      .filter((row) => linkedIds.has(row.transactionId))
      .map((row) => ({ id: row.id, transactionId: row.transactionId, reason: row.reason })),
    scan: { ...scanState, lastScannedAt: tracker.aiLastScannedAt, pausedReason },
  };
};
