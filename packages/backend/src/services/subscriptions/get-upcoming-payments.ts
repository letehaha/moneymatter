import { SUBSCRIPTION_LINK_STATUS, SUBSCRIPTION_PERIOD_STATUSES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { centsToApiDecimalOrNull } from '@common/types/money';
import Categories from '@models/categories.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import Subscriptions from '@models/subscriptions.model';
import Transactions from '@models/transactions.model';
import { serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import { Includeable, Op } from 'sequelize';

import { calculateNextDueDate } from './calculate-next-due-date';
import { resolveNextExpectedDate } from './subscription-date.utils';

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

type ScheduledSubscription = Pick<
  Subscriptions,
  | 'startDate'
  | 'frequency'
  | 'intervalUnit'
  | 'intervalCount'
  | 'dueDate'
  | 'isActive'
  | 'endDate'
  | 'transactions'
  | 'periods'
>;

/** The earliest open period's dueDate; an unscheduled subscription derives it from its payments. */
const nextPaymentDate = ({ subscription }: { subscription: ScheduledSubscription }): string | null =>
  resolveNextExpectedDate({
    startDate: subscription.startDate,
    frequency: subscription.frequency,
    intervalUnit: subscription.intervalUnit,
    intervalCount: subscription.intervalCount,
    transactions: subscription.transactions,
    isActive: subscription.isActive,
    endDate: subscription.endDate,
    dueDate: subscription.dueDate,
    openPeriodDueDate: subscription.periods?.[0]?.dueDate ?? null,
  });

type StepSchedule = Pick<Subscriptions, 'endDate' | 'frequency' | 'intervalUnit' | 'intervalCount'>;

const datesInRange = ({
  subscription,
  first,
  anchorDay,
  from,
  until,
}: {
  subscription: StepSchedule;
  first: string | null;
  anchorDay: number;
  from: string;
  until: string;
}): string[] => {
  const dates: string[] = [];

  for (
    let date = first;
    date !== null && date < until && (!subscription.endDate || date <= subscription.endDate);
    date = calculateNextDueDate({
      currentDueDate: date,
      frequency: subscription.frequency,
      intervalUnit: subscription.intervalUnit,
      intervalCount: subscription.intervalCount,
      anchorDay,
    })
  ) {
    if (date >= from) dates.push(date);
  }

  return dates;
};

/** Every payment date in `[from, until)`, stepping from the next one. Needs `scheduleInclude` loaded. */
export const paymentDatesInRange = ({
  subscription,
  from,
  until,
}: {
  subscription: ScheduledSubscription & Pick<Subscriptions, 'anchorDay' | 'endDate'>;
  from: string;
  until: string;
}): string[] =>
  datesInRange({
    subscription,
    first: nextPaymentDate({ subscription }),
    anchorDay: subscription.anchorDay ?? Number(subscription.startDate.slice(8, 10)),
    from,
    until,
  });

/** Every date the schedule falls due in `[from, until)`, paid or not, stepping from its first due date. */
export const scheduleDatesInRange = ({
  subscription,
  from,
  until,
}: {
  subscription: StepSchedule & Pick<Subscriptions, 'startDate' | 'dueDate' | 'anchorDay'>;
  from: string;
  until: string;
}): string[] => {
  const first = subscription.dueDate ?? subscription.startDate;
  return datesInRange({
    subscription,
    first,
    anchorDay: subscription.anchorDay ?? Number(first.slice(8, 10)),
    from,
    until,
  });
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
        ...serializeLogoFields({ entity: plain }),
        expectedAmount: centsToApiDecimalOrNull(plain.expectedAmount),
        expectedCurrencyCode: plain.expectedCurrencyCode,
        transactionType: plain.transactionType,
        nextPaymentDate: nextPaymentDate({ subscription: plain }),
        frequency: plain.frequency,
        intervalUnit: plain.intervalUnit,
        intervalCount: plain.intervalCount,
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
