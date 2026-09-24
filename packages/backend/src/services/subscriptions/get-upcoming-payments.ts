import { SUBSCRIPTION_LINK_STATUS, SUBSCRIPTION_PERIOD_STATUSES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { centsToApiDecimalOrNull } from '@common/types/money';
import Categories from '@models/categories.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import Transactions from '@models/transactions.model';
import { Includeable, Op } from 'sequelize';

import { calculateNextDueDate } from './calculate-next-due-date';
import { computeNextExpectedDate } from './get-subscriptions';

/** What `nextPaymentDate` reads: linked real payments and the earliest open period. */
export const scheduleInclude: Includeable[] = [
  {
    model: Transactions,
    through: {
      attributes: [],
      where: { status: SUBSCRIPTION_LINK_STATUS.active },
    },
    attributes: ['id', 'time'],
    where: { isPlanned: false },
    required: false,
  },
  {
    model: SubscriptionPeriods,
    where: {
      status: { [Op.in]: [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue] },
    },
    required: false,
    separate: true,
    order: [['dueDate', 'ASC']],
    limit: 1,
  },
];

type ScheduledSubscription = Pick<Subscriptions, 'startDate' | 'frequency' | 'transactions' | 'periods'>;

/** The earliest open period's dueDate; legacy subscriptions with no open period derive it. */
const nextPaymentDate = ({ subscription }: { subscription: ScheduledSubscription }): string | null =>
  subscription.periods?.[0]?.dueDate ??
  computeNextExpectedDate({
    startDate: subscription.startDate,
    frequency: subscription.frequency,
    transactions: subscription.transactions,
  });

/** Every payment date in `[from, until)`, stepping from the next one. Needs `scheduleInclude` loaded. */
export const paymentDatesInRange = ({
  subscription,
  from,
  until,
}: {
  subscription: ScheduledSubscription & Pick<Subscriptions, 'anchorDay' | 'endDate'>;
  from: string;
  until: string;
}): string[] => {
  const anchorDay = subscription.anchorDay ?? Number(subscription.startDate.slice(8, 10));
  const dates: string[] = [];

  for (
    let date = nextPaymentDate({ subscription });
    date !== null && date < until && (!subscription.endDate || date <= subscription.endDate);
    date = calculateNextDueDate({ currentDueDate: date, frequency: subscription.frequency, anchorDay })
  ) {
    if (date >= from) dates.push(date);
  }

  return dates;
};

interface GetUpcomingPaymentsParams {
  userId: number;
  limit?: number;
  type?: SUBSCRIPTION_TYPES;
}

export const getUpcomingPayments = async ({ userId, limit = 5, type }: GetUpcomingPaymentsParams) => {
  const where: Record<string, unknown> = {
    userId,
    isActive: true,
    expectedAmount: { [Op.ne]: null },
  };
  if (type) where.type = type;

  const subscriptions = await Subscriptions.findAll({
    where,
    include: [{ model: Categories, attributes: ['id', 'name', 'color'] }, ...scheduleInclude],
  });

  return subscriptions
    .map((sub) => {
      const plain = sub.toJSON();

      return {
        subscriptionId: plain.id,
        subscriptionName: plain.name,
        logoDomain: plain.logoDomain ?? null,
        logoInitials: plain.logoInitials ?? null,
        logoColor: plain.logoColor ?? null,
        expectedAmount: centsToApiDecimalOrNull(plain.expectedAmount),
        expectedCurrencyCode: plain.expectedCurrencyCode,
        transactionType: plain.transactionType,
        nextPaymentDate: nextPaymentDate({ subscription: plain }),
        frequency: plain.frequency,
        categoryName: plain.category?.name ?? null,
        categoryColor: plain.category?.color ?? null,
      };
    })
    .toSorted((a, b) => {
      if (!a.nextPaymentDate) return 1;
      if (!b.nextPaymentDate) return -1;
      return a.nextPaymentDate.localeCompare(b.nextPaymentDate);
    })
    .slice(0, limit);
};
