import { ASSET_CLASS, SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import type Coingecko from '@coingecko/coingecko-typescript';
import { logger } from '@js/utils';
import { subYears } from 'date-fns';

import {
  BaseSecurityDataProvider,
  BulkPriceData,
  HistoricalPriceOptions,
  PriceData,
  ProviderSymbol,
  SecurityPriceFetchInput,
  toProviderSymbol,
} from './base-provider';
import { createCoingeckoClient } from './clients/coingecko-client';

/**
 * CoinGecko Demo tier serves at most 1 year of daily/hourly history (5-minutely
 * is capped at 1 day). Backfill callers may request a wider range, but we clamp
 * here so we don't return an empty array on the boundary. To extend beyond 1y
 * we'd need a second source (CryptoCompare, Binance klines) or a paid plan.
 */
const DEMO_MAX_HISTORY_YEARS = 1;
/** /simple/price accepts up to ~500 ids per call. Stay well under the cap. */
const SIMPLE_PRICE_BATCH_SIZE = 250;
/** Cap exact-symbol matches returned to the UI. */
const SEARCH_EXACT_LIMIT = 5;
/** Cap partial (substring) matches returned to the UI. */
const SEARCH_PARTIAL_LIMIT = 10;

/**
 * Names of "derivative" tokens (wrapped / bridged / staked / pegged /
 * synthetic copies of an underlying asset). They track the underlying
 * asset's price but are separate tokens and overwhelmingly confuse users
 * who are searching for the real underlying: e.g. searching "BTC" returns
 * "NEAR Intents Bridged BTC", or searching "NEAR" returns
 * "Binance-Peg NEAR" / "Wrapped Near" / "Staked NEAR". We drop them at
 * the search layer so the result list stays focused on the canonical
 * coin per ticker.
 *
 * `\b` ensures we don't false-positive on legitimate project names that
 * happen to start with one of these prefixes (e.g. "Synthetix" is not
 * matched by `\bsynthetic\b`).
 */
const DERIVATIVE_TOKEN_NAME_PATTERN = /\b(wrapped|bridged|staked|peg(ged)?|synthetic)\b/i;

const isDerivativeToken = (coin: { name?: string | null }): boolean =>
  coin.name ? DERIVATIVE_TOKEN_NAME_PATTERN.test(coin.name) : false;

/**
 * CoinGecko's /search response only types `thumb` (~25px) and `large` (~250px)
 * — `small` (~50px) exists at the same path but isn't in the SDK type.
 * `large` is way oversized for our 20-32px display targets (10-100KB per
 * image vs 2-8KB for small), so we rewrite the path segment ourselves.
 * Format: `https://coin-images.coingecko.com/coins/images/{id}/{size}/{file}`.
 * If the URL doesn't match the expected shape (e.g. CoinGecko reshuffles the
 * CDN), we fall back to the original — better an oversized image than none —
 * but log it so we notice if the CDN scheme drifts.
 */
const COINGECKO_IMAGE_SIZE_SEGMENT = /\/(thumb|small|large)\//;
const toSmallCoinGeckoImage = (url: string): string => {
  if (COINGECKO_IMAGE_SIZE_SEGMENT.test(url)) {
    return url.replace(COINGECKO_IMAGE_SIZE_SEGMENT, '/small/');
  }
  logger.warn(`CoinGecko image URL did not match expected size segment: ${url}`);
  return url;
};

const compareByMarketCapRank = (a: { market_cap_rank?: number }, b: { market_cap_rank?: number }) =>
  (a.market_cap_rank ?? Number.POSITIVE_INFINITY) - (b.market_cap_rank ?? Number.POSITIVE_INFINITY);

export class CoinGeckoDataProvider extends BaseSecurityDataProvider {
  readonly providerName = SECURITY_PROVIDER.coingecko;
  private client: Coingecko;

  constructor({ apiKey }: { apiKey: string }) {
    super();
    this.client = createCoingeckoClient({ apiKey });
  }

  /**
   * CoinGecko's `/search` returns coins ranked by market cap. We split the
   * response into "exact symbol match" and "partial" buckets and cap each so
   * the UI gets a small, ranked list rather than a long tail of scam tokens
   * that happen to share a ticker (e.g. dozens of coins symboled "BTC").
   */
  public async searchSecurities(query: string): Promise<SecuritySearchResult[]> {
    if (!query.trim()) return [];

    try {
      logger.info(`Searching CoinGecko for: ${query}`);
      const response = await this.client.search.get({ query });
      const coins = (response.coins ?? []).filter((c) => !!c.id && !!c.symbol);

      // Strip derivative tokens (wrapped/bridged/staked/peg/synthetic). See
      // DERIVATIVE_TOKEN_NAME_PATTERN above for rationale.
      const realCoins = coins.filter((c) => !isDerivativeToken(c));

      const upperQuery = query.trim().toUpperCase();
      const exact: typeof realCoins = [];
      const partial: typeof realCoins = [];

      for (const coin of realCoins) {
        if ((coin.symbol ?? '').toUpperCase() === upperQuery) {
          exact.push(coin);
        } else {
          partial.push(coin);
        }
      }

      // Exact-symbol matches are kept even when market_cap_rank is null —
      // covers the rare case of a niche coin whose ticker the user typed
      // verbatim.
      const limitedExact = exact.toSorted(compareByMarketCapRank).slice(0, SEARCH_EXACT_LIMIT);
      // Partial matches without a market_cap_rank are overwhelmingly dust /
      // inactive coins CoinGecko surfaces because the query happened to match
      // somewhere in their name. Dropping them keeps the partial list focused
      // on coins with real liquidity.
      const limitedPartial = partial
        .filter((c) => c.market_cap_rank != null)
        .toSorted(compareByMarketCapRank)
        .slice(0, SEARCH_PARTIAL_LIMIT);

      const mapCoin = (coin: (typeof coins)[number], matchType: 'exact' | 'partial'): SecuritySearchResult => {
        const symbolUpper = (coin.symbol ?? '').toUpperCase();
        // Prefer `large` so `toSmallCoinGeckoImage` can rewrite to /small/;
        // fall back to `thumb` (which the rewrite also lands on /small/).
        const rawLogo = coin.large ?? coin.thumb;
        return {
          symbol: symbolUpper,
          providerSymbol: coin.id!,
          name: coin.name ?? symbolUpper,
          assetClass: ASSET_CLASS.crypto,
          providerName: this.providerName,
          // CoinGecko itself isn't an exchange, but the UI expects a label.
          exchangeName: 'CoinGecko',
          exchangeAcronym: undefined,
          exchangeMic: undefined,
          // All prices are stored in USD; the existing ref-currency conversion
          // pipeline handles user-display currency.
          currencyCode: 'USD',
          cryptoCurrencyCode: symbolUpper,
          cusip: undefined,
          isin: undefined,
          logoUrl: rawLogo ? toSmallCoinGeckoImage(rawLogo) : null,
          matchType,
          marketCapRank: coin.market_cap_rank ?? null,
        };
      };

      return [...limitedExact.map((c) => mapCoin(c, 'exact')), ...limitedPartial.map((c) => mapCoin(c, 'partial'))];
    } catch (error) {
      logger.error({ message: `CoinGecko search failed for "${query}"`, error: error as Error });
      // Match the soft-failure pattern of other providers' search paths.
      return [];
    }
  }

  public async getLatestPrice(providerSymbol: ProviderSymbol): Promise<PriceData> {
    try {
      logger.info(`Fetching latest CoinGecko price for: ${providerSymbol}`);
      const response = await this.client.simple.price.get({
        ids: providerSymbol,
        vs_currencies: 'usd',
        include_last_updated_at: true,
      });

      const entry = response[providerSymbol];
      if (!entry || entry.usd == null) {
        throw new Error(`No price data returned for ${providerSymbol}`);
      }

      const priceAsOf = entry.last_updated_at ? new Date(entry.last_updated_at * 1000) : new Date();

      return {
        providerSymbol,
        date: priceAsOf,
        priceClose: entry.usd,
        priceAsOf,
        providerName: SECURITY_PROVIDER.coingecko,
      };
    } catch (error) {
      throw this.formatProviderError({ operation: `Failed to fetch CoinGecko price for ${providerSymbol}`, error });
    }
  }

  public async getHistoricalPrices(
    providerSymbol: ProviderSymbol,
    options?: HistoricalPriceOptions,
  ): Promise<PriceData[]> {
    try {
      const endDate = options?.endDate ?? new Date();
      const requestedStart = options?.startDate ?? subYears(endDate, DEMO_MAX_HISTORY_YEARS);
      // Clamp to Demo tier's 1-year window so the API doesn't 401.
      const demoCutoff = subYears(endDate, DEMO_MAX_HISTORY_YEARS);
      const startDate = requestedStart < demoCutoff ? demoCutoff : requestedStart;
      if (requestedStart < demoCutoff) {
        // Operators need to know history is being silently truncated — otherwise a
        // user-visible "no chart data before X" looks like missing data, not a tier cap.
        logger.warn(
          `CoinGecko history for ${providerSymbol} clamped to ${DEMO_MAX_HISTORY_YEARS}y (requested start ${requestedStart.toISOString()}, served from ${demoCutoff.toISOString()}). Demo tier limit.`,
        );
      }

      if (startDate >= endDate) return [];

      logger.info(
        `Fetching CoinGecko historical prices for ${providerSymbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
      );

      const response = await this.client.coins.marketChart.getRange(providerSymbol, {
        vs_currency: 'usd',
        from: String(Math.floor(startDate.getTime() / 1000)),
        to: String(Math.floor(endDate.getTime() / 1000)),
      });

      const prices = response.prices ?? [];
      return prices
        .filter((pair): pair is [number, number] => Array.isArray(pair) && pair.length === 2 && pair[1] != null)
        .map(([ts, price]) => {
          const date = new Date(ts);
          return {
            providerSymbol,
            date,
            priceClose: price,
            priceAsOf: date,
            providerName: SECURITY_PROVIDER.coingecko,
          };
        });
    } catch (error) {
      throw this.formatProviderError({
        operation: `Failed to fetch CoinGecko historical prices for ${providerSymbol}`,
        error,
      });
    }
  }

  /**
   * Batch latest-price fetch via `/simple/price?ids=…`. Each returned row
   * carries `securityId` echoed from the matching input so the caller can
   * resolve back to the Security row without matching on CoinGecko's slug
   * (crypto tickers aren't unique and a slug-keyed lookup would collide if
   * the same coin were ever tracked under two provider rows).
   */
  public async fetchPricesForSecurities(
    securities: SecurityPriceFetchInput[],
    forDate: Date,
  ): Promise<Map<string, BulkPriceData[]>> {
    const result = new Map<string, BulkPriceData[]>();
    if (securities.length === 0) return result;

    const cryptoOnly = securities.filter((s) => s.assetClass === ASSET_CLASS.crypto);
    if (cryptoOnly.length === 0) return result;

    logger.info(`CoinGecko: fetching latest prices for ${cryptoOnly.length} coins`);

    // Map by lowercased slug — CoinGecko's /simple/price echoes ids in lowercase
    // even when callers send uppercased ones.
    const inputsBySlug = new Map(cryptoOnly.map((s) => [s.providerSymbol.toLowerCase(), s]));

    for (let i = 0; i < cryptoOnly.length; i += SIMPLE_PRICE_BATCH_SIZE) {
      const batch = cryptoOnly.slice(i, i + SIMPLE_PRICE_BATCH_SIZE);
      const ids = batch.map((s) => s.providerSymbol).join(',');
      const batchSlugs = batch.map((s) => s.providerSymbol);

      try {
        const response = await this.client.simple.price.get({
          ids,
          vs_currencies: 'usd',
          include_last_updated_at: true,
        });

        for (const [id, entry] of Object.entries(response)) {
          if (!entry || entry.usd == null) {
            // CoinGecko returned the coin in the batch but with no USD price (delisted,
            // partial response, transient error). Surface it so operators can see the gap.
            logger.warn(`CoinGecko returned no USD price for ${id} in batch fetch`);
            continue;
          }
          const input = inputsBySlug.get(id.toLowerCase());
          if (!input) {
            // CoinGecko returned a coin we didn't ask for. Drop it — without a matching
            // input we can't attribute it to a Security row. Error level: indicates an
            // API quirk (alias resolution) or slug-mismatch bug, neither of which
            // should occur in steady state. Include the requested batch so operators
            // can see which input failed to round-trip.
            logger.error(
              `CoinGecko returned unrequested coin "${id}" in batch fetch. Requested slugs: ${batchSlugs.join(', ')}`,
            );
            continue;
          }
          const priceAsOf = entry.last_updated_at ? new Date(entry.last_updated_at * 1000) : forDate;
          result.set(input.securityId, [
            {
              providerSymbol: toProviderSymbol(id),
              date: forDate,
              priceClose: entry.usd,
              priceAsOf,
              providerName: SECURITY_PROVIDER.coingecko,
              securityId: input.securityId,
            },
          ]);
        }
      } catch (error) {
        // Per-batch failures are non-fatal — the composite still merges what other
        // batches returned — but they MUST be visible in Sentry. Auth failures, rate
        // limits, and 5xx all surface here; logging at `info` would hide them.
        logger.error({
          message: `CoinGecko batch fetch failed (batch ${i / SIMPLE_PRICE_BATCH_SIZE + 1}/${Math.ceil(cryptoOnly.length / SIMPLE_PRICE_BATCH_SIZE)})`,
          error: error as Error,
        });
      }
    }

    logger.info(`CoinGecko fetch complete: ${result.size}/${cryptoOnly.length} prices fetched`);
    return result;
  }
}
