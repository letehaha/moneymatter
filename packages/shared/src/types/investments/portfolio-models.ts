import type { AccountModel } from '../accounts';
import type { CurrencyModel } from '../currencies';
import type { UserModel } from '../users';
import { PORTFOLIO_TYPE } from './enums';
import { HoldingModel } from './holding.model';
import { InvestmentTransactionModel } from './investment-transaction.model';

/**
 * How long a soft-deleted (trashed) portfolio is retained before the purge
 * cron hard-deletes it. Shared across backend (cron + service) and frontend
 * (trash UI copy) so the two can never silently drift.
 */
export const PORTFOLIO_TRASH_RETENTION_DAYS = 30;

export interface PortfolioBalanceModel {
  portfolioId: string;
  currencyCode: string;
  availableCash: string;
  totalCash: string;
  refAvailableCash: string;
  refTotalCash: string;
  createdAt: Date;
  updatedAt: Date;

  // Associations
  portfolio?: PortfolioModel;
  currency?: CurrencyModel;
}

export interface PortfolioModel {
  id: string;
  name: string;
  userId: number;
  portfolioType: PORTFOLIO_TYPE;
  description: string | null;
  /** Currency for displaying portfolio summary/stats. Null = user's base currency. */
  displayCurrencyCode: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Non-null when the portfolio is in trash awaiting purge. */
  deletedAt: Date | null;

  // Associations
  user?: UserModel;
  holdings?: HoldingModel[];
  investmentTransactions?: InvestmentTransactionModel[];
  balances?: PortfolioBalanceModel[];
}

export interface PortfolioTransferModel {
  id: string;
  userId: number;
  fromAccountId: string | null;
  toPortfolioId: string | null;
  fromPortfolioId: string | null;
  toAccountId: string | null;
  amount: string;
  refAmount: string;
  currencyCode: string;
  toCurrencyCode: string | null;
  toAmount: string | null;
  refToAmount: string | null;
  transactionId: string | null;
  metaData: Record<string, unknown> | null;
  /**
   * The transfer reconciles recorded cash to reality instead of recording money
   * that crossed the portfolio boundary, so contribution reporting skips it.
   */
  isAdjustment: boolean;
  /** False when portfolio cash already included this money, so cash balance and cash history skip it. */
  affectsCash: boolean;
  date: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Associations
  user?: UserModel;
  fromAccount?: AccountModel;
  toAccount?: AccountModel;
  fromPortfolio?: PortfolioModel;
  toPortfolio?: PortfolioModel;
  currency?: CurrencyModel;
  toCurrency?: CurrencyModel;
}
