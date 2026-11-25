import type { ASSET_CLASS, SECURITY_PROVIDER, SECURITY_TYPE, SecuritySearchResult } from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import { isAxiosError } from 'axios';
import { inspect } from 'node:util';

/**
 * Branded type for provider-native security identifiers (Yahoo/Polygon/FMP/
 * AlphaVantage ticker, CoinGecko coin slug). Prevents accidental assignment
 * of `Security.symbol` (display ticker) where a provider-native id is required —
 * the two are NOT interchangeable for CoinGecko (`"BTC"` vs `"bitcoin"`), and
 * the price-sync map relies on matching against the provider-native id.
 *
 * Cast at the boundary (DB row → call site, or external API response →
 * `PriceData`) via {@link toProviderSymbol}.
 */
export type ProviderSymbol = string & { readonly __brand: 'ProviderSymbol' };

/**
 * Boundary cast from a plain string (Security row field, external SDK response)
 * into a {@link ProviderSymbol}. Caller is asserting the string is the
 * provider-native id, not the display ticker.
 */
export const toProviderSymbol = (value: string): ProviderSymbol => value as ProviderSymbol;

/**
 * Represents normalized price data for a single security on a specific date.
 * Returned by single-security methods (`getLatestPrice`, `getHistoricalPrices`)
 * where the caller already knows which Security it asked for. For bulk fetches
 * see {@link BulkPriceData}, which carries the originating `securityId`.
 *
 * `providerSymbol` is the provider-native identifier (Yahoo ticker, CoinGecko
 * coin slug, etc.).
 */
export interface PriceData {
  providerSymbol: ProviderSymbol;
  date: Date;
  priceClose: number;
  /**
   * The moment the upstream provider reports the price was valid. Always set
   * by every leaf provider — required so the daily/intraday sync can use it as
   * the stored row's timestamp without a fallback that would silently break
   * `(securityId, date)` dedup across runs.
   */
  priceAsOf: Date;
  providerName: SECURITY_PROVIDER;
  /** Instrument type, when the price response carries one. */
  securityType?: SECURITY_TYPE | null;
}

/**
 * A {@link PriceData} that carries the caller's `securityId` echoed from the
 * matching {@link SecurityPriceFetchInput}. Returned by
 * {@link BaseSecurityDataProvider.fetchPricesForSecurities}.
 *
 * Threading `securityId` through avoids matching by `(providerName,
 * providerSymbol)` — that pair can collide across the DB (two Securities
 * sharing a symbol under different providers) and also breaks under the
 * composite's fallback path (intended provider ≠ actual fetcher).
 */
export interface BulkPriceData extends PriceData {
  securityId: string;
}

/**
 * Optional refinements for a security search. Currently just an asset-class
 * filter coming from the UI pill-tab (All / Stocks / Crypto). When set, the
 * composite provider can skip provider calls that would only return rows of
 * the wrong class — and as a defense-in-depth measure callers should still
 * filter results, since some providers (Yahoo) return mixed-class hits.
 */
export interface SearchOptions {
  assetClass?: ASSET_CLASS;
}

export interface HistoricalPriceOptions {
  startDate?: Date;
  endDate?: Date;
  /**
   * Asset class for routing in the composite provider. When set to `crypto`,
   * the composite delegates to CoinGecko regardless of symbol shape.
   */
  assetClass?: ASSET_CLASS;
}

/**
 * Minimal info needed to fetch a price for a security.
 *
 * - `securityId` — opaque caller-supplied identifier (the Securities row UUID).
 *   Threaded through to each returned `PriceData.securityId` so callers can
 *   resolve outputs back to inputs without string-matching on
 *   `(providerName, providerSymbol)`. Required because that pair can collide
 *   across the DB and isn't preserved through the composite's fallback path.
 * - `symbol` — human-facing ticker (e.g. "AAPL", "BTC").
 * - `providerSymbol` — provider-native id used in API calls. Equals `symbol`
 *   for stock providers; is the slug (e.g. "bitcoin") for CoinGecko. Required
 *   so leaf providers and the composite map can resolve the same coin under
 *   different display symbols.
 * - `assetClass` — lets the composite route by class and lets the closed-market
 *   check know that crypto trades 24/7.
 */
export interface SecurityPriceFetchInput {
  securityId: string;
  symbol: string;
  providerSymbol: ProviderSymbol;
  assetClass: ASSET_CLASS;
}

/**
 * Options for {@link BaseSecurityDataProvider.fetchPricesForSecurities}.
 *
 * `startDate` widens the fetch window to [startDate, forDate] so callers can
 * re-request days a previous run missed. Providers that can only serve a
 * single date (Polygon, CoinGecko) ignore it and return just `forDate`'s bar.
 */
