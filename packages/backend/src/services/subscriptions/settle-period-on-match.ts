import { SUBSCRIPTION_PERIOD_STATUSES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import SubscriptionPeriods from '@models/subscription-periods.model';
import type Subscriptions from '@models/subscriptions.model';
import { ConnectionError, DatabaseError, Op, UniqueConstraintError } from 'sequelize';

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
      status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue] },
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
    // The link already exists, so a refused settlement (e.g. the transaction already backs
    // a period) must not fail the match. Errors that abort the open Postgres transaction
    // still propagate, otherwise the COMMIT would silently become a rollback.
    if (error instanceof DatabaseError || error instanceof UniqueConstraintError || error instanceof ConnectionError) {
      throw error;
    }
    logger.error({
      message: `Failed to settle subscription "${subscription.name}" period ${period.dueDate} with transaction ${transactionId}`,
      error: error as Error,
    });
    return;
  }

  logger.info(
    `Subscription "${subscription.name}" period ${period.dueDate} settled by matched transaction ${transactionId}`,
  );
};
