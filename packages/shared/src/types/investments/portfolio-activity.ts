import type { InvestmentTransactionModel } from './investment-transaction.model';
import type { PortfolioTransferModel } from './portfolio-models';

export const PORTFOLIO_ACTIVITY_FILTERS = {
  all: 'all',
  trades: 'trades',
  cash: 'cash',
  income: 'income',
} as const;
export type PortfolioActivityFilter = (typeof PORTFOLIO_ACTIVITY_FILTERS)[keyof typeof PORTFOLIO_ACTIVITY_FILTERS];

export type PortfolioActivityItem =
  | ({ kind: 'trade' } & InvestmentTransactionModel)
  | ({ kind: 'transfer' } & PortfolioTransferModel);

export interface PortfolioActivityResponse {
  data: PortfolioActivityItem[];
  pagination: { limit: number; offset: number; page: number; totalCount: number };
}
