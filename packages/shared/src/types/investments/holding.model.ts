import { PortfolioModel } from './portfolio-models';
import { SecurityModel } from './security.model';

export interface HoldingModel {
  portfolioId: string;
  securityId: string;
  quantity: string;
  costBasis: string;
  refCostBasis: string;
  currencyCode: string;
  excluded: boolean;
  security?: SecurityModel;
  portfolio?: PortfolioModel;
  // Dynamic calculated fields (only present when fetched with price data)
  latestPrice?: string;
  priceDate?: Date;
  marketValue?: string;
  refMarketValue?: string;
  // Gain/Loss fields (calculated in real-time)
  unrealizedGainValue?: string;
  unrealizedGainPercent?: string;
  realizedGainValue?: string;
  realizedGainPercent?: string;
  /** Sum of DIVIDEND transactions for this security in the portfolio, net of fees, in the holding's currency. */
  dividendIncome?: string;
  // Present only when the portfolio has a displayCurrencyCode: money values
  // above converted to that currency. Percent fields are ratios — unchanged.
  displayCurrencyCode?: string;
  displayCostBasis?: string;
  displayMarketValue?: string;
  displayUnrealizedGainValue?: string;
  displayRealizedGainValue?: string;
  displayDividendIncome?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
