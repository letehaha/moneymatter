import { RecordId, SUBSCRIPTION_LINK_STATUS } from '@bt/shared/types';
import type { ReconciliationActionResponse } from '@bt/shared/types/endpoints';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetTransactions from '@models/budget-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import {
  hasSettledStatus,
  isPreBookingRow,
} from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { detachLinks, loadReconcilableRows, softDeleteTransactions } from './helpers';

/**
 * Targets the removed rows' links move onto the survivor. Rejects with `key` when the survivor
 * already links elsewhere, or a single-valued link would receive several targets.
 */
const planOrReject = ({
  links,
  survivorId,
  single,
  key,
}: {
  links: { transactionId: RecordId; target: RecordId }[];
  survivorId: RecordId;
  single: boolean;
  key: string;
}): RecordId[] => {
  const survivorTargets = new Set(links.filter((l) => l.transactionId === survivorId).map((l) => l.target));
  const toMove = [...new Set(links.filter((l) => l.transactionId !== survivorId).map((l) => l.target))].filter(
    (target) => !survivorTargets.has(target),
  );

  if (toMove.length === 0) return [];
  if (survivorTargets.size > 0 || (single && toMove.length > 1)) {
    throw new ValidationError({ message: t({ key }) });
  }
  return toMove;
};

export const mergeTransactions = withTransaction(
  async ({
    userId,
    transactionIds,
    survivorId,
  }: {
    userId: number;
    transactionIds: RecordId[];
    survivorId: RecordId;
  }): Promise<ReconciliationActionResponse> => {
    if (!transactionIds.includes(survivorId)) {
      throw new ValidationError({ message: t({ key: 'transactions.reconciliation.survivorNotSelected' }) });
    }

    const rows = await loadReconcilableRows({ userId, transactionIds });

    if (new Set(rows.map((row) => row.accountId)).size > 1) {
      throw new ValidationError({ message: t({ key: 'transactions.reconciliation.differentAccounts' }) });
    }

    // Sync never upgrades a pending survivor while its soft-deleted booked twin holds the bank entry.
    const survivor = rows.find((row) => row.id === survivorId)!;
    if (
      isPreBookingRow({ tx: survivor }) &&
      rows.some((row) => row.id !== survivorId && hasSettledStatus({ tx: row }))
    ) {
      throw new ValidationError({ message: t({ key: 'transactions.reconciliation.survivorPending' }) });
    }

    const where = { transactionId: { [Op.in]: transactionIds } };
    const [budgetLinks, groupLinks, subscriptionLinks, periodLinks] = await Promise.all([
      BudgetTransactions.findAll({ where }),
      TransactionGroupItems.findAll({ where }),
      SubscriptionTransactions.findAll({ where: { ...where, status: SUBSCRIPTION_LINK_STATUS.active } }),
      SubscriptionPeriods.findAll({ where, attributes: ['id', 'transactionId'] }),
    ]);

    const budgetsToMove = planOrReject({
      links: budgetLinks.map((l) => ({ transactionId: l.transactionId, target: l.budgetId })),
      survivorId,
      single: false,
      key: 'transactions.reconciliation.budgetConflict',
    });
    const groupsToMove = planOrReject({
      links: groupLinks.map((l) => ({ transactionId: l.transactionId, target: l.groupId })),
      survivorId,
      single: true,
      key: 'transactions.reconciliation.groupConflict',
    });
    const subscriptionsToMove = planOrReject({
      links: subscriptionLinks.map((l) => ({ transactionId: l.transactionId, target: l.subscriptionId })),
      survivorId,
      single: true,
      key: 'transactions.reconciliation.subscriptionConflict',
    });
    const periodsToMove = planOrReject({
      links: periodLinks.map((l) => ({ transactionId: l.transactionId!, target: l.id })),
      survivorId,
      single: true,
      key: 'transactions.reconciliation.subscriptionConflict',
    });

    if (budgetsToMove.length) {
      await BudgetTransactions.bulkCreate(
        budgetsToMove.map((budgetId) => ({
          budgetId,
          transactionId: survivorId,
          metadata: budgetLinks.find((l) => l.budgetId === budgetId)!.metadata,
        })),
      );
    }
    if (groupsToMove.length) {
      await TransactionGroupItems.create({ groupId: groupsToMove[0]!, transactionId: survivorId });
    }
    if (subscriptionsToMove.length) {
      const subscriptionId = subscriptionsToMove[0]!;
      const link = subscriptionLinks.find((l) => l.subscriptionId === subscriptionId)!;
      // The survivor may hold an `unlinked` row for this subscription; the composite PK allows only one.
      await SubscriptionTransactions.destroy({ where: { subscriptionId, transactionId: survivorId } });
      await SubscriptionTransactions.create({
        subscriptionId,
        transactionId: survivorId,
        matchSource: link.matchSource,
        matchedAt: link.matchedAt,
      });
    }
    if (periodsToMove.length) {
      // The survivor was not generated for this period, so revert must not delete it.
      await SubscriptionPeriods.update(
        { transactionId: survivorId, transactionAutoCreated: false },
        { where: { id: periodsToMove[0]! } },
      );
    }

    const removedIds = transactionIds.filter((id) => id !== survivorId);
    await detachLinks({ transactionIds: removedIds });
    await softDeleteTransactions({ userId, transactionIds: removedIds, mergedIntoId: survivorId });

    return { removedIds };
  },
);
