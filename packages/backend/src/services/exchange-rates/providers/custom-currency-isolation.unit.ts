import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { logger } from '@js/utils';
import Currencies, { getAllCurrencies } from '@models/currencies.model';
import axios from 'axios';

import { ApiKeyRateLimitService } from '../api-key-rate-limit.service';
import { ApiLayerProvider } from './api-layer';
import { BaseExchangeRateProvider } from './base-provider';
import { FawazCurrencyApiProvider } from './fawaz-currency-api';
import { exchangeRateProviderRegistry } from './registry';
import {
  EXCHANGE_RATE_PROVIDER_TYPE,
  ExchangeRateProviderMetadata,
  ExchangeRateResult,
  FetchRatesParams,
} from './types';

type CurrencyRow = { code: string; isCustom: boolean };

// ISO rows plus user-defined rows that look like the crypto tickers the providers also quote.
const CURRENCY_ROWS: CurrencyRow[] = [
  { code: 'USD', isCustom: false },
  { code: 'EUR', isCustom: false },
  { code: 'UAH', isCustom: false },
  { code: 'BTC', isCustom: true },
  { code: 'USDT', isCustom: true },
];

/**
 * Stands in for the `Currencies` table: honours a `where.isCustom` filter and otherwise returns every
 * row, so a query that forgets the filter returns the custom rows and the assertions below fail.
 */
const fakeFindAll = async (options?: unknown) => {
  const where = (options as { where?: { isCustom?: boolean } } | undefined)?.where;
  return CURRENCY_ROWS.filter((row) => where?.isCustom === undefined || row.isCustom === where.isCustom);
};

class StubProvider extends BaseExchangeRateProvider {
  readonly metadata: ExchangeRateProviderMetadata;

  readonly fetchRatesForDate = jest.fn<(params: FetchRatesParams) => Promise<ExchangeRateResult | null>>();

  constructor({ type, rates }: { type: EXCHANGE_RATE_PROVIDER_TYPE; rates: Record<string, number> }) {
    super();
    this.metadata = { type, name: type, description: type };
    this.fetchRatesForDate.mockResolvedValue({ date: '2026-10-01', baseCurrency: 'USD', rates });
  }

  async isAvailable() {
    return true;
  }
}

describe('custom currencies stay out of the global rate pipeline', () => {
  beforeEach(() => {
    jest.spyOn(Currencies, 'findAll').mockImplementation(fakeFindAll as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getAllCurrencies', () => {
    it('lists ISO currencies only', async () => {
      const codes = (await getAllCurrencies()).map((currency) => currency.code);

      expect(codes).toEqual(['USD', 'EUR', 'UAH']);
    });
  });

  describe('provider registry coverage', () => {
    const primary = new StubProvider({
      type: EXCHANGE_RATE_PROVIDER_TYPE.CURRENCY_RATES_API,
      rates: { EUR: 0.9, UAH: 41 },
    });
    const fallback = new StubProvider({
      type: EXCHANGE_RATE_PROVIDER_TYPE.API_LAYER,
      rates: { EUR: 0.95, UAH: 40 },
    });

    it('stops at the first provider once every ISO currency is covered, despite custom rows', async () => {
      exchangeRateProviderRegistry.register(primary);
      exchangeRateProviderRegistry.register(fallback);
      const info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
      const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);

      const result = await exchangeRateProviderRegistry.fetchRatesWithFallback({
        date: new Date('2026-10-01T00:00:00Z'),
        baseCurrency: 'USD',
      });

      expect(result?.merged.rates).toEqual({
        EUR: { rate: 0.9, source: EXCHANGE_RATE_PROVIDER_TYPE.CURRENCY_RATES_API },
        UAH: { rate: 41, source: EXCHANGE_RATE_PROVIDER_TYPE.CURRENCY_RATES_API },
      });
      // The early stop fired: the paid fallback was never called.
      expect(fallback.fetchRatesForDate).not.toHaveBeenCalled();
      // Coverage is "complete": no missing-currencies report and no degraded-sync alert.
      expect(info).not.toHaveBeenCalledWith(
        '[exchange-rates] Enabled currencies missing from sync result',
        expect.anything(),
      );
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('fawaz provider', () => {
    it('never ingests a custom code, even when fawaz quotes the same ticker', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: { date: '2026-10-01', usd: { eur: 0.9, uah: 41, btc: 0.00001, usdt: 1 } },
      });

      const result = await new FawazCurrencyApiProvider().fetchRatesForDate({
        date: new Date('2026-10-01T00:00:00Z'),
        baseCurrency: 'USD',
      });

      expect(result?.rates).toEqual({ EUR: 0.9, UAH: 41 });
    });
  });

  describe('ApiLayer provider', () => {
    const originalKeys = process.env.API_LAYER_API_KEYS;

    beforeEach(() => {
      process.env.API_LAYER_API_KEYS = 'test-key-123456';
      jest.spyOn(ApiKeyRateLimitService, 'filterAvailableKeys').mockResolvedValue(['test-key-123456']);
    });

    afterEach(() => {
      if (originalKeys === undefined) {
        delete process.env.API_LAYER_API_KEYS;
      } else {
        process.env.API_LAYER_API_KEYS = originalKeys;
      }
    });

    it('never ingests a custom code, even when ApiLayer quotes the same ticker', async () => {
      jest.spyOn(axios, 'get').mockResolvedValue({
        data: {
          success: true,
          base: 'USD',
          date: '2026-10-01',
          historical: true,
          timestamp: 0,
          rates: { EUR: 0.9, UAH: 41, BTC: 0.00001, USDT: 1 },
        },
      });

      const result = await new ApiLayerProvider().fetchRatesForDate({
        date: new Date('2026-10-01T00:00:00Z'),
        baseCurrency: 'USD',
      });

      expect(result?.rates).toEqual({ EUR: 0.9, UAH: 41 });
    });
  });
});
