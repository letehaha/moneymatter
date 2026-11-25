/** `auto` sends the first point, the last point of each ISO week and the final point once there are more than 732 daily points (~2 years). */
export const PORTFOLIO_VALUE_HISTORY_INTERVALS = ['day', 'auto'] as const;
export type PortfolioValueHistoryInterval = (typeof PORTFOLIO_VALUE_HISTORY_INTERVALS)[number];

/** One day of `GET /investments/portfolios/:id/value-history`; money values are 2-dp decimal strings in the response's `currencyCode`. */
export interface PortfolioValueHistoryPointModel {
  /** YYYY-MM-DD */
  date: string;
  /** holdingsValue + cashValue */
  totalValue: string;
  holdingsValue: string;
  cashValue: string;
  /** Cost basis of the positions held on that day. */
  costBasis: string;
  /** Cumulative FIFO realized gain through that day. */
  realizedGain: string;
  /** Cumulative transfers into minus out of this portfolio, adjustments and same-portfolio exchanges excluded. */
  netDeposits: string;
  /** Cumulative time-weighted return since the first point, as a decimal fraction (0.0457 = 4.57%). Not a money value. */
  timeWeightedReturn: string;
}

export interface PortfolioValueHistoryModel {
  /** The portfolio's display currency when it has a rate, otherwise the user's base currency. */
  currencyCode: string;
  /** Ascending by date. */
  points: PortfolioValueHistoryPointModel[];
}
