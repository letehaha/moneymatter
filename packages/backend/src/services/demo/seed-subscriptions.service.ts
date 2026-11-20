import {
  SUBSCRIPTION_LINK_STATUS,
  SUBSCRIPTION_MATCH_SOURCE,
  SUBSCRIPTION_PERIOD_STATUSES,
  SUBSCRIPTION_TYPES,
  type SubscriptionMatchingRules,
  asCents,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils/logger';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import { createSubscription } from '@services/subscriptions/create-subscription';
import { addMonths, format, getDaysInMonth, setDate, startOfDay, startOfMonth } from 'date-fns';

import { DEMO_CONFIG } from './demo-config';

/** One already-inserted demo transaction that paid a subscription. */
interface DemoSubscriptionPayment {
  subscriptionName: string;
  transactionId: string;
  dueDate: Date;
}

/**
 * Fraction of the expected amount the `between` matching rule accepts on either
 * side, so a demo charge that drifts a little still matches its subscription.
 */
const AMOUNT_TOLERANCE = 0.1;

/** Floor for the tolerance window so cheap subscriptions still get some slack. */
const MIN_TOLERANCE_CENTS = 100;

/** `dayOfMonth` inside `month`, pulled back to the last day when the month is shorter. */
export function clampDayToMonth({ month, dayOfMonth }: { month: Date; dayOfMonth: number }): Date {
  return setDate(month, Math.min(dayOfMonth, getDaysInMonth(month)));
}

/** First `dayOfMonth` strictly after `referenceDate`, rolling into next month when today already passed it. */
export function nextOccurrenceAfter({ referenceDate, dayOfMonth }: { referenceDate: Date; dayOfMonth: number }): Date {
  const thisMonth = clampDayToMonth({ month: referenceDate, dayOfMonth });
  if (startOfDay(thisMonth) > startOfDay(referenceDate)) return thisMonth;
  return clampDayToMonth({ month: addMonths(startOfMonth(referenceDate), 1), dayOfMonth });
}

/**
 * Seeds demo subscriptions and their payment history. Creation goes through
 * `createSubscription` so each gets a real open `SubscriptionPeriods` row,
 * making `currentPeriod` non-null and "Mark paid" reachable. History
 * bulk-inserts instead, skipping the per-period `markPeriodPaid` lookup and
 * write across ~7 subscriptions times ~36 months.
 */
export async function setupSubscriptions({
  userId,
  accountId,
  categoryMap,
  referenceDate,
  payments,
}: {
  userId: number;
  accountId: string;
  /** Maps a category key to its id. Subcategory keys look like `life/tv-streaming`. */
  categoryMap: Map<string, string>;
  referenceDate: Date;
  /** Already-inserted demo transactions that paid a subscription, oldest first. */
  payments: DemoSubscriptionPayment[];
}): Promise<void> {
  const paymentsByName = new Map<string, DemoSubscriptionPayment[]>();
  for (const payment of payments) {
    const bucket = paymentsByName.get(payment.subscriptionName);
    if (bucket) {
      bucket.push(payment);
    } else {
      paymentsByName.set(payment.subscriptionName, [payment]);
    }
  }

  const periodRows: {
    subscriptionId: string;
    dueDate: string;
    status: SUBSCRIPTION_PERIOD_STATUSES;
    paidAt: Date;
    transactionId: string;
    transactionAutoCreated: boolean;
  }[] = [];
  const linkRows: {
    subscriptionId: string;
    transactionId: string;
    matchSource: SUBSCRIPTION_MATCH_SOURCE;
    matchedAt: Date;
    status: SUBSCRIPTION_LINK_STATUS;
  }[] = [];

  // `SubscriptionTransactions.transactionId` is unique on its own, so one
  // transaction can back at most one subscription link.
  const linkedTransactionIds = new Set<string>();

  for (const config of DEMO_CONFIG.subscriptions) {
    const history = (paymentsByName.get(config.name) ?? []).toSorted(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
    );

    const openDueDate = format(nextOccurrenceAfter({ referenceDate, dayOfMonth: config.dayOfMonth }), 'yyyy-MM-dd');
    const firstPayment = history[0];
    const startDate = firstPayment ? format(firstPayment.dueDate, 'yyyy-MM-dd') : openDueDate;

    const toleranceCents = Math.max(Math.round(config.expectedAmount * AMOUNT_TOLERANCE), MIN_TOLERANCE_CENTS);
    const matchingRules: SubscriptionMatchingRules = {
      rules: [
        { field: 'note', operator: 'contains_any', value: [...config.matchKeywords] },
        {
          field: 'amount',
          operator: 'between',
          // Rule bounds are decimals; the config holds cents.
          value: {
            min: Money.fromCents(asCents(config.expectedAmount - toleranceCents)).toNumber(),
            max: Money.fromCents(asCents(config.expectedAmount + toleranceCents)).toNumber(),
          },
          currencyCode: DEMO_CONFIG.baseCurrency,
        },
      ],
    };

    const subscription = await createSubscription({
      userId,
      name: config.name,
      type: SUBSCRIPTION_TYPES.subscription,
      frequency: config.frequency,
      // The service takes a decimal; the config holds cents.
      expectedAmount: Money.fromCents(asCents(config.expectedAmount)).toNumber(),
      expectedCurrencyCode: DEMO_CONFIG.baseCurrency,
      startDate,
      // Passing a dueDate is what opens the first period and sets `anchorDay`.
      dueDate: openDueDate,
      accountId,
      categoryId: categoryMap.get(config.categoryKey) ?? null,
      // A supplied domain marks the row `logoSource: 'manual'`, so the resolver
      // worker skips it instead of doing a network lookup per demo user.
      logoDomain: config.logoDomain,
      matchingRules,
    });

    // usedDueDates starts with the open period's date, so history never lands
    // a paid row on the date the subscription is still waiting to be paid.
    const usedDueDates = new Set<string>([openDueDate]);

    for (const payment of history) {
      const dueDate = format(payment.dueDate, 'yyyy-MM-dd');
      if (usedDueDates.has(dueDate) || linkedTransactionIds.has(payment.transactionId)) continue;

      usedDueDates.add(dueDate);
      linkedTransactionIds.add(payment.transactionId);

      periodRows.push({
        subscriptionId: subscription.id,
        dueDate,
        status: SUBSCRIPTION_PERIOD_STATUSES.paid,
        paidAt: payment.dueDate,
        transactionId: payment.transactionId,
        transactionAutoCreated: false,
      });

      linkRows.push({
        subscriptionId: subscription.id,
        transactionId: payment.transactionId,
        matchSource: SUBSCRIPTION_MATCH_SOURCE.rule,
        matchedAt: payment.dueDate,
        status: SUBSCRIPTION_LINK_STATUS.active,
      });
    }
  }

  if (periodRows.length > 0) {
    await SubscriptionPeriods.bulkCreate(periodRows);
  }
  if (linkRows.length > 0) {
    await SubscriptionTransactions.bulkCreate(linkRows);
  }

  logger.info(
    `Created ${DEMO_CONFIG.subscriptions.length} demo subscriptions with ${periodRows.length} paid periods and ${linkRows.length} linked transactions`,
  );
}
