import { toUtcDateString } from '@common/utils/date';

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

const earlier = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
};

/** `null` when nothing is left of `range` inside `bounds`. */
export const clipRange = ({ range, bounds }: { range: DateRange; bounds: DateRange }): DateRange | null => {
  const from = range.from > bounds.from ? range.from : bounds.from;
  const until = earlier(range.until, bounds.until);

  return until !== null && until <= from ? null : { from, until };
};
