import { type RecordId, TRACKER_STATUSES, TRACKER_SUGGESTION_STATUS, type TrackerSyncResponse } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { connection } from '@models/connection';
import TrackerSuggestions from '@models/tracker-suggestions.model';
import TrackerTransactions, { isRuleLinkMetadata } from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import { withTransaction } from '@services/common/with-transaction';
import { statsTransactions } from '@services/stats/stats-transactions';
import { subMinutes } from 'date-fns';
import { Op, Transaction, literal } from 'sequelize';

import { authorizeTrackerRead } from '../authorize-tracker-access';
import { acceptLinkedTransactions } from '../smart-tracking/suggestion-feedback';

const VISIT_SYNC_COOLDOWN_MINUTES = 5;

const findRuleMatchIds = async ({ tracker }: { tracker: Trackers }): Promise<Set<RecordId>> => {
  const trackerId = connection.sequelize.escape(tracker.id);
  // ponytail: a split matches by any split's category and the whole transaction is linked; exact once splits become transactions.
  const { rows } = await statsTransactions({
    access: { creator: tracker.userId },
    planned: 'exclude',
    refunds: 'ignore',
    window: { from: tracker.startDate ?? undefined, to: tracker.endDate ?? undefined },
    attributes: ['id'],
    where: {
      [Op.or]: [
        {
          categoryId: {
            [Op.in]: literal(`(SELECT "categoryId" FROM "TrackerCategories" WHERE "trackerId" = ${trackerId})`),
          },
        },
        {
          id: {
            [Op.in]: literal(
              `(SELECT s."transactionId" FROM "TransactionSplits" s JOIN "TrackerCategories" tc ON tc."categoryId" = s."categoryId" WHERE tc."trackerId" = ${trackerId})`,
            ),
          },
        },
        {
          id: {
            [Op.in]: literal(
              `(SELECT tt."transactionId" FROM "TransactionTags" tt JOIN "TrackerTags" r ON r."tagId" = tt."tagId" WHERE r."trackerId" = ${trackerId})`,
            ),
          },
        },
      ],
    },
  });
  return new Set(rows.map((row) => row.id));
};

/**
 * Links the owner's transactions matching the tracker's categories or tags, skipping rejected ones.
 * With cleanup on, also unlinks rule-added rows that stopped matching. A plain set difference with no
 * "changed since" cursor: tag writes don't touch `Transactions.updatedAt`, so a cursor would miss them.
 */
export const syncTrackerRules = withTransaction(
  async ({ trackerId }: { trackerId: string }): Promise<TrackerSyncResponse> => {
    const tracker = await Trackers.findByPk(trackerId, { lock: Transaction.LOCK.NO_KEY_UPDATE });
    // A never-synced archived tracker (e.g. restored from a legacy backup) still gets its one backfill.
    if (!tracker?.rulesEnabled || (tracker.status === TRACKER_STATUSES.archived && tracker.rulesSyncedAt)) {
      return { added: 0, removed: 0 };
    }

    const [matchIds, links, rejected] = await Promise.all([
      findRuleMatchIds({ tracker }),
      TrackerTransactions.findAll({ where: { trackerId }, attributes: ['transactionId', 'metadata'] }),
      TrackerSuggestions.findAll({
        where: { trackerId, status: TRACKER_SUGGESTION_STATUS.rejected },
        attributes: ['transactionId'],
      }),
    ]);

    const skipIds = new Set([...links, ...rejected].map((row) => row.transactionId));
    const toAdd = [...matchIds].filter((id) => !skipIds.has(id));
    const toRemove = tracker.rulesCleanup
      ? links
          .filter((link) => isRuleLinkMetadata({ metadata: link.metadata }) && !matchIds.has(link.transactionId))
          .map((link) => link.transactionId)
      : [];

    if (toAdd.length) {
      // Page visits and the cron can race; the primary key makes a second insert a no-op.
      await TrackerTransactions.bulkCreate(
        toAdd.map((transactionId) => ({ trackerId, transactionId, metadata: { source: 'rule' } })),
        { ignoreDuplicates: true },
      );
      await acceptLinkedTransactions({ trackerId, transactionIds: toAdd });
    }
    if (toRemove.length) {
      await TrackerTransactions.destroy({ where: { trackerId, transactionId: { [Op.in]: toRemove } } });
    }
    await tracker.update({ rulesSyncedAt: new Date() });

    return { added: toAdd.length, removed: toRemove.length };
  },
);

/** Called when the tracker page opens. Skips while the last sync is fresh. */
export const syncTrackerRulesOnVisit = async ({
  userId,
  trackerId,
}: {
  userId: number;
  trackerId: string;
}): Promise<TrackerSyncResponse> => {
  const { ownerUserId } = await authorizeTrackerRead({ userId, trackerId });
  const tracker = await findOrThrowNotFound({
    query: Trackers.findOne({ where: { id: trackerId, userId: ownerUserId }, attributes: ['rulesSyncedAt'] }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });
  if (tracker.rulesSyncedAt && tracker.rulesSyncedAt > subMinutes(new Date(), VISIT_SYNC_COOLDOWN_MINUTES)) {
    return { added: 0, removed: 0 };
  }
  return syncTrackerRules({ trackerId });
};
