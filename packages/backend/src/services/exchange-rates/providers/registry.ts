/**
 * Registry of exchange rate providers. Registration order IS the fallback
 * order: the merge walks providers in the order they were registered.
 */
import { logger } from '@js/utils';
import { getAllCurrencies } from '@models/currencies.model';

import { BaseExchangeRateProvider } from './base-provider';
import {
  findMissingCurrencies,
  mergeProviderRates,
  ProviderContribution,
  ProviderRatesInput,
} from './merge-provider-rates';
import {
  DEFAULT_BASE_CURRENCY,
  EXCHANGE_RATE_PROVIDER_TYPE,
  FetchHistoricalRatesWithFallbackResult,
  FetchRatesParams,
  FetchRatesRangeParams,
  FetchRatesWithFallbackResult,
  MergedRatesForDate,
} from './types';

/** A provider that was registered but did not contribute rates this run. */
interface ProviderFailure {
  name: string;
  type: EXCHANGE_RATE_PROVIDER_TYPE;
  reason: string;
}

class ExchangeRateProviderRegistry {
  private providers = new Map<EXCHANGE_RATE_PROVIDER_TYPE, BaseExchangeRateProvider>();

  /** @throws Error if provider type is already registered */
  register(provider: BaseExchangeRateProvider): void {
    const providerType = provider.metadata.type;

    if (this.providers.has(providerType)) {
      throw new Error(`Provider ${providerType} is already registered. Cannot register duplicate providers.`);
    }

    this.providers.set(providerType, provider);
    logger.info(`Registered exchange rate provider: ${provider.metadata.name}`);
  }

