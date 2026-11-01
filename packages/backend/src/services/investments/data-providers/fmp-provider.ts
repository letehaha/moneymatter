import { ASSET_CLASS, SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { sleep } from '@common/helpers';
import { logger } from '@js/utils';

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
import { FmpClient, FmpSearchResult } from './clients';

export class FmpDataProvider extends BaseSecurityDataProvider {
  readonly providerName = SECURITY_PROVIDER.fmp;
  private client: FmpClient;

  constructor(apiKey: string) {
    super();
    this.client = new FmpClient({ apiKey });
  }

  /**
   * Search for securities using FMP search endpoint
   */
  public async searchSecurities(query: string): Promise<SecuritySearchResult[]> {
    try {
      logger.info(`Searching FMP for: ${query}`);

      const searchResults = await this.client.search(query, 10);

      if (!Array.isArray(searchResults)) {
        logger.info(`No search results found for query: ${query}`);
        return [];
      }

      const filteredSearch = searchResults.reduce(
        (acc, curr) => {
          if (curr.currency) {
            acc.with.push(curr);
          } else {
            acc.without.push(curr);
          }

          return acc;
        },
        { with: [] as FmpSearchResult[], without: [] as FmpSearchResult[] },
      );

      if (filteredSearch.without.length) {
        logger.warn('FMP search returned securities with no currency', { securities: filteredSearch.without, query });
      }

      const results: SecuritySearchResult[] = filteredSearch.with.map((result) => ({
        symbol: result.symbol,
        providerSymbol: result.symbol,
        name: result.name,
        assetClass: this.mapToAssetClass(result.symbol),
        providerName: this.providerName,
        exchangeName: result.stockExchange,
        currencyCode: result.currency!, // cast ! cause we filtered out before
        exchangeAcronym: result.exchangeShortName,
        exchangeMic: undefined,
        cusip: undefined,
        isin: undefined,
      }));

      return results;
    } catch (error) {
      throw this.formatProviderError({ operation: 'FMP search failed', error });
    }
  }

  /**
   * Get latest price for a security
   */
  public async getLatestPrice(providerSymbol: ProviderSymbol): Promise<PriceData> {
    try {
      logger.info(`Fetching latest price for: ${providerSymbol}`);

      const quotes = await this.client.getQuote(providerSymbol);

      if (!Array.isArray(quotes) || quotes.length === 0) {
        throw new Error(`No quote data found for symbol: ${providerSymbol}`);
      }

      const quote = quotes[0]!;
      const priceClose = quote.price;
      const latestTradingDay = new Date(quote.timestamp * 1000);

      const result: PriceData = {
        providerSymbol: toProviderSymbol(quote.symbol),
        date: latestTradingDay,
        priceClose,
        priceAsOf: latestTradingDay,
        providerName: SECURITY_PROVIDER.fmp,
      };

      logger.info(`Latest price for ${providerSymbol}: ${priceClose} on ${latestTradingDay.toISOString()}`);
      return result;
    } catch (error) {
      throw this.formatProviderError({ operation: `Failed to fetch latest price for ${providerSymbol}`, error });
    }
  }

  /**
   * Get historical prices for a security within a date range
   */
  public async getHistoricalPrices(
    providerSymbol: ProviderSymbol,
    options?: HistoricalPriceOptions,
  ): Promise<PriceData[]> {
    try {
      const startDate = options?.startDate;
      const endDate = options?.endDate;

      logger.info(
        `Fetching historical prices for: ${providerSymbol}${startDate && endDate ? ` from ${startDate.toISOString()} to ${endDate.toISOString()}` : ' (full dataset)'}`,
      );

      // If no date range specified, FMP typically returns recent data by default
      const fromDate = startDate?.toISOString().split('T')[0];
      const toDate = endDate?.toISOString().split('T')[0];

      const historicalResponse = await this.client.getHistoricalPrices(providerSymbol, fromDate, toDate);

      if (!historicalResponse.historical || !Array.isArray(historicalResponse.historical)) {
        throw new Error(`No historical data found for symbol: ${providerSymbol}`);
      }

      const results: PriceData[] = historicalResponse.historical.map((dailyData) => ({
        providerSymbol,
        date: new Date(dailyData.date),
        priceClose: dailyData.price,
        priceAsOf: new Date(dailyData.date),
        providerName: SECURITY_PROVIDER.fmp,
      }));

      // Sort by date ascending
      const sorted = results.toSorted((a, b) => a.date.getTime() - b.date.getTime());

      logger.info(`Found ${sorted.length} historical prices for ${providerSymbol} in date range`);
      return sorted;
    } catch (error) {
      throw this.formatProviderError({ operation: `Failed to fetch historical prices for ${providerSymbol}`, error });
    }
  }

  /**
   * Fetch prices for multiple securities efficiently with rate limiting.
   * FMP free tier has 250 requests/day limit.
   * Paid tiers have much higher limits (300-3000 requests/minute).
   */
  public async fetchPricesForSecurities(
    securities: SecurityPriceFetchInput[],
    forDate: Date,
    options?: BulkPriceFetchOptions,
  ): Promise<Map<string, BulkPriceData[]>> {
    const FMP_FREE_DAILY_LIMIT = 250;
    const FMP_MINUTE_LIMIT = 5; // Conservative limit for free tier
    const MINUTE_DELAY = 60 * 1000 + 1000; // 61 seconds to be safe
    const REQUEST_DELAY = 12 * 1000; // 12 seconds between requests for free tier

    const result = new Map<string, BulkPriceData[]>();
    if (securities.length === 0) {
      return result;
    }

    logger.info(`FMP: Starting fetch for ${securities.length} securities`);

    // Apply daily limit
    const toProcess = securities.length > FMP_FREE_DAILY_LIMIT ? securities.slice(0, FMP_FREE_DAILY_LIMIT) : securities;

    if (toProcess.length < securities.length) {
      logger.warn(`FMP daily limit reached: processing ${toProcess.length} of ${securities.length} securities`);
    }

    let requestsThisMinute = 0;
    let lastRequestTime = 0;

    for (const { providerSymbol, securityId } of toProcess) {
      try {
        // Rate limiting: respect free tier limits
        if (requestsThisMinute >= FMP_MINUTE_LIMIT) {
          const timeSinceLastRequest = Date.now() - lastRequestTime;
          if (timeSinceLastRequest < MINUTE_DELAY) {
            const waitTime = MINUTE_DELAY - timeSinceLastRequest;
            logger.info(`FMP rate limit: waiting ${waitTime}ms before next batch`);
            await sleep({ ms: waitTime });
          }
          requestsThisMinute = 0;
        }

        // Add delay between requests
        if (lastRequestTime > 0) {
          const timeSinceLastRequest = Date.now() - lastRequestTime;
          if (timeSinceLastRequest < REQUEST_DELAY) {
            await sleep({ ms: REQUEST_DELAY - timeSinceLastRequest });
          }
        }

        // Fetch price for specific date using historical data
        lastRequestTime = Date.now();
        requestsThisMinute++;

        const historicalPrices = await this.getHistoricalPrices(providerSymbol, {
          startDate: options?.startDate ?? forDate,
          endDate: forDate,
        });
        if (historicalPrices.length > 0) {
          result.set(
            securityId,
            historicalPrices.map((priceData) => ({ ...priceData, securityId })),
          );
          logger.info(
            `Fetched ${historicalPrices.length} price(s) for ${providerSymbol} up to ${forDate.toISOString().split('T')[0]}`,
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

    logger.info(`FMP fetch complete: ${result.size}/${toProcess.length} securities fetched`);
    return result;
  }

  /**
   * Map symbol patterns to our internal ASSET_CLASS enum
   * FMP doesn't provide asset class in search, so we'll infer from symbol patterns
   */
  private mapToAssetClass(symbol: string): ASSET_CLASS {
    const symbolUpper = symbol.toUpperCase();

    // Crypto patterns
    if (symbolUpper.includes('BTC') || symbolUpper.includes('ETH') || symbolUpper.includes('CRYPTO')) {
      return ASSET_CLASS.crypto;
    }

    // ETF patterns (common ETF suffixes)
    if (symbolUpper.endsWith('ETF') || symbolUpper.match(/^[A-Z]{3,4}$/)) {
      return ASSET_CLASS.stocks; // Treat ETFs as stocks
    }

    // Default to stocks for most symbols
    return ASSET_CLASS.stocks;
  }
}
