/**
 * Currency Rates API Provider
 *
 * Custom exchange rate service with ECB and NBU data sources.
 * Provides comprehensive currency coverage with historical data from 1999.
 */
import axios from 'axios';
import { subDays } from 'date-fns';

import { BaseExchangeRateProvider } from '../base-provider';
import {
  EXCHANGE_RATE_PROVIDER_TYPE,
  ExchangeRateProviderMetadata,
  ExchangeRateResult,
  FetchRatesParams,
  FetchRatesRangeParams,
} from '../types';

/**
 * Response format from currency-rates-api for single date
 */
interface CurrencyRatesApiResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

/**
 * Response format from currency-rates-api for date range
 */
interface CurrencyRatesApiTimeSeriesResponse {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
}

/**
 * Response from /currencies endpoint
 */
interface CurrenciesResponse {
  [code: string]: {
    name: string;
    min_date: string;
    max_date: string;
  };
}

/**
 * Response from /health endpoint
 */
interface HealthResponse {
  status: string;
  version?: string;
}

const CURRENCY_RATES_API_BASE_URL = process.env.CURRENCY_RATES_API_URL || 'http://currency-rates-api:8080';
const REQUEST_TIMEOUT = 10000; // 10 seconds
const RANGE_REQUEST_TIMEOUT = 30000; // 30 seconds for range requests

/**
 * Supported currencies by the currency-rates-api service. Based on ECB + NBU
 * data sources. Includes `USD` even though the provider never emits a USD→USD
 * row — USD is the implicit base, so any user-facing "is X supported as a base
 * currency?" check needs USD to be present (e.g. the `change-base-currency`
 * validation guard).
 */
const CURRENCY_RATES_API_SUPPORTED_CURRENCIES = [
  'USD',
  // From ECB (since 1999-01-04)
  'AUD',
  'CAD',
  'CHF',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'ISK',
  'JPY',
  'KRW',
  'NOK',
  'NZD',
  'PLN',
  'SEK',
  'SGD',
  'ZAR',
  // From NBU (since 1999-01-04)
  'EGP',
  'GEL',
  'KZT',
  'LBP',
  'MDL',
  'SAR',
  'UAH',
  'VND',
  // Added later
  'BGN', // 2000-07-19
  'TRY', // 2005-01-03
  'CNY', // 2005-04-01
  'IDR', // 2005-04-01
  'MYR', // 2005-04-01
  'PHP', // 2005-04-01
  'THB', // 2005-04-01
  'RON', // 2005-07-01
  'BRL', // 2008-01-02
  'MXN', // 2008-01-02
  'INR', // 2009-01-02
  'ILS', // 2011-01-03
];

export class CurrencyRatesApiProvider extends BaseExchangeRateProvider {
  readonly metadata: ExchangeRateProviderMetadata = {
    type: EXCHANGE_RATE_PROVIDER_TYPE.CURRENCY_RATES_API,
    name: 'Currency Rates API',
    description: 'Custom exchange rate service with ECB and NBU data sources',
    supportedCurrencies: CURRENCY_RATES_API_SUPPORTED_CURRENCIES,
    minHistoricalDate: '1999-01-04',
    supportsHistoricalDataLoading: true,
  };

  /**
   * Check if the service is available by calling health endpoint
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get<HealthResponse>(`${CURRENCY_RATES_API_BASE_URL}/health`, {
        timeout: 5000,
      });
      return response.data?.status === 'ok';
    } catch {
      this.logInfo('Currency Rates API is not available');
      return false;
    }
  }

  /**
   * Fetch exchange rates for a specific date.
   * If today's rates are not available (404), automatically tries yesterday's rates
   * before giving up. This handles the case where NBU/ECB haven't published yet.
   */
  async fetchRatesForDate(params: FetchRatesParams): Promise<ExchangeRateResult | null> {
    // Try the requested date first
    const result = await this.fetchRatesForSingleDate(params);
    if (result) {
      return result;
    }

    // If the requested date failed, try yesterday as a fallback
    const yesterday = subDays(params.date, 1);
    this.logInfo(`Today's rates not available, trying yesterday (${this.formatDate(yesterday)})`);

    const fallbackResult = await this.fetchRatesForSingleDate({
      ...params,
      date: yesterday,
    });

    if (fallbackResult) {
      this.logInfo(`Using yesterday's rates as fallback for ${this.formatDate(params.date)}`);
    }

    return fallbackResult;
  }

