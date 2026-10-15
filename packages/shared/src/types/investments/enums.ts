export enum SECURITY_PROVIDER {
  polygon = 'polygon',
  alphavantage = 'alphavantage',
  fmp = 'fmp',
  yahoo = 'yahoo',
  coingecko = 'coingecko',
  // custom provider that uses others for different operations because each provider
  // has limitations on a free plan
  composite = 'composite',
}

export enum ASSET_CLASS {
  cash = 'cash',
  crypto = 'crypto',
  fixed_income = 'fixed_income',
  options = 'options',
  stocks = 'stocks',
  other = 'other',
}

/**
 * Asset classes the product currently supports for user-facing search and
 * holding creation. Anything else is filtered from search results and rejected
 * by the createHolding endpoint. Bonds/mutual funds (fixed income), options,
 * cash, and "other" require dedicated UX/data flows that don't exist yet.
 */
export const SUPPORTED_ASSET_CLASSES: readonly ASSET_CLASS[] = [ASSET_CLASS.stocks, ASSET_CLASS.crypto] as const;

export enum INVESTMENT_TRANSACTION_CATEGORY {
  buy = 'buy',
  sell = 'sell',
  dividend = 'dividend',
  transfer = 'transfer',
  tax = 'tax',
  fee = 'fee',
  cancel = 'cancel',
  other = 'other',
}

/** Sell and dividend bring cash in, so their fee is subtracted from the stored `amount` instead of added. */
export const isCashInCategory = ({ category }: { category: `${INVESTMENT_TRANSACTION_CATEGORY}` }): boolean =>
  category === 'sell' || category === 'dividend';

export enum PORTFOLIO_TYPE {
  investment = 'investment',
  retirement = 'retirement',
  savings = 'savings',
  other = 'other',
}