export interface BulkPriceFetchOptions {
  startDate?: Date;
}

export abstract class BaseSecurityDataProvider {
  abstract readonly providerName: SECURITY_PROVIDER;

  /**
   * Fetches the historical price data (OHLC) for a single security.
   * This is used for backfilling missing data or displaying charts.
   * Most providers return full available data by default.
   * @param providerSymbol The provider-native identifier of the security.
   * @param options Optional date range parameters. If not provided, returns all available data.
   * @returns A promise that resolves to an array of historical price data.
   */
  abstract getHistoricalPrices(providerSymbol: ProviderSymbol, options?: HistoricalPriceOptions): Promise<PriceData[]>;

  /**
   * Searches for securities based on a query string (symbol or name).
   * Composite implementations may use `options.assetClass` to skip providers
   * that aren't relevant for the requested class; leaf providers can ignore it.
   * @param query The search term (partial symbol or company name).
   * @param options Optional refinements (e.g. asset-class filter from the UI).
   * @returns A promise that resolves to an array of matching securities.
   */
  abstract searchSecurities(query: string, options?: SearchOptions): Promise<SecuritySearchResult[]>;

  /**
   * Fetches the latest/current price for a single security.
   * This is used for immediate price display and current portfolio valuation.
   * @param providerSymbol The provider-native identifier of the security.
   * @returns A promise that resolves to the latest price data.
   */
  abstract getLatestPrice(providerSymbol: ProviderSymbol): Promise<PriceData>;

  /**
   * Fetch prices for multiple securities. This method only handles fetching
   * and normalizing price data; database operations should be handled by the
   * calling service.
   *
   * Returns a `Map<securityId, BulkPriceData[]>` so the caller can look
   * results up by the same UUID it supplied without doing its own re-join.
   * Each entry holds every bar the provider returned inside the requested
   * window ([options.startDate ?? forDate, forDate]); single-date providers
   * return one-element arrays. Securities that did not produce any price
   * (delisted, market closed, provider error) are simply absent from the map —
   * callers should diff input ids against map keys to detect partial failures.
   * A present entry always has at least one bar.
   *
   * @param securities - Securities to fetch prices for
   * @param forDate - The last (most recent) date to fetch prices for
   * @param options - Optional window widening, see {@link BulkPriceFetchOptions}
   * @returns Map keyed by `securityId` containing successfully fetched prices.
   */
  abstract fetchPricesForSecurities(
    securities: SecurityPriceFetchInput[],
    forDate: Date,
    options?: BulkPriceFetchOptions,
  ): Promise<Map<string, BulkPriceData[]>>;

  // TODO: processSearchToSecurity method, because each security after search can provide different schema
  // and it should be processed uniquely when adding security from the search

  /**
   * Wraps a leaf-provider failure with the operation description and returns it
   * (preserving the original via `cause`) so methods can
   * `throw this.formatProviderError(...)` from a catch branch instead of
   * repeating the same Error.cause boilerplate.
   *
   * Logs at `info` only — deliberately NOT `error`. A single leaf provider
   * throwing is rarely the real outcome: the composite retries the next
   * provider in the fallback chain, bulk sync treats per-symbol misses as
   * expected, and optional price fetches swallow it. Whoever owns the operation
   * (the composite's all-providers `.catch`, the bulk-sync miss report, or the
   * consumer's own `.catch`) logs the actual outcome at the right severity.
   * Error-logging here as well turned every *recovered* failure into a Sentry
   * exception and double/triple-reported the genuine ones.
   */
  protected formatProviderError({ operation, error }: { operation: string; error: unknown }): Error {
    const message = `${operation} via ${this.providerName}: ${this.describeProviderFailure(error)}`;
    logger.info(message);
    return new Error(message, { cause: error });
  }

  // Turn whatever a provider SDK threw into readable text. They don't agree on
  // shape: axios throws AxiosError (status + body), alphavantage throws a plain
  // string, some throw an object — flattening all to "Unknown error" hid the
  // real cause (not-found vs rate-limited vs network).
  private describeProviderFailure(error: unknown): string {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const body = error.response?.data;
      const bodyMessage =
        typeof body === 'string' && body
          ? body
          : body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : undefined;
      return `HTTP ${status ?? 'unknown'} - ${bodyMessage ?? error.message}`;
    }

    if (error instanceof Error) {
      return error.message || error.constructor.name;
    }

    if (typeof error === 'string') {
      return error || '(empty string thrown)';
    }

    if (error === null || error === undefined) {
      return String(error);
    }

    // Plain object / unknown throwable: inspect() shows real key/values (and
    // handles circular refs) instead of a useless "[object Object]".
    return inspect(error, { depth: 2, breakLength: 200 });
  }
}
