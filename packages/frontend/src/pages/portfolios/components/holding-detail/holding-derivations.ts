import { utcDayKey } from '@/common/utils/date';
import type { InvestmentTransactionModel } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { addDays, compareAsc, format, isValid, parseISO } from 'date-fns';

import { getPeriodStartDate } from '../portfolio-hero/portfolio-hero-derivations';

export const HOLDING_CHART_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'] as const;
export type HoldingChartPeriod = (typeof HOLDING_CHART_PERIODS)[number];

export interface PricePoint {
  /** yyyy-MM-dd, UTC */
  date: string;
  close: number;
}

export interface Trade {
  id: string;
  /** yyyy-MM-dd, UTC */
  date: string;
  category: INVESTMENT_TRANSACTION_CATEGORY.buy | INVESTMENT_TRANSACTION_CATEGORY.sell;
  quantity: number;
  price: number;
  fees: number;
}

export interface OpenLot {
  id: string;
  date: string;
  quantity: number;
  /** Includes the buy's fees spread per share. */
  costPerShare: number;
  costBasis: number;
  /** Null when the holding has no price. */
  marketValue: number | null;
  gain: number | null;
  /** Fraction, 0.05 = 5%; null without a price or a cost. */
  gainPct: number | null;
}

export interface BuyTiming {
  averageBuyPrice: number;
  averageClose: number;
  /** Fraction, negative when the user bought below the average close. */
  difference: number;
  firstBuyDate: string;
}

