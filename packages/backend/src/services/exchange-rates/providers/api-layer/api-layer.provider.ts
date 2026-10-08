/**
 * ApiLayer (Fixer) Provider
 *
 * Comprehensive exchange rate service with 150+ currencies.
 * Requires API key(s) and has rate limiting.
 *
 * Last-resort fallback: most comprehensive but costs money, so it only runs
 * after the free providers leave a gap.
 */
import Currencies from '@models/currencies.model';
import axios, { isAxiosError } from 'axios';

import { ApiKeyRateLimitService } from '../../api-key-rate-limit.service';
import { BaseExchangeRateProvider } from '../base-provider';
import {
  EXCHANGE_RATE_PROVIDER_TYPE,
  ExchangeRateProviderMetadata,
  ExchangeRateResult,
  FetchRatesParams,
} from '../types';

/**
 * Response format from ApiLayer Fixer API
 */
interface ApiLayerResponse {
  base: string;
  date: string;
  historical: boolean;
  rates: Record<string, number>;
  success: boolean;
  timestamp: number;
}

const API_LAYER_BASE_URL = 'https://api.apilayer.com/fixer';
const REQUEST_TIMEOUT = 10000; // 10 seconds

export class ApiLayerProvider extends BaseExchangeRateProvider {
  readonly metadata: ExchangeRateProviderMetadata = {
    type: EXCHANGE_RATE_PROVIDER_TYPE.API_LAYER,
    name: 'ApiLayer',
    description: 'Comprehensive exchange rate API with 150+ currencies (Fixer)',
    // ApiLayer supports many currencies, don't limit here
    supportedCurrencies: undefined,
  };

  /**
   * Get API keys from environment
   */
  private getApiKeys(): string[] {
    const keys = process.env.API_LAYER_API_KEYS;
    if (!keys) {
      return [];
    }
    return keys
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key);
  }

  /**
   * Check if ApiLayer is available (has valid API keys)
   */
  async isAvailable(): Promise<boolean> {
    const apiKeys = this.getApiKeys();
    if (apiKeys.length === 0) {
      this.logWarn('No API keys configured');
      return false;
    }

    // Check if at least one API key is not rate-limited
    const availableKeys = await ApiKeyRateLimitService.filterAvailableKeys('apilayer', apiKeys);
    if (availableKeys.length === 0) {
      this.logWarn('All API keys are rate-limited');
      return false;
    }

    return true;
  }

  /**
   * Fetch exchange rates for a specific date
   */
  async fetchRatesForDate(params: FetchRatesParams): Promise<ExchangeRateResult | null> {
    const formattedDate = this.formatDate(params.date);
    const baseCurrency = this.getBaseCurrency(params);

    const apiKeys = this.getApiKeys();
    if (apiKeys.length === 0) {
      this.logError('No API keys configured');
      return null;
    }

    // Filter out rate-limited keys
    const availableKeys = await ApiKeyRateLimitService.filterAvailableKeys('apilayer', apiKeys);
    if (availableKeys.length === 0) {
      this.logWarn('All API keys are rate-limited');
      return null;
    }

    const url = `${API_LAYER_BASE_URL}/${formattedDate}?base=${baseCurrency}`;

    // Try each available API key until success
    for (let i = 0; i < availableKeys.length; i++) {
      const currentApiKey = availableKeys[i]!;

      try {
        this.logInfo(`Fetching rates for ${formattedDate} (attempt ${i + 1}/${availableKeys.length})`);

        const response = await axios.get<ApiLayerResponse>(url, {
          headers: {
            apikey: currentApiKey,
          },
          timeout: REQUEST_TIMEOUT,
          responseType: 'json',
        });

        if (!response.data || !response.data.rates || !response.data.success) {
          this.logWarn(`Invalid response for date ${formattedDate}`);
          continue;
        }

        // Validate base currency
        if (response.data.base !== baseCurrency) {
          this.logError(`Expected base ${baseCurrency}, got ${response.data.base}`);
          continue;
        }

        // Filter to only currencies we have in our database
        const allCurrencies = await Currencies.findAll();
        const validCurrencyCodes = new Set(allCurrencies.map((c) => c.code));

        const filteredRates: Record<string, number> = {};
        for (const [code, rate] of Object.entries(response.data.rates)) {
          if (validCurrencyCodes.has(code) && code !== baseCurrency) {
            filteredRates[code] = rate;
          }
        }

        // Apply additional target currency filter if specified
        const rates = this.filterRatesByCurrencies({
          rates: filteredRates,
          targetCurrencies: params.targetCurrencies,
        });

        this.logInfo(`Fetched ${Object.keys(rates).length} rates for ${formattedDate}`);

        return {
          date: response.data.date,
          baseCurrency: response.data.base,
          rates,
        };
      } catch (error) {
        const shouldContinue = await this.handleApiError({
          error,
          apiKey: currentApiKey,
          keyIndex: i,
          totalKeys: availableKeys.length,
          date: formattedDate,
        });

        if (!shouldContinue) {
          return null;
        }
        // Continue to next API key
      }
    }

    this.logError('All API keys exhausted without success');
    return null;
  }

  /**
   * Handle API errors with rate limit tracking
   * @returns true if should continue to next key, false if should abort
   */
  private async handleApiError({
    error,
    apiKey,
    keyIndex,
    totalKeys,
    date,
  }: {
    error: unknown;
    apiKey: string;
    keyIndex: number;
    totalKeys: number;
    date: string;
  }): Promise<boolean> {
    if (!isAxiosError(error)) {
      this.logError('Unknown error', {
        error: error instanceof Error ? error.message : String(error),
        date,
      });
      return true; // Try next key
    }

    const statusCode = error.response?.status;
    const params = { date, apiKeyIndex: keyIndex + 1, totalKeys };

    // No response (timeout, network) is unrelated to the key, so rotating would repeat the same failure per key.
    if (!error.response) {
      this.logError(error.code === 'ECONNABORTED' ? 'Request timeout' : 'Network error', {
        ...params,
        code: error.code,
        errorMessage: error.message,
      });
      return false;
    }

    if (statusCode === 429) {
      // Rate limited - mark key and try next
      await ApiKeyRateLimitService.markAsRateLimited('apilayer', apiKey, 'HTTP 429 Too Many Requests');
      this.logInfo(`Rate limit hit for key ${keyIndex + 1}/${totalKeys}`, params);
      return true; // Try next key
    }

    if (statusCode === 400) {
      this.logError('Bad request (400)', params);
      return false; // Abort - request is invalid
    }

    if (statusCode === 401) {
      this.logError('Invalid API key (401)', params);
      return true; // Try next key
    }

    if (statusCode === 404) {
      this.logError('Not found (404)', params);
      return false; // Abort - date likely invalid
    }

    if (statusCode && statusCode >= 500) {
      this.logError(`Server error (${statusCode})`, params);
      return true; // Try next key
    }

    this.logError('Unhandled error', {
      ...params,
      statusCode,
      message: error.message,
    });
    return true; // Try next key
  }
}
