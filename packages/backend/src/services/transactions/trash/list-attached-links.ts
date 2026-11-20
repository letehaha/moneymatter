import { SUBSCRIPTION_LINK_STATUS, TRANSACTION_DELETION_REASON, type TrashLinkPreview } from '@bt/shared/types';
import Payees from '@models/payees.model';
import RefundTransactions from '@models/refund-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import TrackerTransactions from '@models/tracker-transactions.model';
import Trackers from '@models/trackers.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import TransactionGroups from '@models/transaction-groups.model';
import { findTransactions } from '@models/transactions-query';
import { getAccessibleTrackerIdsForUser } from '@services/sharing/auth/get-accessible-tracker-ids.service';
import { Op } from 'sequelize';

const toMap = <T extends { id: string }>({ rows }: { rows: T[] }) =>
  new Map<string, T>(rows.map((row) => [row.id, row]));

/**
 * The links still attached to these trashed rows, keyed by row id. A trashed row can carry
 * another user's links (shared account, household twin); only links the caller can see are listed.
 */
export const listAttachedLinks = async ({
  userId,
  transactionIds,
}: {
  userId: number;
  transactionIds: string[];
}): Promise<Map<string, TrashLinkPreview[]>> => {
  const result = new Map<string, TrashLinkPreview[]>();
  if (!transactionIds.length) return result;

  const where = { transactionId: { [Op.in]: transactionIds } };
  const [refunds, trackerLinks, groupItems, subscriptionLinks, periods, accessibleTrackerIds] = await Promise.all([
    RefundTransactions.findAll({
      where: {
        userId,
        [Op.or]: [{ originalTxId: { [Op.in]: transactionIds } }, { refundTxId: { [Op.in]: transactionIds } }],
      },
      attributes: ['originalTxId', 'refundTxId'],
    }),
    TrackerTransactions.findAll({ where, attributes: ['trackerId', 'transactionId'] }),
    TransactionGroupItems.findAll({ where, attributes: ['groupId', 'transactionId'] }),
    SubscriptionTransactions.findAll({
      where: { ...where, status: SUBSCRIPTION_LINK_STATUS.active },
      attributes: ['subscriptionId', 'transactionId'],
    }),
    SubscriptionPeriods.findAll({ where, attributes: ['transactionId', 'subscriptionId', 'dueDate'] }),
    getAccessibleTrackerIdsForUser({ userId }),
  ]);

  const trashedIds = new Set(transactionIds);
  const accessibleTrackerIdSet = new Set(accessibleTrackerIds);

  const [counterparts, trackers, groups, subscriptions] = await Promise.all([
    findTransactions({
      where: { id: { [Op.in]: refunds.flatMap((link) => [link.originalTxId, link.refundTxId]).filter(Boolean) } },
      attributes: ['id', 'note', 'deletedAt', 'deletionReason'],
      include: [{ model: Payees, as: 'payee', attributes: ['name'], required: false }],
      paranoid: false,
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
    }).then((rows) => toMap({ rows })),
    Trackers.findAll({
      where: {
        id: { [Op.in]: trackerLinks.map((link) => link.trackerId).filter((id) => accessibleTrackerIdSet.has(id)) },
      },
      attributes: ['id', 'name'],
    }).then((rows) => toMap({ rows })),
    TransactionGroups.findAll({
      where: { userId, id: { [Op.in]: groupItems.map((item) => item.groupId) } },
      attributes: ['id', 'name'],
    }).then((rows) => toMap({ rows })),
    Subscriptions.findAll({
      where: {
        userId,
        id: { [Op.in]: [...subscriptionLinks, ...periods].map((link) => link.subscriptionId) },
      },
      attributes: ['id', 'name'],
    }).then((rows) => toMap({ rows })),
  ]);

  const add = ({ id, link }: { id: string; link: TrashLinkPreview }) =>
    result.set(id, [...(result.get(id) ?? []), link]);

  for (const link of refunds) {
    for (const id of [link.originalTxId, link.refundTxId]) {
      if (!id || !trashedIds.has(id)) continue;
      const counterpart = counterparts.get((link.refundTxId === id ? link.originalTxId : link.refundTxId) ?? '');
      add({
        id,
        link: {
          kind: 'refund',
          label: counterpart?.note || counterpart?.payee?.name || null,
          counterpartInTrash: counterpart?.deletionReason === TRANSACTION_DELETION_REASON.trash,
        },
      });
    }
  }
  for (const link of trackerLinks) {
    const tracker = trackers.get(link.trackerId);
    if (!tracker) continue;
    add({ id: link.transactionId, link: { kind: 'tracker', label: tracker.name, counterpartInTrash: false } });
  }
  for (const item of groupItems) {
    const group = groups.get(item.groupId);
    if (!group) continue;
    add({ id: item.transactionId, link: { kind: 'group', label: group.name, counterpartInTrash: false } });
  }
  for (const link of subscriptionLinks) {
    const subscription = subscriptions.get(link.subscriptionId);
    if (!subscription) continue;
    add({
      id: link.transactionId,
      link: { kind: 'subscription', label: subscription.name, counterpartInTrash: false },
    });
  }
  for (const period of periods) {
    if (!subscriptions.has(period.subscriptionId)) continue;
    add({
      id: period.transactionId!,
      link: { kind: 'subscriptionPeriod', label: period.dueDate, counterpartInTrash: false },
    });
  }

  return result;
};
