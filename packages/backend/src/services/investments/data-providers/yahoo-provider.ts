import { SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { sleep } from '@common/helpers';
import { logger } from '@js/utils';
import SecurityCurrencyCache from '@models/investments/security-currency-cache.model';
import { subYears } from 'date-fns';
import { Op } from 'sequelize';
import YahooFinance from 'yahoo-finance2';

import {
  BaseSecurityDataProvider,
  BulkPriceData,
  BulkPriceFetchOptions,
  HistoricalPriceOptions,
  PriceData,
  ProviderSymbol,
  SecurityPriceFetchInput,
  toProviderSymbol,
} from './base-provider';
import { resolveByIsinFallback } from './yahoo/isin-resolver';
import { ISIN_PATTERN, mapYahooTypeToAssetClass, remapUcitsType, toIsoCurrency, toMajorUnit } from './yahoo/utils';

const DEFAULT_HISTORY_YEARS = 5;
const CURRENCY_RESOLVE_CONCURRENCY = 5;

export class YahooDataProvider extends BaseSecurityDataProvider {
  readonly providerName = SECURITY_PROVIDER.yahoo;
  private client: InstanceType<typeof YahooFinance>;

  constructor() {
    super();
    this.client = new YahooFinance({
      suppressNotices: ['yahooSurvey', 'ripHistorical'],
      // Yahoo evolves response casing/shape faster than yahoo-finance2 ships
      // schema updates (e.g. `quoteType: "EQUITY"` vs schema's `"equity"`). The
      // lib still returns the parsed payload – only its post-hoc validator
      // complains – so we silence both validator log paths to keep the search
      // log readable. Real failures still surface via thrown exceptions.
      validation: { logErrors: false, logOptionsErrors: false },
    });
  }

  public async searchSecurities(query: string): Promise<SecuritySearchResult[]> {
    try {
      logger.info(`Searching Yahoo Finance for: ${query}`);

      const normalizedQuery = query.trim().toUpperCase();
      const isIsinQuery = ISIN_PATTERN.test(normalizedQuery);

      // `validateResult: false` is load-bearing. yahoo-finance2 ships fixed
      // JSON Schemas against an evolving Yahoo response shape; one renamed
      // field makes the validator throw `FailedYahooValidationError` even
      // though the parsed payload is intact. The fields we read (`symbol`,
      // `typeDisp`, `exchange`, `exchDisp`, `isYahooFinance`, `longname`,
      // `shortname`) are read defensively below.
      const searchResult = (await this.client.search(query, { newsCount: 0 }, { validateResult: false })) as {
        quotes?: Array<Record<string, unknown>>;
      };
      const quotes = Array.isArray(searchResult.quotes) ? searchResult.quotes : [];

      // Filter to only Yahoo Finance results with string-typed symbols.
      // `'symbol' in q` doesn't guarantee value type; `validateResult: false`
      // means every read is defensive.
      const validQuotes = quotes.filter(
        (q) => typeof q.symbol === 'string' && q.symbol.length > 0 && q.isYahooFinance !== false,
      );

      const symbols = validQuotes.map((q) => q.symbol as string);
      const currencyMap = await this.resolveCurrencies(symbols);

      const results: SecuritySearchResult[] = [];
      const seenSymbols = new Set<string>();
      const droppedSymbols: string[] = [];

      for (const q of validQuotes) {
        const symbol = q.symbol as string;
        const currencyCode = currencyMap.get(symbol);
        if (!currencyCode) {
          droppedSymbols.push(symbol);
          continue;
        }

        const name =
          (typeof q.longname === 'string' ? q.longname : undefined) ||
          (typeof q.shortname === 'string' ? q.shortname : undefined) ||
          symbol;

        // Yahoo tags UCITS ETFs as `MUTUALFUND` even though they trade
        // intraday. For an ISIN-shaped query the primary search only returns
        // exchange-traded forms – none are real NAV-priced mutuals – so the
        // remap is safe here. Non-ISIN queries keep the original classifier
        // so genuine mutual funds still route to `fixed_income`.
        const rawType = typeof q.typeDisp === 'string' ? q.typeDisp : undefined;
        const effectiveType = remapUcitsType({ rawType, isIsinQuery });

        seenSymbols.add(symbol);
        results.push({
          symbol,
          providerSymbol: symbol,
          name,
          assetClass: mapYahooTypeToAssetClass(effectiveType),
          providerName: this.providerName,
          exchangeName: typeof q.exchDisp === 'string' ? q.exchDisp : undefined,
          exchangeAcronym: typeof q.exchange === 'string' ? q.exchange : undefined,
          exchangeMic: undefined,
          currencyCode,
          cusip: undefined,
          isin: isIsinQuery ? normalizedQuery : undefined,
        });
      }

      if (droppedSymbols.length > 0) {
        logger.info(
          `Yahoo search: dropped ${droppedSymbols.length} symbols without currency: ${droppedSymbols.join(', ')}`,
        );
      }

      // For ISIN-shaped queries, also run the multi-venue fanout regardless of
      // primary hit count. Yahoo's `search()` for an ISIN returns at most one
      // "canonical" venue match (often Milan or Frankfurt), but users typing
      // an ISIN want to pick their broker's listing – that's what the fallback
      // surfaces. Dedupe against `seenSymbols` so primary hits aren't lost.
      if (isIsinQuery) {
        logger.info(`Yahoo: running ISIN fallback for ${normalizedQuery} (primary returned ${results.length})`);
        const fallbackResults = await resolveByIsinFallback({
          client: this.client,
          isin: normalizedQuery,
          seenSymbolsFromPrimary: seenSymbols,
        });
        for (const r of fallbackResults) {
          if (!seenSymbols.has(r.symbol)) {
            seenSymbols.add(r.symbol);
            results.push(r);
          }
        }
        if (fallbackResults.length > 0) {
          logger.info(`Yahoo ISIN fallback added ${fallbackResults.length} match(es) for ${normalizedQuery}`);
        }
      }

      logger.info(`Yahoo search returned ${results.length} results for: ${query}`);
      return results;
    } catch (error) {
      throw this.formatProviderError({ operation: 'Yahoo Finance search failed', error });
    }
  }

  public async getLatestPrice(providerSymbol: ProviderSymbol): Promise<PriceData> {
    try {
      logger.info(`Fetching latest price from Yahoo for: ${providerSymbol}`);

      const quote = await this.client.quote(providerSymbol);

      if (!quote || !quote.regularMarketPrice) {
        throw new Error(`No quote data found for symbol: ${providerSymbol}`);
      }

      const priceClose = toMajorUnit({ price: quote.regularMarketPrice, currency: quote.currency });
      if (!quote.regularMarketTime) {
        logger.info(`Missing regularMarketTime for ${providerSymbol}, using current time as fallback`);
      }
      const marketTime = quote.regularMarketTime ? new Date(quote.regularMarketTime) : new Date();

      const result: PriceData = {
        providerSymbol: toProviderSymbol(quote.symbol ?? providerSymbol),
        date: marketTime,
        priceClose,
        priceAsOf: marketTime,
        providerName: SECURITY_PROVIDER.yahoo,
      };

      logger.info(`Latest price for ${providerSymbol}: ${priceClose} on ${marketTime.toISOString()}`);
      return result;
    } catch (error) {
      throw this.formatProviderError({ operation: `Failed to fetch latest price for ${providerSymbol}`, error });
    }
  }

  public async getHistoricalPrices(
    providerSymbol: ProviderSymbol,
    options?: HistoricalPriceOptions,
  ): Promise<PriceData[]> {
    try {
      const startDate = options?.startDate;
      const endDate = options?.endDate;

      logger.info(
        `Fetching historical prices from Yahoo for: ${providerSymbol}${startDate && endDate ? ` from ${startDate.toISOString()} to ${endDate.toISOString()}` : ' (full dataset)'}`,
      );

      const period1 = startDate ?? subYears(new Date(), DEFAULT_HISTORY_YEARS);
      const period2 = endDate ?? new Date();

      const chartResult = await this.client.chart(providerSymbol, {
        period1: period1.toISOString().split('T')[0]!,
        period2: period2.toISOString().split('T')[0]!,
      });

      if (!chartResult.quotes || chartResult.quotes.length === 0) {
        throw new Error(`No historical data found for symbol: ${providerSymbol}`);
      }

      const results: PriceData[] = [];
      const currency = chartResult.meta?.currency;
      for (const q of chartResult.quotes) {
        if (q.close == null) continue;

        results.push({
          providerSymbol,
          date: new Date(q.date),
          priceClose: toMajorUnit({ price: q.adjclose ?? q.close, currency }),
          priceAsOf: new Date(q.date),
          providerName: SECURITY_PROVIDER.yahoo,
        });
      }

      // Sort by date ascending
      const sorted = results.toSorted((a, b) => a.date.getTime() - b.date.getTime());

      logger.info(`Found ${sorted.length} historical prices for ${providerSymbol}`);
      return sorted;
    } catch (error) {
      throw this.formatProviderError({ operation: `Failed to fetch historical prices for ${providerSymbol}`, error });
    }
  }

  public async fetchPricesForSecurities(
    securities: SecurityPriceFetchInput[],
    forDate: Date,
    options?: BulkPriceFetchOptions,
  ): Promise<Map<string, BulkPriceData[]>> {
    const result = new Map<string, BulkPriceData[]>();
    if (securities.length === 0) return result;

    logger.info(`Yahoo: Starting fetch for ${securities.length} securities`);

    const REQUEST_DELAY = 150; // 150ms between requests to avoid throttling

    for (const security of securities) {
      const { providerSymbol, securityId } = security;
      try {
        if (result.size > 0) {
          await sleep({ ms: REQUEST_DELAY });
        }

        // Use chart() with next day as period2 since Yahoo rejects same period1/period2
        const startDate = options?.startDate ?? forDate;
        const nextDay = new Date(forDate.getTime() + 24 * 60 * 60 * 1000);
        const prices = await this.getHistoricalPrices(providerSymbol, { startDate, endDate: nextDay });
        if (prices.length > 0) {
          result.set(
            securityId,
            prices.map((price) => ({ ...price, securityId })),
          );
          logger.info(
            `Fetched ${prices.length} price(s) for ${providerSymbol} up to ${forDate.toISOString().split('T')[0]}`,
          );
        } else {
          logger.info(`No price data found for ${providerSymbol} on ${forDate.toISOString().split('T')[0]}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Per-symbol failures are expected (delisted, unsupported by provider, etc.).
        // The composite provider aggregates and reports if ALL providers fail.
        logger.info(`Failed to fetch price for ${providerSymbol}: ${errorMessage}`);
      }
    }

    logger.info(`Yahoo fetch complete: ${result.size}/${securities.length} securities fetched`);
    return result;
  }

  /**
   * Resolves currencies for symbols using 2-tier strategy:
   * 1. Check SecurityCurrencyCache table first
   * 2. For uncached symbols, call Yahoo quote() API in batches and store results in cache
   */
  private async resolveCurrencies(symbols: string[]): Promise<Map<string, string>> {
    const currencyMap = new Map<string, string>();

    if (symbols.length === 0) return currencyMap;

    // Tier 1: Check cache
    try {
      const cached = await SecurityCurrencyCache.findAll({
        where: { symbol: { [Op.in]: symbols } },
        attributes: ['symbol', 'currencyCode'],
      });

      for (const entry of cached) {
        currencyMap.set(entry.symbol, toIsoCurrency(entry.currencyCode));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      // Cache miss isn't routine – the read is a single Postgres SELECT; a
      // failure here usually means pool exhaustion, replica lag, or schema
      // drift. Demoting to info hides real ops issues.
      logger.warn(`Failed to read currency cache: ${errorMsg}. Proceeding with API calls`);
    }

    // Tier 2: Fetch uncached symbols from Yahoo API in batches
    const uncachedSymbols = symbols.filter((s) => !currencyMap.has(s));

    if (uncachedSymbols.length > 0) {
      const toCache: { symbol: string; currencyCode: string; providerName: SECURITY_PROVIDER }[] = [];

      // Process in batches to avoid overwhelming Yahoo API
      for (let i = 0; i < uncachedSymbols.length; i += CURRENCY_RESOLVE_CONCURRENCY) {
        const batch = uncachedSymbols.slice(i, i + CURRENCY_RESOLVE_CONCURRENCY);
        const quoteResults = await Promise.allSettled(batch.map((symbol) => this.client.quote(symbol)));

        for (let j = 0; j < batch.length; j++) {
          const result = quoteResults[j]!;
          const symbol = batch[j]!;

          if (result.status === 'fulfilled' && result.value?.currency) {
            const currencyCode = toIsoCurrency(result.value.currency);
            currencyMap.set(symbol, currencyCode);
            toCache.push({
              symbol,
              currencyCode,
              providerName: SECURITY_PROVIDER.yahoo,
            });
          }
        }
      }

      // Store in cache (fire-and-forget, don't block the response)
      if (toCache.length > 0) {
        SecurityCurrencyCache.bulkCreate(toCache, { ignoreDuplicates: true }).catch((error) => {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          // bulkCreate failures are real (UQ violation aside – that's the
          // ignoreDuplicates case): pool exhaustion, RO replica, schema drift.
          // Surface at warn so cache thrash gets noticed instead of buried.
          logger.warn(`Failed to store currency cache entries: ${errorMsg}`);
        });
      }
    }

    return currencyMap;
  }
}
