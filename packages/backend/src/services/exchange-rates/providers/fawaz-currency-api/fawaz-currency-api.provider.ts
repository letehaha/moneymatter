/**
 * fawazahmed0 / exchange-api Provider
 *
 * Free, key-less currency rate CDN (jsDelivr primary, Cloudflare mirror as
 * fallback). Same USD-per-quote convention as the other providers, but the base
 * and quote keys arrive LOWERCASE. Single-date only — there is NO range
 * endpoint — so it deliberately stays out of the historical backfill.
 *
 * Free, so it covers the exotic long tail on fresh dates — but only from
 * 2024-03-02 onward; earlier dates 404.
 */
import Currencies from '@models/currencies.model';
import axios, { AxiosResponse, isAxiosError } from 'axios';

import { BaseExchangeRateProvider } from '../base-provider';
import {
  EXCHANGE_RATE_PROVIDER_TYPE,
  ExchangeRateProviderMetadata,
  ExchangeRateResult,
  FetchRatesParams,
} from '../types';

/**
 * fawazahmed0 single-date response. The base-currency key (e.g. `usd`) holds the
 * quote->rate map; both the base key and the quote keys are lowercase.
 */
interface FawazResponse {
  date: string;
  [base: string]: string | Record<string, number>;
}

// Data floor: dates before this 404 on both mirrors, so we never hit the network below it.
const FAWAZ_MIN_DATE = '2024-03-02';
const REQUEST_TIMEOUT = 10000; // 10 seconds

// Dated (immutable) endpoints. `@latest` is intentionally avoided — the CDN caches
// it and can lag by a day. `date` = yyyy-MM-dd, `base` = lowercase currency code.
const buildJsDelivrUrl = ({ date, base }: { date: string; base: string }): string =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${base}.min.json`;
const buildCloudflareUrl = ({ date, base }: { date: string; base: string }): string =>
  `https://${date}.currency-api.pages.dev/v1/currencies/${base}.min.json`;

export class FawazCurrencyApiProvider extends BaseExchangeRateProvider {
  readonly metadata: ExchangeRateProviderMetadata = {
    type: EXCHANGE_RATE_PROVIDER_TYPE.FAWAZ_CURRENCY_API,
    name: 'Fawaz Currency API',
    description: 'Free CDN rates, 200+ currencies incl. exotic tail, from 2024-03-02',
    supportedCurrencies: undefined,
    minHistoricalDate: FAWAZ_MIN_DATE,
    // supportsHistoricalDataLoading intentionally unset: there is no range endpoint,
    // so this provider is excluded from the startup historical backfill (like ApiLayer).
  };

  /**
   * Always available: public CDN with no credentials to validate.
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Deliberately NO yesterday-fallback here (unlike currency-rates-api): a stale
   * whole-basket result would be stored under the requested date, satisfy the
   * comprehensiveness gate, and suppress the ApiLayer fallback — silently pinning
   * day-old rates. Returning null instead lets the chain reach ApiLayer, which
   * serves the real requested date.
   */
  async fetchRatesForDate(params: FetchRatesParams): Promise<ExchangeRateResult | null> {
    return this.fetchRatesForSingleDate(params);
  }

  /**
   * Fetch rates for a single specific date (no fallback). Tries the jsDelivr CDN
   * first and falls back to the Cloudflare mirror on any failure.
   */
  private async fetchRatesForSingleDate(params: FetchRatesParams): Promise<ExchangeRateResult | null> {
    const formattedDate = this.formatDate(params.date);

    // Below the data floor every request is a guaranteed 404, so skip the network
    // entirely — this keeps ApiLayer the sole source for pre-2024 dates.
    if (formattedDate < FAWAZ_MIN_DATE) {
      this.logInfo(`Date ${formattedDate} is before the data floor ${FAWAZ_MIN_DATE}, skipping fetch`);
      return null;
    }

    const base = this.getBaseCurrency(params).toLowerCase();

    // jsDelivr is primary; the Cloudflare mirror is the README-recommended fallback.
    const candidateUrls = [
      buildJsDelivrUrl({ date: formattedDate, base }),
      buildCloudflareUrl({ date: formattedDate, base }),
    ];

    this.logInfo(`Fetching rates for ${formattedDate}`);

    let response: AxiosResponse<FawazResponse> | null = null;
    let lastError: unknown = null;
    for (const url of candidateUrls) {
      try {
        response = await axios.get<FawazResponse>(url, {
          timeout: REQUEST_TIMEOUT,
          responseType: 'json',
        });
        break;
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        // A 404 means this date's snapshot isn't published yet — the dated tag
        // for the current day lags by a few hours — or the date genuinely has no
        // data. Either way it's an expected miss the chain recovers from via the
        // next provider, so keep it out of Sentry. Only a genuinely unexpected
        // mirror failure (network, timeout, 5xx) warrants a warning.
        if (status === 404) {
          this.logInfo(`No data at ${url} (404)`);
        } else {
          this.logWarn(`Fetch failed from ${url}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
        lastError = error;
      }
    }

    if (!response) {
      const status = isAxiosError(lastError) ? lastError.response?.status : undefined;
      // 404 = no published snapshot for this date yet; an expected miss the next
      // provider covers, so return null and let the registry stay quiet. Anything
      // else (5xx, timeout, network) is a real outage — rethrow so it pages.
      if (status === 404) {
        this.logInfo(`No data available for ${formattedDate}`);
        return null;
      }
      throw lastError;
    }

    const rateMap = response.data?.[base] as Record<string, number> | undefined;
    if (!rateMap) {
      this.logInfo(`Invalid response for date ${formattedDate}`);
      return null;
    }

    // Keep only currencies we track; upcase keys to our canonical form and drop
    // the base's own self-rate.
    const validCodes = new Set((await Currencies.findAll()).map((c) => c.code));
    const baseUpper = base.toUpperCase();
    const filteredRates: Record<string, number> = {};
    for (const [code, rate] of Object.entries(rateMap)) {
      const upperCode = code.toUpperCase();
      if (validCodes.has(upperCode) && upperCode !== baseUpper) {
        filteredRates[upperCode] = rate;
      }
    }

    // Apply the optional target-currency filter on top of the tracked-currency filter.
    const rates = this.filterRatesByCurrencies({
      rates: filteredRates,
      targetCurrencies: params.targetCurrencies,
    });

    this.logInfo(`Fetched ${Object.keys(rates).length} rates for ${formattedDate}`);

    return {
      date: response.data.date ?? formattedDate,
      baseCurrency: baseUpper,
      rates,
    };
  }
}
