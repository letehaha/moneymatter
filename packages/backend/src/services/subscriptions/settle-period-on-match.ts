import { SUBSCRIPTION_LINK_STATUS } from '@bt/shared/types';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import Subscriptions from '@models/subscriptions.model';
import { Op } from 'sequelize';

import { OPEN_STATUSES } from './ensure-next-period';
import { markPeriodPaid } from './mark-period-paid';
import { pickNearestOpenPeriod } from './period-match-window';
import { isPeriodSettlementSuppressed } from './period-settlement-context';

/**
 * After a rule match links a real (non-planned) transaction to a subscription, marks the
 * nearest open (unpaid, unskipped) period paid with it, in LINK mode. Does nothing when
 * the subscription has no open period inside the tolerance window, so the link alone stays.
 */
export const settleNearestOpenPeriod = async ({
  subscription,
  transactionId,
  transactionTime,
  userId,
}: {
  subscription: Subscriptions;
  transactionId: string;
  transactionTime: Date;
  userId: number;
}): Promise<void> => {
  if (isPeriodSettlementSuppressed()) return;

  const openPeriods = await SubscriptionPeriods.findAll({
    where: {
      subscriptionId: subscription.id,
      status: { [Op.in]: OPEN_STATUSES },
    },
    order: [['dueDate', 'ASC']],
  });

  const period = pickNearestOpenPeriod({
    periods: openPeriods,
    transactionTime,
    frequency: subscription.frequency,
  });
  if (!period) return;

  try {
    await markPeriodPaid({
      userId,
      subscriptionId: subscription.id,
      periodId: period.id,
      transactionId,
    });
  } catch (error) {
    // markPeriodPaid throws these refusals before any write, so the link can stand alone.
    // Anything else may follow a partial write and must fail the whole transaction.
    if (!(error instanceof ConflictError || error instanceof ValidationError || error instanceof NotFoundError)) {
      throw error;
    }
    logger.warn(
      `Skipped settling subscription "${subscription.name}" period ${period.dueDate} with transaction ${transactionId}: ${error.message}`,
    );
    return;
  }

  logger.info(
    `Subscription "${subscription.name}" period ${period.dueDate} settled by matched transaction ${transactionId}`,
  );
};

/**
 * A linked plan settles nothing until it is confirmed (edited to real, or merged with the
 * bank's row); then its money has moved, so it settles its open period like a rule match.
 */
export const settlePeriodOnConfirm = async ({
  transaction,
  userId,
}: {
  transaction: { id: string; time: Date; isPlanned: boolean };
  userId: number;
}): Promise<void> => {
  if (transaction.isPlanned) return;

  const link = await SubscriptionTransactions.findOne({
    where: { transactionId: transaction.id, status: SUBSCRIPTION_LINK_STATUS.active },
  });
  if (!link) return;

  const subscription = await Subscriptions.findOne({
    where: { id: link.subscriptionId, userId, isActive: true },
  });
  if (!subscription) return;

  const alreadySettled = await SubscriptionPeriods.findOne({ where: { transactionId: transaction.id } });
  if (alreadySettled) return;

  await settleNearestOpenPeriod({
    subscription,
    transactionId: transaction.id,
    transactionTime: transaction.time,
    userId,
  });
};