  /**
   * Internal method to fetch rates for a single specific date (no fallback)
   */
  private async fetchRatesForSingleDate(params: FetchRatesParams): Promise<ExchangeRateResult | null> {
    const formattedDate = this.formatDate(params.date);
    const baseCurrency = this.getBaseCurrency(params);

    // Build URL with query params
    let url = `${CURRENCY_RATES_API_BASE_URL}/${formattedDate}?from=${baseCurrency}`;

    if (params.targetCurrencies && params.targetCurrencies.length > 0) {
      url += `&to=${params.targetCurrencies.join(',')}`;
    }

    try {
      this.logInfo(`Fetching rates for ${formattedDate}`);

      const response = await axios.get<CurrencyRatesApiResponse>(url, {
        timeout: REQUEST_TIMEOUT,
        responseType: 'json',
      });

      if (!response.data || !response.data.rates) {
        this.logInfo(`Invalid response for date ${formattedDate}`);
        return null;
      }

      // Validate base currency
      if (response.data.base !== baseCurrency) {
        this.logError(`Expected base ${baseCurrency}, got ${response.data.base}`);
        return null;
      }

      const rates = this.filterRatesByCurrencies({
        rates: response.data.rates,
        targetCurrencies: params.targetCurrencies,
      });

      this.logInfo(`Fetched ${Object.keys(rates).length} rates for ${formattedDate}`);

      return {
        date: response.data.date,
        baseCurrency: response.data.base,
        rates,
      };
    } catch (error) {
      this.handleFetchError({ error, date: formattedDate });
      return null;
    }
  }

  /**
   * Fetch exchange rates for a date range using the time series endpoint
   */
  async fetchRatesForDateRange(params: FetchRatesRangeParams): Promise<ExchangeRateResult[]> {
    const formattedStartDate = this.formatDate(params.startDate);
    const formattedEndDate = this.formatDate(params.endDate);
    const baseCurrency = this.getBaseCurrency(params);

    // Build URL with query params
    let url = `${CURRENCY_RATES_API_BASE_URL}/${formattedStartDate}..${formattedEndDate}?from=${baseCurrency}`;

    if (params.targetCurrencies && params.targetCurrencies.length > 0) {
      url += `&to=${params.targetCurrencies.join(',')}`;
    }

    try {
      this.logInfo(`Fetching rates for range ${formattedStartDate} to ${formattedEndDate}`);

      const response = await axios.get<CurrencyRatesApiTimeSeriesResponse>(url, {
        timeout: RANGE_REQUEST_TIMEOUT,
        responseType: 'json',
      });

      if (!response.data || !response.data.rates) {
        this.logInfo(`Invalid response for range ${formattedStartDate} to ${formattedEndDate}`);
        return [];
      }

      const results: ExchangeRateResult[] = [];

      for (const [date, rates] of Object.entries(response.data.rates)) {
        const filteredRates = this.filterRatesByCurrencies({
          rates,
          targetCurrencies: params.targetCurrencies,
        });

        results.push({
          date,
          baseCurrency: response.data.base,
          rates: filteredRates,
        });
      }

      this.logInfo(`Fetched rates for ${results.length} dates in range`);

      return results;
    } catch (error) {
      this.handleFetchError({ error, date: `${formattedStartDate}..${formattedEndDate}` });
      return [];
    }
  }

  /**
   * Get list of supported currencies from the API
   */
  async getSupportedCurrencies(): Promise<string[]> {
    try {
      const response = await axios.get<CurrenciesResponse>(`${CURRENCY_RATES_API_BASE_URL}/currencies`, {
        timeout: REQUEST_TIMEOUT,
      });

      if (!response.data) {
        return CURRENCY_RATES_API_SUPPORTED_CURRENCIES;
      }

      return Object.keys(response.data);
    } catch {
      // Fall back to static list
      return CURRENCY_RATES_API_SUPPORTED_CURRENCIES;
    }
  }
}

/**
 * Earliest available data from currency-rates-api (when EUR was introduced)
 * @public
 */
export const CURRENCY_RATES_API_START_DATE = new Date('1999-01-04');
