import { BILLING_PROVIDERS, GIFT_DURATION_MONTHS, isEntitledSubscription } from '@bt/shared/types';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import { addMonths } from 'date-fns';

const holdsPaidTime = ({ row, now }: { row: BillingSubscriptions; now: Date }) =>
  isEntitledSubscription({ status: row.status, currentPeriodEndsAt: row.currentPeriodEndsAt, now: now.getTime() });

/** The end of every paid period the user holds or has queued, or `now` when there is none. */
export const latestPaidEnd = ({ rows, now }: { rows: BillingSubscriptions[]; now: Date }): Date =>
  rows
    .filter((row) => holdsPaidTime({ row, now }))
    .reduce((latest, row) => (row.currentPeriodEndsAt > latest ? row.currentPeriodEndsAt : latest), now);

export const giftPeriod = ({ startsAt }: { startsAt: Date }) => {
  const endsAt = addMonths(startsAt, GIFT_DURATION_MONTHS);
  return {
    currentPeriodStartsAt: startsAt,
    currentPeriodEndsAt: endsAt,
    scheduledChange: { action: 'cancel' as const, effectiveAt: endsAt.toISOString() },
  };
};

/**
 * Gifts that have not started run back to back from the end of the user's other paid
 * access, so a refunded or extended period moves them along with it.
 */
export async function requeueGifts({ userId }: { userId: number }): Promise<void> {
  const now = new Date();
  const rows = await BillingSubscriptions.findAll({ where: { userId }, order: [['currentPeriodStartsAt', 'ASC']] });
  const queued = rows.filter(
    (row) =>
      row.provider === BILLING_PROVIDERS.gift &&
      row.currentPeriodStartsAt !== null &&
      row.currentPeriodStartsAt > now &&
      holdsPaidTime({ row, now }),
  );
  if (!queued.length) return;

  let startsAt = latestPaidEnd({ rows: rows.filter((row) => !queued.includes(row)), now });
  for (const gift of queued) {
    const period = giftPeriod({ startsAt });
    if (gift.currentPeriodStartsAt!.getTime() !== startsAt.getTime()) await gift.update(period);
    startsAt = period.currentPeriodEndsAt;
  }
}