/** One point per UTC day, the day's latest price, oldest first; rows with an invalid date are skipped. */
export const toPricePoints = ({
  prices,
}: {
  prices: { date: string | Date; priceClose: string | number }[];
}): PricePoint[] => {
  const latestByDay = new Map<string, { time: Date; close: number }>();
  for (const price of prices) {
    const close = Number(price.priceClose);
    const time = new Date(price.date);
    if (!(close > 0) || !isValid(time)) continue;
    const day = utcDayKey({ date: time });
    const latest = latestByDay.get(day);
    if (!latest || compareAsc(latest.time, time) <= 0) latestByDay.set(day, { time, close });
  }
  return Array.from(latestByDay, ([date, { close }]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
};

export const slicePricePoints = ({
  points,
  period,
  today,
}: {
  points: PricePoint[];
  period: HoldingChartPeriod;
  today: Date;
}): PricePoint[] => {
  const start = getPeriodStartDate({ period, today });
  return start ? points.filter((point) => point.date >= start) : points;
};

/** Buys and sells in FIFO order: oldest first, creation order breaking same-instant ties; invalid dates are skipped. */
export const getTrades = ({ transactions }: { transactions: InvestmentTransactionModel[] }): Trade[] =>
  transactions
    .filter(
      (tx) =>
        (tx.category === INVESTMENT_TRANSACTION_CATEGORY.buy || tx.category === INVESTMENT_TRANSACTION_CATEGORY.sell) &&
        Number(tx.quantity) > 0 &&
        tx.price !== null &&
        isValid(parseISO(tx.date)),
    )
    .sort(
      (a, b) =>
        compareAsc(parseISO(a.date), parseISO(b.date)) || compareAsc(new Date(a.createdAt), new Date(b.createdAt)),
    )
    .map((tx) => ({
      id: tx.id,
      date: utcDayKey({ date: tx.date }),
      category: tx.category as Trade['category'],
      quantity: Number(tx.quantity),
      price: Number(tx.price),
      fees: Number(tx.fees ?? 0),
    }));

export interface TradeDay {
  /** yyyy-MM-dd, UTC */
  date: string;
  kind: 'buy' | 'sell' | 'both';
  trades: Trade[];
  quantity: number;
  /** Quantity-weighted across the day's buys and sells. */
  averagePrice: number;
  boughtAmount: number;
  soldAmount: number;
}

/** One entry per day with trades, in the order the days first appear. */
export const groupTradesByDay = ({ trades }: { trades: Trade[] }): TradeDay[] => {
  const byDate = new Map<string, Trade[]>();
  for (const trade of trades) {
    const day = byDate.get(trade.date);
    if (day) day.push(trade);
    else byDate.set(trade.date, [trade]);
  }

  return Array.from(byDate, ([date, dayTrades]) => {
    let quantity = 0;
    let boughtAmount = 0;
    let soldAmount = 0;
    for (const trade of dayTrades) {
      quantity += trade.quantity;
      if (trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy) boughtAmount += trade.quantity * trade.price;
      else soldAmount += trade.quantity * trade.price;
    }
    const hasBuys = dayTrades.some((trade) => trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy);
    const hasSells = dayTrades.some((trade) => trade.category === INVESTMENT_TRANSACTION_CATEGORY.sell);
    return {
      date,
      kind: hasBuys && hasSells ? 'both' : hasBuys ? 'buy' : 'sell',
      trades: dayTrades,
      quantity,
      averagePrice: (boughtAmount + soldAmount) / quantity,
      boughtAmount,
      soldAmount,
    };
  });
};

// Float residue from partial sells (e.g. 0.1 + 0.2 - 0.3) must not surface as a lot.
const QUANTITY_EPSILON = 1e-9;

/**
 * Buy lots left after sells consume the oldest shares first. Overselling leaves a short that later
 * buys cover before opening a lot, like the backend's holding totals, so lots sum to the holding quantity.
 */
export const buildOpenLots = ({ trades, price }: { trades: Trade[]; price: number | null }): OpenLot[] => {
  const queue: { trade: Trade; remaining: number; costPerShare: number }[] = [];
  let short = 0;

  for (const trade of trades) {
    if (trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy) {
      const covered = Math.min(short, trade.quantity);
      short -= covered;
      const remaining = trade.quantity - covered;
      if (remaining > QUANTITY_EPSILON) {
        queue.push({ trade, remaining, costPerShare: trade.price + trade.fees / trade.quantity });
      }
      continue;
    }
    let toSell = trade.quantity;
    while (toSell > QUANTITY_EPSILON && queue.length > 0) {
      const oldest = queue[0]!;
      const sold = Math.min(toSell, oldest.remaining);
      oldest.remaining -= sold;
      toSell -= sold;
      if (oldest.remaining <= QUANTITY_EPSILON) queue.shift();
    }
    if (toSell > QUANTITY_EPSILON) short += toSell;
  }

  return queue.map(({ trade, remaining, costPerShare }) => {
    const costBasis = remaining * costPerShare;
    const marketValue = price === null ? null : remaining * price;
    const gain = marketValue === null ? null : marketValue - costBasis;
    return {
      id: trade.id,
      date: trade.date,
      quantity: remaining,
      costPerShare,
      costBasis,
      marketValue,
      gain,
      gainPct: gain !== null && costBasis > 0 ? gain / costBasis : null,
    };
  });
};

const MIN_TIMING_CLOSES = 5;
// Weekends and holidays mean the first close on record can trail the first buy by a few days.
const FIRST_CLOSE_TOLERANCE_DAYS = 7;

/**
 * Quantity-weighted average buy price against the mean daily close from the first buy to the
 * latest close. Null when the price history does not cover that span.
 */
export const getBuyTiming = ({ trades, points }: { trades: Trade[]; points: PricePoint[] }): BuyTiming | null => {
  const buys = trades.filter((trade) => trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy);
  const firstBuy = buys[0];
  const firstClose = points[0];
  if (!firstBuy || !firstClose) return null;

  const latestAllowedStart = format(addDays(parseISO(firstBuy.date), FIRST_CLOSE_TOLERANCE_DAYS), 'yyyy-MM-dd');
  if (firstClose.date > latestAllowedStart) return null;

  const span = points.filter((point) => point.date >= firstBuy.date);
  if (span.length < MIN_TIMING_CLOSES) return null;

  const quantity = buys.reduce((sum, buy) => sum + buy.quantity, 0);
  const averageBuyPrice = buys.reduce((sum, buy) => sum + buy.quantity * buy.price, 0) / quantity;
  const averageClose = span.reduce((sum, point) => sum + point.close, 0) / span.length;

  return {
    averageBuyPrice,
    averageClose,
    difference: averageBuyPrice / averageClose - 1,
    firstBuyDate: firstBuy.date,
  };
};
