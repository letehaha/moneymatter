import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, RecordId } from '@bt/shared/types';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Securities from '@models/investments/securities.model';
import { format } from 'date-fns';

/** Shared `yyyy-MM-dd` key for the rate/price lookup maps in this folder. */
export const formatDateKey = (date: Date | string): string => format(date, 'yyyy-MM-dd');

export interface CombinedBalanceHistoryItem {
  date: string;
  /**
   * Sum of all "real" asset account categories (cash, credit card, savings, etc.).
   * Vehicles, properties and loans are excluded so the line isn't dragged by a
   * valuation curve or liabilities — those get their own
   * `vehiclesBalance`/`propertiesBalance`/`loansBalance` fields.
   */
  accountsBalance: number;
  portfoliosBalance: number;
  venturesBalance: number;
  /** Sum of vehicle-account balances. Separated to avoid polluting accountsBalance. */
  vehiclesBalance: number;
  /** Sum of property-account balances. Separated to avoid polluting accountsBalance. */
  propertiesBalance: number;
  /** Sum of loan balances (stored negative), so adding it to totalBalance subtracts liabilities. */
  loansBalance: number;
  totalBalance: number;
}

/**
 * Raw (`raw: true`) projection of `InvestmentTransactions`. The replay loads a
 * user's FULL trade history (pre-window rows seed opening positions/cash), so
 * these rows skip model hydration — every Money getter materialized per row
 * across thousands of rows is a real memory cost on this hot dashboard path.
 * DECIMAL columns therefore arrive as Postgres decimal strings, not `Money`.
 */
export interface TransactionRow {
  portfolioId: RecordId;
  securityId: RecordId;
  category: INVESTMENT_TRANSACTION_CATEGORY;
  /** TIMESTAMPTZ — the pg driver parses it into a `Date`. */
  date: Date;
  /** DECIMAL(36,18) string, e.g. `"10.000000000000000000"`. */
  quantity: string;
  /** DECIMAL(20,10) string. Base-currency cost of the leg, fees included. */
  refAmount: string;
  currencyCode: string;
  /** DECIMAL(20,10) string. Absolute cash moved in `settlementCurrencyCode`. */
  settlementAmount: string;
  settlementCurrencyCode: string;
}

export type TransferRow = Pick<
  PortfolioTransfers,
  'fromPortfolioId' | 'toPortfolioId' | 'amount' | 'currencyCode' | 'toCurrencyCode' | 'toAmount' | 'date'
>;

export type CurrentBalanceRow = Pick<PortfolioBalances, 'portfolioId' | 'currencyCode' | 'totalCash' | 'refTotalCash'>;

export type SecurityRow = Pick<Securities, 'id' | 'currencyCode' | 'assetClass'>;

export interface HoldingState {
  quantity: number;
  costBasis: number;
  currencyCode: string;
  assetClass: ASSET_CLASS;
}
