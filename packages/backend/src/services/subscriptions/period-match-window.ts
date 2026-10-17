import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const FREQUENCY_INTERVAL_DAYS: Record<SUBSCRIPTION_FREQUENCIES, number> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: 7,
  [SUBSCRIPTION_FREQUENCIES.biweekly]: 14,
  [SUBSCRIPTION_FREQUENCIES.monthly]: 30,
  [SUBSCRIPTION_FREQUENCIES.quarterly]: 90,
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: 180,
  [SUBSCRIPTION_FREQUENCIES.annual]: 365,
};

/** Half the frequency interval: how far from its dueDate a payment may land and still settle the period. */
export const matchToleranceDays = ({ frequency }: { frequency: SUBSCRIPTION_FREQUENCIES }): number =>
  Math.floor(FREQUENCY_INTERVAL_DAYS[frequency] / 2);

const utcDayNumber = ({ date }: { date: Date }): number =>
  Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);

/**
 * The open period whose dueDate is nearest to the transaction's day, provided it lies
 * within the frequency's tolerance window. The earlier dueDate wins a tie. Null when no
 * period qualifies.
 */
export const pickNearestOpenPeriod = <T extends { dueDate: string }>({
  periods,
  transactionTime,
  frequency,
}: {
  periods: T[];
  transactionTime: Date;
  frequency: SUBSCRIPTION_FREQUENCIES;
}): T | null => {
  const tolerance = matchToleranceDays({ frequency });
  const txDay = utcDayNumber({ date: transactionTime });

  let best: { period: T; distance: number } | null = null;
  for (const period of periods) {
    const distance = Math.abs(utcDayNumber({ date: new Date(period.dueDate + 'T00:00:00Z') }) - txDay);
    if (distance > tolerance) continue;
    if (!best || distance < best.distance || (distance === best.distance && period.dueDate < best.period.dueDate)) {
      best = { period, distance };
    }
  }

  return best?.period ?? null;
};
