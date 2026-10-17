import { Money } from '@common/types/money';
import { utcDayKey } from '@services/loans/anchor-day';

/**
 * Replay a loan's post-anchor payment legs into a per-day outstanding-balance
 * series: the anchor snapshot followed by one cumulative end-of-day point per
 * calendar day that has legs. Both the native-currency history endpoint and the
 * base-currency Balances rebuild run the same walk — `pickMinor` selects which
 * amount (nominal vs. ref) each leg contributes, and `openingBalance` is the
 * matching anchor snapshot; everything else about the walk is identical, so the
 * two currencies can never disagree on day grouping, ordering, or the zero floor.
 *
 * Legs are grouped by UTC calendar day (`utcDayKey`) because that is exactly how
 * the SQL `DATE("time") >= anchorDate` filter classifies them in a UTC database;
 * a server-local day would disagree near midnight on non-UTC servers. A leg that
 * classifies before the anchor is folded onto the anchor day — an invariant
 * guard so no point ever lands ahead of the series start.
 *
 * Balances are stored negative (liability); income legs add toward zero. A batch
 * that overshoots the owed amount would push the balance positive (credit), but a
 * loan never carries credit, so each running balance is floored at zero.
 */
export const replayLoanOutstanding = <TLeg extends { time: Date | string }>({
  legs,
  anchorDate,
  openingBalance,
  decimals,
  pickMinor,
}: {
  legs: TLeg[];
  /** yyyy-MM-dd inclusive boundary; the opening balance is the outstanding before this day's payments. */
  anchorDate: string;
  openingBalance: Money;
  /** Decimals of the currency the opening balance and the picked amounts are in (loan currency for native, base currency for base). */
  decimals: number;
  /** Minor units (at `decimals`) this leg contributes to the outstanding — `amount` for native currency, `refAmount` for base. */
  pickMinor: ({ leg }: { leg: TLeg }) => number;
}): { date: string; balance: Money }[] => {
  const minorByDay = new Map<string, number>();
  for (const leg of legs) {
    const legDay = utcDayKey({ date: leg.time });
    const day = legDay < anchorDate ? anchorDate : legDay;
    minorByDay.set(day, (minorByDay.get(day) ?? 0) + pickMinor({ leg }));
  }

  // Anchor point first (same-day payments fold in — the boundary is inclusive),
  // then one cumulative point per later day with legs.
  const series: { date: string; balance: Money }[] = [];
  let runningBalance = openingBalance;
  if (!minorByDay.has(anchorDate)) {
    series.push({ date: anchorDate, balance: runningBalance });
  }
  for (const day of [...minorByDay.keys()].toSorted()) {
    runningBalance = runningBalance.add(Money.fromMinorUnits({ value: minorByDay.get(day)!, decimals }));
    if (runningBalance.isPositive()) runningBalance = Money.zero();
    series.push({ date: day, balance: runningBalance });
  }

  return series;
};
