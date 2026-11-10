import { resolveRecurrenceStep, type RecurrenceInput } from '@bt/shared/subscriptions/recurrence';
import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS } from '@bt/shared/types';

const DAY_MS = 24 * 60 * 60 * 1000;

const FREQUENCY_INTERVAL_DAYS: Record<Exclude<SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_FREQUENCIES.custom>, number> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: 7,
  [SUBSCRIPTION_FREQUENCIES.biweekly]: 14,
  [SUBSCRIPTION_FREQUENCIES.monthly]: 30,
  [SUBSCRIPTION_FREQUENCIES.quarterly]: 90,
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: 180,
  [SUBSCRIPTION_FREQUENCIES.annual]: 365,
};

/** Days per unit of a custom step, on the same 30/365 scale as the preset table. */
const UNIT_INTERVAL_DAYS: Record<SUBSCRIPTION_INTERVAL_UNITS, number> = {
  [SUBSCRIPTION_INTERVAL_UNITS.day]: 1,
  [SUBSCRIPTION_INTERVAL_UNITS.week]: 7,
  [SUBSCRIPTION_INTERVAL_UNITS.month]: 30,
  [SUBSCRIPTION_INTERVAL_UNITS.year]: 365,
};

const intervalDays = ({ frequency, intervalUnit, intervalCount }: RecurrenceInput): number => {
  if (frequency !== SUBSCRIPTION_FREQUENCIES.custom) return FREQUENCY_INTERVAL_DAYS[frequency];
  const step = resolveRecurrenceStep({ frequency, intervalUnit, intervalCount });
  return UNIT_INTERVAL_DAYS[step.unit] * step.count;
};

/** Half the recurrence interval: how far from its dueDate a payment may land and still settle the period. */
export const matchToleranceDays = (recurrence: RecurrenceInput): number => Math.floor(intervalDays(recurrence) / 2);

const utcDayNumber = ({ date }: { date: Date }): number =>
  Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);

/**
 * The open period whose dueDate is nearest to the transaction's day, provided it lies
 * within the recurrence's tolerance window. The earlier dueDate wins a tie. Null when no
 * period qualifies.
 */
export const pickNearestOpenPeriod = <T extends { dueDate: string }>({
  periods,
  transactionTime,
  frequency,
  intervalUnit,
  intervalCount,
}: RecurrenceInput & {
  periods: T[];
  transactionTime: Date;
}): T | null => {
  const tolerance = matchToleranceDays({ frequency, intervalUnit, intervalCount });
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
