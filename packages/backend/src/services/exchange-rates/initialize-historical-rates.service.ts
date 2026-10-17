import { logger } from '@js/utils';
import Currencies from '@models/currencies.model';
import ExchangeRates from '@models/exchange-rates.model';
import { addYears, format, min, startOfDay } from 'date-fns';
import chunk from 'lodash/chunk';

import { exchangeRateProviderRegistry } from './providers';
import { EXCHANGE_RATE_PROVIDER_TYPE, MergedRatesForDate } from './providers/types';

// Fallback date if no providers are registered (should not happen in practice)
const FALLBACK_START_DATE = new Date('1999-01-04');

// Batch size for bulk inserts to avoid memory issues
const BULK_INSERT_BATCH_SIZE = 2000;

/**
 * Configuration for provider availability retry logic.
 * Exported for testing purposes - allows tests to use shorter intervals.
 */
export const providerAvailabilityConfig = {
  maxRetries: 5,
  retryIntervalMs: 30000, // 30 seconds
};

/**
 * Wait for at least one historical data provider to become available
 * @returns true if a provider is available, false if none available after retries
 */
async function waitForProviderAvailability(): Promise<boolean> {
  const { maxRetries, retryIntervalMs } = providerAvailabilityConfig;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const providers = await exchangeRateProviderRegistry.getHistoricalDataProviders();

    if (providers.length > 0) {
      logger.info(`Historical data provider available: ${providers[0]!.metadata.name}`);
      return true;
    }

    if (attempt < maxRetries) {
      logger.info(
        `No historical data providers available (attempt ${attempt}/${maxRetries}), retrying in ${retryIntervalMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  return false;
}

/**
 * Process and insert merged rates from a fetch result.
 *
 * Rates are merged per-date across providers, so each rate carries its own
 * source — there is no single provider for the whole chunk.
 */
async function insertRatesChunk({
  results,
  validCurrencyCodes,
}: {
  results: MergedRatesForDate[];
  validCurrencyCodes: Set<string>;
}): Promise<{ totalRates: number; insertedRates: number }> {
  // Convert provider results to rate entries, filtering as we go to reduce memory.
  // `source` is part of the intermediate shape so a future refactor cannot drop
  // it before the bulkCreate() call without a type error.
  const validRates: {
    baseCode: string;
    quoteCode: string;
    rate: number;
    date: Date;
    source: EXCHANGE_RATE_PROVIDER_TYPE;
  }[] = [];

  for (const result of results) {
    const rateDate = startOfDay(new Date(result.date));
    for (const [quoteCode, { rate, source }] of Object.entries(result.rates)) {
      if (validCurrencyCodes.has(result.baseCurrency) && validCurrencyCodes.has(quoteCode)) {
        validRates.push({
          baseCode: result.baseCurrency,
          quoteCode,
          rate,
          date: rateDate,
          source,
        });
      }
    }
  }

  if (validRates.length === 0) {
    return { totalRates: 0, insertedRates: 0 };
  }

  // Insert in batches to avoid memory pressure
  const chunks = chunk(validRates, BULK_INSERT_BATCH_SIZE);

  for (const batch of chunks) {
    await ExchangeRates.bulkCreate(batch, {
      ignoreDuplicates: true,
      logging: false,
    });

    // Yield to event loop between batches
    await new Promise((resolve) => setImmediate(resolve));
  }

  return { totalRates: validRates.length, insertedRates: validRates.length };
}

/**
 * Initializes the database with historical exchange rates.
 * Uses the provider registry to fetch data from the highest-priority provider
 * that supports historical data loading.
 *
 * This function is idempotent - it can be safely called multiple times.
 * On first run, it loads all historical data. On subsequent runs, it only inserts new data.
 *
 * Data is processed in yearly chunks to avoid memory issues with large datasets.
 */
export async function initializeHistoricalRates(): Promise<void> {
  try {
    logger.info('Starting historical exchange rates initialization');

    // Wait for at least one provider to become available (with retries)
    const providerAvailable = await waitForProviderAvailability();

    if (!providerAvailable) {
      logger.info(
        'No historical data providers available after retries. Skipping historical rates initialization. The sync cron job will fill in data later.',
      );
      return;
    }

    const globalStartDate = exchangeRateProviderRegistry.getEarliestHistoricalDate() ?? FALLBACK_START_DATE;
    const globalEndDate = new Date();

    // Get all valid currency codes from the database. User-defined codes are private to their owners and have
    // no market rate, so they are never ingested.
    const validCurrencies = await Currencies.findAll({
      where: { isCustom: false },
      attributes: ['code'],
      raw: true,
    });
    const validCurrencyCodes = new Set(validCurrencies.map((c) => c.code));

    logger.info(`Found ${validCurrencyCodes.size} valid currencies in database`);

    // Without any currencies, every fetched rate would be filtered out — burning
    // provider quota for zero inserts. Bail out loudly so this isn't silent.
    if (validCurrencyCodes.size === 0) {
      logger.warn(
        'No currencies found in database; skipping historical rates initialization to avoid wasted provider calls.',
      );
      return;
    }

    let currentStartDate = new Date(globalStartDate);
    let totalInserted = 0;
    let providerName: string | null = null;

    // Process data in yearly chunks to avoid memory issues
    while (currentStartDate < globalEndDate) {
      const currentEndDate = min([addYears(currentStartDate, 1), globalEndDate]);

      logger.info(
        `Processing rates from ${format(currentStartDate, 'yyyy-MM-dd')} to ${format(currentEndDate, 'yyyy-MM-dd')}`,
      );

      // Fetch data for this year chunk
      const fetchResult = await exchangeRateProviderRegistry.fetchHistoricalRatesWithFallback({
        startDate: currentStartDate,
        endDate: currentEndDate,
      });

      if (!fetchResult) {
        logger.warn(
          `No provider available for range ${format(currentStartDate, 'yyyy-MM-dd')} to ${format(currentEndDate, 'yyyy-MM-dd')}, skipping`,
        );
      } else {
        providerName = fetchResult.providersUsed.map((p) => p.name).join(', ') || null;

        const { insertedRates } = await insertRatesChunk({
          results: fetchResult.results,
          validCurrencyCodes,
        });

        totalInserted += insertedRates;
        logger.info(
          `Inserted ${insertedRates} rates for ${format(currentStartDate, 'yyyy-MM-dd')} to ${format(currentEndDate, 'yyyy-MM-dd')}`,
        );
      }

      // Move to next year (add 1 day to avoid overlap)
      currentStartDate = new Date(currentEndDate);
      currentStartDate.setDate(currentStartDate.getDate() + 1);

      // Allow garbage collection between chunks
      await new Promise((resolve) => setImmediate(resolve));
    }

    logger.info(
      `[Historical Rates${providerName ? `: ${providerName}` : ''}] Initialization completed. Loaded ${totalInserted} currency rates from ${format(globalStartDate, 'yyyy-MM-dd')} to ${format(globalEndDate, 'yyyy-MM-dd')}`,
    );
  } catch (error) {
    logger.error('Failed to initialize historical exchange rates', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - we don't want to prevent the app from starting if this fails
    // The sync cron job will eventually fill in any missing data
  }
}
