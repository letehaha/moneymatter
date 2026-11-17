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
}

export interface PortfolioValueHistoryModel {
  /** The portfolio's display currency when it has a rate, otherwise the user's base currency. */
  currencyCode: string;
  /** Ascending by date. */
  points: PortfolioValueHistoryPointModel[];
}
