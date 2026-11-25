import type {
  PortfolioAllocationEntryModel,
  PortfolioMaxDrawdownModel,
  PortfolioMonthlyMarketGainModel,
  PortfolioReturnPeriod,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import { MIN_HISTORY_DAYS } from '@services/investments/portfolios/return-constants';
import { differenceInCalendarDays, format, parseISO, subMonths, subYears } from 'date-fns';
import xirr from 'xirr';

const toDateKey = ({ date }: { date: Date }) => format(date, 'yyyy-MM-dd');
const toUtcDay = ({ date }: { date: string }) => parseISO(`${date}T00:00:00Z`);

export const toMoneyString = ({ amount }: { amount: number }): string =>
  Money.fromDecimal(amount).toNumber().toFixed(2);
export const toRatioString = ({ ratio }: { ratio: number }): string => ratio.toFixed(8);

export interface SeriesPoint {
  date: string;
  totalValue: number;
  netDeposits: number;
  timeWeightedReturn: number;
}

/** Measured on the TWR index, so a deposit can't hide a drop. */
export const computeMaxDrawdown = ({ points }: { points: SeriesPoint[] }): PortfolioMaxDrawdownModel | null => {
  let peak = { date: '', index: -Infinity };
  let worst: { drawdown: number; peak: typeof peak; troughDate: string } | null = null;

  for (const { date, timeWeightedReturn } of points) {
    const index = 1 + timeWeightedReturn;
    if (index > peak.index) peak = { date, index };
    const drawdown = peak.index > 0 ? index / peak.index - 1 : 0;
    if (drawdown < (worst?.drawdown ?? 0)) worst = { drawdown, peak, troughDate: date };
  }
  if (!worst) return null;

  const { drawdown, peak: worstPeak, troughDate } = worst;
  const recovered = points.find(
    ({ date, timeWeightedReturn }) => date > troughDate && 1 + timeWeightedReturn >= worstPeak.index,
  );
  return {
    value: toRatioString({ ratio: drawdown }),
    peakDate: worstPeak.date,
    troughDate,
    recoveredDate: recovered?.date ?? null,
  };
};

/** Each month's value change minus its net deposits, opening at the first point's close. */
export const computeMonthlyMarketGain = ({ points }: { points: SeriesPoint[] }): PortfolioMonthlyMarketGainModel[] => {
  const closes = new Map<string, SeriesPoint>();
  for (const point of points) closes.set(point.date.slice(0, 7), point);

  let opening = points[0];
  return Array.from(closes, ([month, close]) => {
    const gain = close.totalValue - opening!.totalValue - (close.netDeposits - opening!.netDeposits);
    opening = close;
    return { month, gain: toMoneyString({ amount: gain }) };
  });
};

export const buildReturnAnchors = ({ endDate }: { endDate: string }): Record<PortfolioReturnPeriod, string> => {
  const end = parseISO(endDate);
  return {
    '1M': toDateKey({ date: subMonths(end, 1) }),
    '3M': toDateKey({ date: subMonths(end, 3) }),
    '6M': toDateKey({ date: subMonths(end, 6) }),
    YTD: `${end.getFullYear() - 1}-12-31`,
    '1Y': toDateKey({ date: subYears(end, 1) }),
  };
};

/** Sums values per key and sorts by value, largest first. */
export const buildAllocation = <K extends string>({
  entries,
  total,
}: {
  entries: { key: K; label: string | null; value: number }[];
  total: number;
}): PortfolioAllocationEntryModel<K>[] => {
  const byKey = new Map<K, { label: string | null; value: number }>();
  for (const { key, label, value } of entries) {
    const existing = byKey.get(key);
    byKey.set(key, { label, value: (existing?.value ?? 0) + value });
  }
  return Array.from(byKey, ([key, { label, value }]) => ({
    key,
    label,
    value: toMoneyString({ amount: value }),
    weight: toRatioString({ ratio: total > 0 ? value / total : 0 }),
  })).toSorted((a, b) => Number(b.value) - Number(a.value));
};

/** Annualized XIRR: each day's net deposit as an outflow, the last value as the terminal inflow. */
export const computeMoneyWeightedReturn = ({ points }: { points: SeriesPoint[] }): string | null => {
  const flows: { amount: number; when: Date }[] = [];
  let firstFlowDate: string | null = null;
  let previousDeposits = 0;
  for (const { date, netDeposits } of points) {
    const flow = netDeposits - previousDeposits;
    previousDeposits = netDeposits;
    if (Math.abs(flow) < 0.005) continue;
    firstFlowDate ??= date;
    flows.push({ amount: -flow, when: toUtcDay({ date }) });
  }

  const last = points.at(-1);
  if (!last || !firstFlowDate) return null;
  if (differenceInCalendarDays(parseISO(last.date), parseISO(firstFlowDate)) < MIN_HISTORY_DAYS) return null;
  flows.push({ amount: last.totalValue, when: toUtcDay({ date: last.date }) });
  if (!flows.some((flow) => flow.amount > 0) || !flows.some((flow) => flow.amount < 0)) return null;

  try {
    const rate = xirr(flows);
    return Number.isFinite(rate) ? toRatioString({ ratio: rate }) : null;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('failed to converge')) throw error;
    logger.warn('Portfolio money-weighted return did not converge', { flowCount: flows.length });
    return null;
  }
};

// A sub-period opening below one unit of the display currency is residue, and dividing by it would swing the index.
const MIN_TWR_BASE = 1;

/**
 * Daily time-weighted return, measured on holdings plus positive cash with flows at the start of the day:
 * r = C_d / (C_{d-1} + F_d) - 1. Cash a buy pulls below zero counts as money brought in, and a sell
 * repaying it as money taken out.
 */
export const computeTimeWeightedReturns = ({
  days,
}: {
  days: { holdingsValue: number; cashValue: number; flow: number }[];
}): number[] => {
  let previousCapital = 0;
  let previousShortfall = 0;
  let growthIndex = 1;
  return days.map(({ holdingsValue, cashValue, flow }, dayIndex) => {
    const capital = holdingsValue + Math.max(cashValue, 0);
    const shortfall = Math.max(-cashValue, 0);
    const openingCapital = previousCapital + flow + shortfall - previousShortfall;
    if (dayIndex > 0 && openingCapital >= MIN_TWR_BASE && capital > 0) growthIndex *= capital / openingCapital;
    previousCapital = capital;
    previousShortfall = shortfall;
    return growthIndex - 1;
  });
};
