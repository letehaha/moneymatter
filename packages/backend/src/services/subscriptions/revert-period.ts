import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ConflictError, NotFoundError } from '@js/errors';
import { isBankLinkedAccount } from '@models/accounts.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Transactions from '@models/transactions.model';
import { withTransaction } from '@services/common/with-transaction';
import { deleteTransaction } from '@services/transactions/delete-transaction';
import { Op } from 'sequelize';

import { findSubscriptionOrThrow } from './helpers';

interface RevertPeriodParams {
  userId: number;
  subscriptionId: string;
  periodId: string;
}

export const revertPeriod = withTransaction(async ({ userId, subscriptionId, periodId }: RevertPeriodParams) => {
  // Validates the subscription exists and belongs to the user (throws 404 otherwise).
  const subscription = await findSubscriptionOrThrow({ id: subscriptionId, userId });

  const period = await findOrThrowNotFound({
    query: SubscriptionPeriods.findOne({
      where: { id: periodId, subscriptionId },
    }),
    message: 'Subscription period not found.',
  });

  if (
    period.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming ||
    period.status === SUBSCRIPTION_PERIOD_STATUSES.overdue
  ) {
    throw new ConflictError({ message: 'This period is already active.' });
  }

  // Determine correct status based on due date: overdue if the due date has
  // already passed (treating the whole due day as valid), otherwise upcoming.
  const now = new Date();
  const dueDate = new Date(period.dueDate + 'T23:59:59Z');
  const newStatus = dueDate < now ? SUBSCRIPTION_PERIOD_STATUSES.overdue : SUBSCRIPTION_PERIOD_STATUSES.upcoming;

  // Remove the auto-created next open period to avoid a duplicate active period
  // once this one is re-opened. That successor belongs to the LATEST consumed
  // period: if any paid or skipped period sits after this one (greater dueDate),
  // the current open period follows that later period, so reverting this earlier
  // one must leave it untouched. dueDate is a DATEONLY 'YYYY-MM-DD' string, so
  // Op.gt compares chronologically and strict `>` excludes the reverted period
  // itself. The successor can be `upcoming` OR `overdue` (born overdue from a past
  // dueDate, or cron-flipped), so both count — matching on `upcoming` alone would
  // strand an overdue successor and leave two open periods.
  const laterConsumedPeriod = await SubscriptionPeriods.findOne({
    where: {
      subscriptionId,
      status: [SUBSCRIPTION_PERIOD_STATUSES.paid, SUBSCRIPTION_PERIOD_STATUSES.skipped],
      dueDate: { [Op.gt]: period.dueDate },
    },
  });

  if (!laterConsumedPeriod) {
    const newerOpenPeriod = await SubscriptionPeriods.findOne({
      where: {
        subscriptionId,
        status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue] },
      },
      order: [['dueDate', 'DESC']],
    });

    if (newerOpenPeriod && newerOpenPeriod.dueDate > period.dueDate) {
      await newerOpenPeriod.destroy();
    }
  }

  // An app-generated transaction (CREATE-mode pay) is owned by this period: undoing
  // the payment must delete it so the expense it booked is reversed and the account
  // balance returns to its pre-payment value. A user-linked transaction
  // (transactionAutoCreated === false) is never deleted — the user keeps their own
  // row, the period just stops pointing at it.
  if (period.transactionId != null && period.transactionAutoCreated) {
    const tx = await Transactions.findByPk(period.transactionId, { attributes: ['accountId', 'isPlanned'] });

    // A real transaction on a bank-linked account cannot be deleted, so it stays
    // and the period only stops pointing at it.
    if (tx && (tx.isPlanned || !(await isBankLinkedAccount({ id: tx.accountId })))) {
      try {
        // deleteTransaction joins the active transaction via `withTransaction`, so the
        // balance reversal commits/rolls back together with the period update below.
        await deleteTransaction({ id: period.transactionId, userId });
      } catch (error) {
        if (!(error instanceof NotFoundError)) {
          throw error;
        }
      }
    }
  }

  await period.update({
    status: newStatus,
    paidAt: null,
    transactionId: null,
    transactionAutoCreated: false,
  });

  // Reopening a consumed period un-finishes a completed installment, so clear its
  // completion and bring it back to active. Gated on `completedAt`, which only
  // installment-completion ever sets — a manually paused subscription has
  // `completedAt == null`, so its isActive toggle is never auto-resumed here.
  if (subscription.completedAt != null) {
    await subscription.update({ isActive: true, completedAt: null });
  }

  return period.reload();
});
