import { utcInstant } from '../date-ranges';
import { MS_PER_DAY } from '../periods/period-enumerator';

export const daysBetween = ({ from, until }: { from: string; until: string }): number =>
  Math.round((utcInstant({ date: until }).getTime() - utcInstant({ date: from }).getTime()) / MS_PER_DAY);

/** Today counts as elapsed, clamped to the period. */
export const elapsedFraction = ({ start, end, today }: { start: string; end: string; today: string }): number => {
  const totalDays = daysBetween({ from: start, until: end });
  if (totalDays <= 0) return 0;
  const day = Math.min(totalDays, Math.max(0, daysBetween({ from: start, until: today }) + 1));
  return day / totalDays;
};

const median = ({ values }: { values: number[] }): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

export interface PriorPeriodSpend {
  days: number;
  /** Minor units, expense positive, by day offset from the period start. */
  spend: { offset: number; amount: number }[];
}

/** `null` with fewer than two periods that had any net spend. */
export const historyPercent = ({
  periods,
  fraction,
}: {
  periods: PriorPeriodSpend[];
  fraction: number;
}): number | null => {
  const shares = periods.flatMap(({ days, spend }) => {
    const total = spend.reduce((sum, entry) => sum + entry.amount, 0);
    if (total <= 0) return [];
    // The epsilon keeps float noise in `day / totalDays * days` from rounding up a whole day.
    const throughDay = Math.ceil(fraction * days - 1e-9);
    const spent = spend.filter((entry) => entry.offset < throughDay).reduce((sum, entry) => sum + entry.amount, 0);
    return [Math.min(1, Math.max(0, spent / total))];
  });
  return shares.length >= 2 ? median({ values: shares }) * 100 : null;
};

/** Payments due so far plus an even spread of the funding they don't take. `null` when nothing is scheduled. */
export const schedulePercent = ({
  occurrences,
  today,
  funded,
  fraction,
}: {
  /** Minor units, expense positive. */
  occurrences: { date: string; amount: number }[];
  today: string;
  funded: number;
  fraction: number;
}): number | null => {
  const total = occurrences.reduce((sum, entry) => sum + entry.amount, 0);
  if (total <= 0 || funded <= 0) return null;
  const due = occurrences.filter((entry) => entry.date <= today).reduce((sum, entry) => sum + entry.amount, 0);
  const expected = due + Math.max(0, funded - total) * fraction;
  return Math.min(100, (expected / funded) * 100);
};

export const roundPercent = ({ value }: { value: number }): number => Math.round(value * 100) / 100;
