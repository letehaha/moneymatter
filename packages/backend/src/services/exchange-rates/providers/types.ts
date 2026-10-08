/**
 * Core types and interfaces for the Exchange Rate Provider system.
 * This modular system allows easy addition/removal of currency rate data providers
 * with registration-order fallback behavior.
 */
import { EXCHANGE_RATE_PROVIDER_TYPE } from '@bt/shared/types';

import { AttributedRate, ProviderContribution } from './merge-provider-rates';

// Re-exported so service-internal modules can keep importing from `./types`.
// The model imports the enum directly from `@bt/shared/types` to avoid a
// model → service layer dependency.
export { EXCHANGE_RATE_PROVIDER_TYPE };

/** Default base currency used across providers and the merge logic. */
export const DEFAULT_BASE_CURRENCY = 'USD';

// ============================================================================
// Provider Configuration
// ============================================================================

/**
 * Metadata describing an exchange rate provider
 */
export interface ExchangeRateProviderMetadata {
  /** Provider type identifier */
  type: EXCHANGE_RATE_PROVIDER_TYPE;
  /** Display name for logging/UI */
  name: string;
  /** Short description of the provider */
  description: string;
  /** List of supported currency codes (undefined = all currencies) */
  supportedCurrencies?: string[];
  /** Earliest date for which historical data is available (ISO date string) */
  minHistoricalDate?: string;
  /**
   * Whether this provider supports efficient historical data loading (time series API).
   * Providers with this set to true have a dedicated API endpoint for fetching
   * multiple dates at once, rather than making individual requests per day.
   */
  supportsHistoricalDataLoading?: boolean;
}

// ============================================================================
// Rate Data Types
// ============================================================================

/**
 * Parameters for fetching exchange rates
 */
export interface FetchRatesParams {
  /** The date to fetch rates for */
  date: Date;
  /** Base currency code (default: USD) */
  baseCurrency?: string;
  /** Target currencies to fetch (undefined = all available) */
  targetCurrencies?: string[];
}

/**
 * Parameters for fetching rates over a date range
 */
export interface FetchRatesRangeParams {
  /** Start date of the range */
  startDate: Date;
  /** End date of the range */
  endDate: Date;
  /** Base currency code (default: USD) */
  baseCurrency?: string;
  /** Target currencies to fetch (undefined = all available) */
  targetCurrencies?: string[];
}

/**
 * Exchange rate data for a single date
 */
export interface ExchangeRateResult {
  /** ISO date string (yyyy-MM-dd) */
  date: string;
  /** Base currency code */
  baseCurrency: string;
  /** Map of quote currency code to exchange rate */
  rates: Record<string, number>;
}

/**
 * Merged exchange rates for a single date.
 *
 * Rates are MERGED across providers by priority: each lower-priority provider
 * only fills currencies the higher-priority ones didn't supply. Because rates
 * can originate from different providers, each rate carries its own `source`
 * (see `AttributedRate`) — rate and provenance always travel together, so a
 * rate can never be persisted without a known source.
 */
export interface MergedRatesForDate {
  /** ISO date string (yyyy-MM-dd) */
  date: string;
  /** Base currency code */
  baseCurrency: string;
  /** quoteCode -> { rate, source } */
  rates: Record<string, AttributedRate>;
}

/**
 * Result from fetchRatesWithFallback — merged rates for one date plus the
 * per-provider contribution summary.
 */
export interface FetchRatesWithFallbackResult {
  merged: MergedRatesForDate;
  /** Providers that contributed at least one rate, in priority order */
  providersUsed: ProviderContribution[];
}

/**
 * Result from fetchHistoricalRatesWithFallback — merged rates per date across
 * the range, with the same priority-merge semantics as the daily path.
 */
export interface FetchHistoricalRatesWithFallbackResult {
  results: MergedRatesForDate[];
  /** Providers that contributed at least one rate across the range */
  providersUsed: ProviderContribution[];
}

// ============================================================================
// Provider Interface
// ============================================================================

/**
 * Interface that all exchange rate providers must implement.
 * Provides a consistent API for fetching rates from any data source.
 */
export interface IExchangeRateProvider {
  // ========================================
  // Metadata
  // ========================================

  /** Provider metadata (name, supported currencies, etc.) */
  readonly metadata: ExchangeRateProviderMetadata;

  // ========================================
  // Availability
  // ========================================

  /**
   * Check if the provider is currently available.
   * This may check API connectivity, required credentials, etc.
   * @returns Promise<boolean> - true if provider can be used
   */
  isAvailable(): Promise<boolean>;

  // ========================================
  // Rate Fetching
  // ========================================

  /**
   * Fetch exchange rates for a specific date
   * @param params - Parameters including date and optional currency filters
   * @returns Exchange rate result or null if rates are unavailable
   */
  fetchRatesForDate(params: FetchRatesParams): Promise<ExchangeRateResult | null>;

  /**
   * Fetch exchange rates for a date range (optional)
   * Providers that don't support range fetching can omit this method.
   * @param params - Parameters including date range and optional currency filters
   * @returns Array of exchange rate results
   */
  fetchRatesForDateRange?(params: FetchRatesRangeParams): Promise<ExchangeRateResult[]>;

  /**
   * Get list of supported currencies (optional)
   * @returns Array of currency codes this provider supports
   */
  getSupportedCurrencies?(): Promise<string[]>;
}
