import { ASSET_CLASS, SECURITY_PROVIDER, SECURITY_TYPE } from './enums';
import { HoldingModel } from './holding.model';
import { InvestmentTransactionModel } from './investment-transaction.model';
import { SecurityPricingModel } from './security-pricing.model';

export interface SecurityModel {
  id: string;
  /**
   * The name of the security, typically the official name of the stock, bond,
   * or other financial instrument.
   */
  name: string | null;

  /**
   * The trading symbol or ticker associated with the security, used to uniquely
   * identify it on stock exchanges. NOT globally unique on its own – for
   * crypto, many coins share a symbol (e.g. "BTC"). Use providerSymbol +
   * providerName as the canonical identifier.
   */
  symbol: string | null;

  /**
   * The native identifier used by the data provider to address this security
   * in its API. For stock providers (Yahoo, Polygon, …) this equals `symbol`.
   * For CoinGecko this is the coin slug (e.g. "bitcoin" for BTC), since
   * CoinGecko symbols are not unique. Together with `providerName` it forms
   * the canonical lookup key for a Security row.
   */
  providerSymbol: string;

  /**
   * Symbol the price-sync pipeline queries instead of `providerSymbol`. Set
   * when `providerSymbol` identifies a venue with sparse historical data on
   * the provider (e.g. an ISIN-suffix UCITS registration listing like
   * `IE00B53L3W79.IR`) but the same fund trades on another exchange (`SXRT.DE`,
   * `MEUD.PA`, …) under a local ticker with full daily history. Same currency
   * as the row by construction so stored prices remain meaningful against
   * `currencyCode`. NULL for ordinary securities.
   */
  priceSourceSymbol: string | null;

  /**
   * The CUSIP number (Committee on Uniform Securities Identification Procedures) is a unique identifier
   * assigned to U.S. and Canadian securities for the purposes of facilitating clearing and settlement of trades.
   */
  cusip: string | null;

  /**
   * The ISIN number (International Securities Identification Number) is a unique code assigned to securities
   * internationally for uniform identification, which helps in reducing the risk of ambiguities in international trading.
   */
  isin: string | null;

  /**
   * (Applicable for derivative securities) The number of shares or units
   * represented by a single contract, commonly used in options and futures trading.
   */
  sharesPerContract: string | null;

  /**
   * The ISO currency code representing the currency in which the transactions
   * will be conducted. For cryptocurrencies, this code refers to
   * the specific currency linked to it (e.g., USD for BTC-USD, EUR for BTC-EUR).
   */
  currencyCode: string;

  /**
   * Crypto currency code for crypto securities. Since ticker represents not
   * just a crypto token, but an actual pair, we need to store symbol separately
   * (e.g., BTC for BTC-USD, BTC for BTC-EUR).
   */
  cryptoCurrencyCode: string | null;

  /**
   * The timestamp indicating the last time the pricing information for this
   * security was updated.
   */
  pricingLastSyncedAt: Date | null;

  /**
   * A flag indicating whether the security is considered as cash within a brokerage account.
   * This is often used for cash management in investment portfolios.
   */
  isBrokerageCash: boolean;

  /**
   * The acronym or shorthand for the exchange where this security is traded,
   * which provides an easy reference to identify the trading platform.
   *
   * Example:
   * NYSE –	New York Stock Exchange
   */
  exchangeAcronym: string | null;

  /**
   * The Market Identifier Code (MIC) as per ISO standard, representing the exchange where the security is traded.
   * MIC is a unique identification code used to identify securities trading exchanges and market platforms globally.
   * Read more: https://www.investopedia.com/terms/m/mic.asp
   */
  exchangeMic: string | null;

  /**
   * The full name of the exchange where the security is listed and traded.
   * This helps in clearly identifying the specific market platform.
   */
  exchangeName: string | null;

  /**
   * Optional URL pointing to a logo/icon for this security. Populated for
   * providers that surface image assets (e.g. CoinGecko returns thumb/small/large
   * URLs in its search response). Stocks/ETFs are left null – the frontend
   * derives a logo.dev URL from the ticker symbol on render.
   */
  logoUrl: string | null;

  /**
   * The name of the data provider or the source from which the security's information is obtained.
   * Enumerated values represent various recognized data providers.
   *
   * Useful for next cases:
   * 1. If more providers will be added and table will be expanded, by this field
   * we can identify provider-specific fields and features.
   * 2. Easy to refresh data when multiple providers exists.
   * 3. Service price, licensing, auditing, data source verification – help for
   * any legal cases
   */
  providerName: SECURITY_PROVIDER;

  /**
   * The category of assets to which this security belongs.
   * Enumerated values represent different classes of assets such as stocks, bonds, etc.
   */
  assetClass: ASSET_CLASS;
  securityType: SECURITY_TYPE | null;
  createdAt: Date;
  updatedAt: Date;

  holdings?: HoldingModel[];
  investmentTransactions?: InvestmentTransactionModel[];
  pricing?: SecurityPricingModel[];
}

/**
 * Represents the normalized result of a security search from a data provider.
 * This is the format returned by provider search APIs before being stored in the database.
 */
export interface SecuritySearchResult {
  symbol: string;
  /**
   * Native id used by the provider to address this security in its API.
   * Equals `symbol` for stock providers; is the coin slug for CoinGecko
   * (e.g. "bitcoin"). Required so the backend can dedupe and look up by
   * (providerName, providerSymbol) instead of the non-unique ticker.
   */
  providerSymbol: string;
  /**
   * Symbol the backend should query for this security's prices instead of
   * `providerSymbol`. Set by the Yahoo ISIN-fallback path when the ISIN-suffix
   * row would otherwise have no usable historical data and a same-currency
   * local-ticker listing exists. See `SecurityModel.priceSourceSymbol`.
   * Nullable to match the model column; omitted by clients that don't supply it.
   */
  priceSourceSymbol?: string | null;
  name: string;
  assetClass: ASSET_CLASS;
  securityType?: SECURITY_TYPE | null;
  providerName: SECURITY_PROVIDER; // The provider that sourced this security data.
  exchangeAcronym?: string;
  exchangeMic?: string;
  exchangeName?: string;
  currencyCode: string;
  cryptoCurrencyCode?: string;
  cusip?: string;
  isin?: string;
  /**
   * Logo image URL surfaced by the provider, if any. CoinGecko returns this
   * for crypto coins; stock providers leave it undefined (frontend derives
   * a logo.dev URL from the ticker at render time).
   */
  logoUrl?: string | null;
  /**
   * Optional context for the frontend: did the user's query match the
   * security's ticker exactly, or only partially? Used to render a divider
   * between exact and partial matches in the search dropdown.
   */
  matchType?: 'exact' | 'partial';
  /**
   * Optional market cap rank (crypto only) so the UI can show e.g. "#42".
   */
  marketCapRank?: number | null;
}

/**
 * Represents what exactly the API returns to the client
 */
export interface SecuritySearchResultFormatted extends SecuritySearchResult {
  isInPortfolio?: boolean; // Indicates if this security is already in the queried portfolio
}
