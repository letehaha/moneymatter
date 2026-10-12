import { toUtcDateString } from '@common/utils/date';

import { MS_PER_DAY } from './periods/period-enumerator';

export const utcInstant = ({ date }: { date: string | Date }): Date =>
  new Date(`${toUtcDateString(date)}T00:00:00.000Z`);

export const addUtcDays = ({ date, days }: { date: string; days: number }): string =>
  toUtcDateString(new Date(utcInstant({ date }).getTime() + days * MS_PER_DAY));

/** Half-open day ranges `[from, until)`, `until: null` = open end. */
export interface DateRange {
  from: string;
  until: string | null;
}

export const toRange = ({ from, until }: { from: string | Date; until: string | Date | null }): DateRange => ({
  from: toUtcDateString(from),
  until: until === null ? null : toUtcDateString(until),
});

export const rangesIntersect = ({ a, b }: { a: DateRange; b: DateRange }): boolean =>
  (a.until === null || a.until > b.from) && (b.until === null || b.until > a.from);

export const covers = ({ range, start }: { range: DateRange; start: string }): boolean =>
  range.from <= start && (range.until === null || start < range.until);

const earlier = ({ a, b }: { a: string | null; b: string | null }): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
};

/** `null` when nothing is left of `range` inside `bounds`. */
export const clipRange = ({ range, bounds }: { range: DateRange; bounds: DateRange }): DateRange | null => {
  const from = range.from > bounds.from ? range.from : bounds.from;
  const until = earlier({ a: range.until, b: bounds.until });

  return until !== null && until <= from ? null : { from, until };
};

/** What is left of `range` once every cut is taken out of it. */
export const subtractRanges = ({ range, cuts }: { range: DateRange; cuts: DateRange[] }): DateRange[] =>
  cuts.reduce(
    (parts, cut) =>
      parts.flatMap((part): DateRange[] =>
        rangesIntersect({ a: part, b: cut })
          ? [
              ...(part.from < cut.from ? [{ from: part.from, until: cut.from }] : []),
              ...(cut.until !== null && (part.until === null || cut.until < part.until)
                ? [{ from: cut.until, until: part.until }]
                : []),
            ]
          : [part],
      ),
    [range],
  );