  /** Registered providers in registration order, minus any whose `isAvailable()` is false. */
  private async getAvailableProviders(): Promise<BaseExchangeRateProvider[]> {
    const available: BaseExchangeRateProvider[] = [];
    for (const provider of this.providers.values()) {
      try {
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          available.push(provider);
        } else {
          logger.info(`Provider ${provider.metadata.name} is not available, skipping`);
        }
      } catch (error) {
        logger.warn(`Error checking availability for ${provider.metadata.name}:`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return available;
  }

  /**
   * Fetch exchange rates by merging across providers in priority order.
   *
   * Each provider is queried and its rates are merged into the result, but a
   * lower-priority provider only fills currencies the higher-priority ones did
   * NOT supply. This is a gap-filling merge, not first-success-wins: the primary
   * (currency-rates-api) covers ~38 currencies, so the chain continues to the
   * free fawazahmed0 provider to refresh the exotic long tail — otherwise those
   * rates go permanently stale.
   *
   * The chain early-stops once every enabled currency is covered, so the paid
   * last-resort (ApiLayer) is only queried when the free providers leave a gap
   * (mostly pre-2024 exotic dates, which fawazahmed0 can't serve).
   *
   * @param params - Fetch parameters
   * @returns Merged exchange rates with per-currency attribution, or null if
   *          every provider failed to return any rates.
   */
  async fetchRatesWithFallback(params: FetchRatesParams): Promise<FetchRatesWithFallbackResult | null> {
    const registered = Array.from(this.providers.values());
    const available = await this.getAvailableProviders();

    // A registered provider missing from `available` was skipped by isAvailable()
    // (e.g. the primary's health check failed). That degradation never enters the
    // fetch loop, so it must be tracked separately or it would go unreported.
    const unavailable: ProviderFailure[] = registered
      .filter((p) => !available.includes(p))
      .map((p) => ({
        name: p.metadata.name,
        type: p.metadata.type,
        reason: 'Unavailable (isAvailable() returned false)',
      }));

    if (available.length === 0) {
      logger.error('No exchange rate providers are available', { unavailable, date: params.date.toISOString() });
      return null;
    }

    const baseCurrency = params.baseCurrency ?? DEFAULT_BASE_CURRENCY;

    // Fetch the enabled currency set once, tolerating a DB failure. Reused for the
    // per-provider early-stop check, the fawazahmed0-gap alert, and the degraded-sync
    // coverage report — so it is never queried more than once per run.
    let enabledCodes: string[] | null = null;
    try {
      enabledCodes = (await getAllCurrencies()).map((c) => c.code);
    } catch (error) {
      // Without the enabled set, the ApiLayer early-stop and both coverage
      // alerts are disabled for this run — must stay visible in logs.
      logger.error('[exchange-rates] Could not load enabled currencies; coverage checks disabled for this run', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const requestedDate = params.date.toISOString().slice(0, 10);
    const providerRates: ProviderRatesInput[] = [];
    // `failed` = a provider threw or was unavailable (a real degradation).
    // `noData` = a provider cleanly returned nothing for this date (expected for a
    // secondary, e.g. fawazahmed0's dated tag for today not being published yet).
    // Only `failed` feeds the degraded-sync alert; coverage gaps are caught on
    // their own further down, so a benign empty return never pages.
    const failed: ProviderFailure[] = [];
    const noData: ProviderFailure[] = [];
    let resultDate: string | undefined;

    for (const provider of available) {
      // Early-stop: once the higher-priority (free) providers already cover every
      // enabled currency, skip the remaining lower-priority ones. This keeps the
      // paid ApiLayer fetch from firing when there is nothing left to fill.
      if (enabledCodes && enabledCodes.length > 0 && providerRates.length > 0) {
        const { rates: coveredSoFar } = mergeProviderRates({ providerRates, baseCurrency });
        const stillMissing = findMissingCurrencies({
          expected: enabledCodes,
          covered: Object.keys(coveredSoFar),
          baseCurrency,
        });
        if (stillMissing.length === 0) {
          logger.info(
            `[exchange-rates] All enabled currencies covered before ${provider.metadata.name}; skipping remaining lower-priority providers`,
          );
          break;
        }
      }

      // A provider whose data floor is above the requested date has nothing to
      // serve by design (e.g. fawazahmed0 starts 2024-03-02). Skip it without
      // recording a failure so the degraded-sync alert only reports real problems.
      if (provider.metadata.minHistoricalDate && requestedDate < provider.metadata.minHistoricalDate) {
        logger.info(
          `[exchange-rates] ${provider.metadata.name} skipped: ${requestedDate} predates its data floor ${provider.metadata.minHistoricalDate}`,
        );
        continue;
      }

      try {
        logger.info(`Attempting to fetch rates from ${provider.metadata.name}`);
        const result = await provider.fetchRatesForDate(params);

        if (!result || Object.keys(result.rates).length === 0) {
          // A clean empty return means the provider has no data for this date, not
          // that it broke — expected for a secondary (fawazahmed0's dated tag for
          // today publishes a few hours late). Track it as no-data, not a failure,
          // and keep it out of Sentry; a real gap is caught by the coverage check.
          logger.info(`${provider.metadata.name} returned no rates, continuing to next provider`);
          noData.push({ name: provider.metadata.name, type: provider.metadata.type, reason: 'No rates returned' });
          continue;
        }

        resultDate ??= result.date;
        providerRates.push({ type: provider.metadata.type, name: provider.metadata.name, rates: result.rates });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`${provider.metadata.name} failed, continuing to next provider`, { error: reason });
        failed.push({ name: provider.metadata.name, type: provider.metadata.type, reason });
      }
    }

    const { rates, providersUsed } = mergeProviderRates({ providerRates, baseCurrency });

    if (Object.keys(rates).length === 0) {
      logger.error('All exchange rate providers failed to fetch rates', {
        failed,
        noData,
        unavailable,
        date: params.date.toISOString(),
      });
      return null;
    }

    const merged: MergedRatesForDate = {
      date: resultDate ?? params.date.toISOString().slice(0, 10),
      baseCurrency,
      rates,
    };

    // fawazahmed0 MUST have data for any date >= its floor, so an enabled currency
    // ApiLayer had to fill on such a date is a data anomaly worth a Sentry signal.
    // Deliberately narrow: this only flags "fawaz ran but lacked a rate the paid
    // fallback had". Skip it when fawaz contributed nothing at all (failed or
    // returned no data) — otherwise every currency looks like an ApiLayer gap.
    // A whole-currency miss is caught by the coverage alert instead.
    // The floor compares the REQUESTED date, not merged.date (a provider's own
    // stale-date fallback must not shift the check). Runs on BOTH the daily and
    // the on-demand paths since both route through here.
    const fawaz = available.find((p) => p.metadata.type === EXCHANGE_RATE_PROVIDER_TYPE.FAWAZ_CURRENCY_API);
    const fawazAbsent = [...failed, ...noData].some((p) => p.type === EXCHANGE_RATE_PROVIDER_TYPE.FAWAZ_CURRENCY_API);
    if (
      fawaz &&
      !fawazAbsent &&
      enabledCodes &&
      fawaz.metadata.minHistoricalDate &&
      requestedDate >= fawaz.metadata.minHistoricalDate
    ) {
      const gap = enabledCodes.filter((code) => merged.rates[code]?.source === EXCHANGE_RATE_PROVIDER_TYPE.API_LAYER);
      if (gap.length > 0) {
        logger.error('[ALERT:FAWAZ_CURRENCY_API_GAP] fawazahmed0 missing post-2024 rate(s); filled by ApiLayer', {
          gapCurrencies: gap,
          date: requestedDate,
        });
      }
    }

    await this.reportDegradedSync({ failed, unavailable, providersUsed, merged, enabledCodes });

    return { merged, providersUsed };
  }

  /**
   * Surface a degraded sync to Sentry (via logger.error). Two independent signals:
   *  1. Provider degradation — a registered provider failed, returned nothing, or
   *     was unavailable, even if others covered the gap (the long-tail-staleness
   *     risk this whole path exists to prevent).
   *  2. Coverage gap — an enabled currency is absent from the merged result.
   * Both are reported because either can leave a user's currency without a fresh
   * rate while the sync still "succeeds".
   */
  private async reportDegradedSync({
    failed,
    unavailable,
    providersUsed,
    merged,
    enabledCodes,
  }: {
    failed: ProviderFailure[];
    unavailable: ProviderFailure[];
    providersUsed: ProviderContribution[];
    merged: MergedRatesForDate;
    enabledCodes: string[] | null;
  }): Promise<void> {
    const degradedProviders = [...failed, ...unavailable];

    if (degradedProviders.length > 0) {
      const primaryDegraded = degradedProviders.some((p) => p.type === EXCHANGE_RATE_PROVIDER_TYPE.CURRENCY_RATES_API);
      // Preserve the [ALERT:CURRENCY_RATES_API_FAILED] keyword for the primary so
      // existing monitoring keyed off it keeps firing.
      const message = primaryDegraded
        ? '[ALERT:CURRENCY_RATES_API_FAILED] Primary provider degraded; rates served by fallbacks'
        : '[exchange-rates] Degraded sync: fallback provider(s) failed or unavailable';
      logger.error(message, {
        degradedProviders,
        contributingProviders: providersUsed.map((p) => p.name),
        date: merged.date,
      });
    }

    // Compare against the currencies users can actually select. `enabledCodes` is
    // pre-fetched by the caller (one query per run); if it couldn't be loaded, skip
    // the coverage check.
    if (!enabledCodes) {
      return;
    }
    const missingCurrencies = findMissingCurrencies({
      expected: enabledCodes,
      covered: Object.keys(merged.rates),
      baseCurrency: merged.baseCurrency,
    });
    if (missingCurrencies.length > 0) {
      // Info-only: dead currencies (KPW, SYP, retired SLL) keep this non-empty on
      // every healthy sync; regressions show as `missingCount` jumping in Loki.
      logger.info('[exchange-rates] Enabled currencies missing from sync result', {
        missingCurrencies,
        missingCount: missingCurrencies.length,
        date: merged.date,
      });
    }
  }

  /** Available providers with `supportsHistoricalDataLoading`, in registration order. */
  async getHistoricalDataProviders(): Promise<BaseExchangeRateProvider[]> {
    const allAvailable = await this.getAvailableProviders();
    return allAvailable.filter((provider) => provider.metadata.supportsHistoricalDataLoading === true);
  }

  /**
   * Fetch historical exchange rates for a date range, merging across providers
   * by priority — the SAME gap-filling semantics as the daily path, applied
   * per-date. Each lower-priority provider only fills currencies a higher one
   * didn't supply for that date, so the exotic long tail (covered only by the
   * comprehensive provider) is backfilled instead of dropped.
   * Only providers that support efficient historical data loading are queried.
   * @param params - Fetch parameters including date range
   * @returns Merged historical rates per date, or null if no provider returned data
   */
  async fetchHistoricalRatesWithFallback(
    params: FetchRatesRangeParams,
  ): Promise<FetchHistoricalRatesWithFallbackResult | null> {
    const registeredHistorical = Array.from(this.providers.values()).filter(
      (p) => p.metadata.supportsHistoricalDataLoading === true,
    );
    const providers = await this.getHistoricalDataProviders();

    // A registered historical provider missing from `providers` was skipped by
    // isAvailable(). The daily path tracks this; the historical path must too,
    // or a provider silently dropping out of the backfill goes unreported.
    const unavailable: ProviderFailure[] = registeredHistorical
      .filter((p) => !providers.includes(p))
      .map((p) => ({
        name: p.metadata.name,
        type: p.metadata.type,
        reason: 'Unavailable (isAvailable() returned false)',
      }));

    if (providers.length === 0) {
      logger.error('No exchange rate providers support historical data loading', { unavailable });
      return null;
    }

    const baseCurrency = params.baseCurrency ?? DEFAULT_BASE_CURRENCY;
    // date -> provider rates for that date, accumulated in provider-priority order
    // (outer loop is priority order) so the per-date merge keeps precedence.
    const ratesByDate = new Map<string, ProviderRatesInput[]>();
    const failed: ProviderFailure[] = [];

    for (const provider of providers) {
      try {
        logger.info(`Attempting to fetch historical rates from ${provider.metadata.name}`);
        const results = await provider.fetchRatesForDateRange(params);

        if (!results || results.length === 0) {
          logger.warn(`${provider.metadata.name} returned no historical rates, continuing to next provider`);
          failed.push({ name: provider.metadata.name, type: provider.metadata.type, reason: 'No rates returned' });
          continue;
        }

        for (const result of results) {
          const forDate = ratesByDate.get(result.date) ?? [];
          forDate.push({ type: provider.metadata.type, name: provider.metadata.name, rates: result.rates });
          ratesByDate.set(result.date, forDate);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(`${provider.metadata.name} failed to fetch historical rates, continuing to next provider`, {
          error: reason,
        });
        failed.push({ name: provider.metadata.name, type: provider.metadata.type, reason });
      }
    }

    if (ratesByDate.size === 0) {
      logger.error('All providers failed to fetch historical rates', { failed });
      return null;
    }

    const results: MergedRatesForDate[] = [];
    const contributionByType = new Map<EXCHANGE_RATE_PROVIDER_TYPE, ProviderContribution>();

    for (const [date, providerRates] of ratesByDate) {
      const { rates, providersUsed } = mergeProviderRates({ providerRates, baseCurrency });
      results.push({ date, baseCurrency, rates });

      // Aggregate per-provider contribution across all dates for the summary.
      for (const used of providersUsed) {
        const existing = contributionByType.get(used.type);
        if (existing) {
          existing.ratesContributed += used.ratesContributed;
        } else {
          contributionByType.set(used.type, { ...used });
        }
      }
    }

    // Degradation here is unusual (no per-date coverage check, since the historical
    // providers never cover the exotic long tail and missing exotics across years
    // would be expected noise) but a failed OR unavailable provider during backfill
    // is still worth a Sentry signal so a silently-skipped provider is visible.
    const degradedProviders = [...failed, ...unavailable];
    if (degradedProviders.length > 0) {
      logger.error('[exchange-rates] Historical backfill degraded: provider(s) failed or unavailable', {
        degradedProviders,
        date: `${params.startDate.toISOString().slice(0, 10)}..${params.endDate.toISOString().slice(0, 10)}`,
      });
    }

    return { results, providersUsed: Array.from(contributionByType.values()) };
  }

  /**
   * Get the earliest historical date supported by any provider that supports historical data loading.
   * Returns the earliest minHistoricalDate from all providers with supportsHistoricalDataLoading=true.
   * @returns The earliest Date, or null if no providers support historical data
   */
  getEarliestHistoricalDate(): Date | null {
    const historicalProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.metadata.supportsHistoricalDataLoading === true,
    );

    if (historicalProviders.length === 0) {
      return null;
    }

    let earliestDate: Date | null = null;

    for (const provider of historicalProviders) {
      if (provider.metadata.minHistoricalDate) {
        const providerDate = new Date(provider.metadata.minHistoricalDate);
        if (!earliestDate || providerDate < earliestDate) {
          earliestDate = providerDate;
        }
      }
    }

    return earliestDate;
  }

  /**
   * Get all unique currencies supported by providers that support historical data loading.
   * Returns the union of all supported currencies from these providers.
   * @returns Array of unique currency codes, or empty array if a provider supports all currencies
   */
  getSupportedCurrenciesForHistoricalData(): string[] {
    const historicalProviders = Array.from(this.providers.values()).filter(
      (provider) => provider.metadata.supportsHistoricalDataLoading === true,
    );

    if (historicalProviders.length === 0) {
      return [];
    }

    const allCurrencies = new Set<string>();

    for (const provider of historicalProviders) {
      // If a provider has no supportedCurrencies list, it supports all currencies
      if (!provider.metadata.supportedCurrencies) {
        // Return empty to indicate "all currencies supported"
        return [];
      }

      for (const currency of provider.metadata.supportedCurrencies) {
        allCurrencies.add(currency);
      }
    }

    return Array.from(allCurrencies).toSorted();
  }

  /**
   * Check if a currency is supported by any provider that supports historical data loading.
   * @param currencyCode - The currency code to check
   * @returns True if the currency is supported, false otherwise
   */
  isCurrencySupportedForHistoricalData(currencyCode: string): boolean {
    const supportedCurrencies = this.getSupportedCurrenciesForHistoricalData();

    // Empty array means all currencies are supported (a provider has no restrictions)
    if (supportedCurrencies.length === 0) {
      // Check if we have any historical providers at all
      const hasHistoricalProviders = Array.from(this.providers.values()).some(
        (provider) => provider.metadata.supportsHistoricalDataLoading === true,
      );
      return hasHistoricalProviders;
    }

    return supportedCurrencies.includes(currencyCode.toUpperCase());
  }
}

export const exchangeRateProviderRegistry = new ExchangeRateProviderRegistry();
