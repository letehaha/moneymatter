import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as usersCurrencies from '@models/users-currencies.model';
import { RateLimitService } from '@services/common/rate-limit.service';
import { RATE_SOURCE_SAVE_LIMIT, RATE_SOURCE_TEST_LIMIT } from '@services/common/user-rate-limits';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import * as coingecko from '@services/currencies/rate-sources/coingecko';
import * as rateHistory from '@services/currencies/rate-sources/rate-history.service';
import * as saveRateSource from '@services/currencies/rate-sources/save-rate-source.service';
import * as testRateSource from '@services/currencies/rate-sources/test-http-rate-source.service';
import { captureTools, makeExtra, parseToolResult, type ToolResult } from '@tests/helpers/mcp-tools';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/currencies/rate-sources/coingecko', () => ({ searchCoingeckoCoins: jest.fn() }));
jest.mock('@services/currencies/rate-sources/rate-history.service', () => ({ listCurrencyRateHistory: jest.fn() }));
jest.mock('@services/currencies/rate-sources/save-rate-source.service', () => ({ saveCurrencyRateSource: jest.fn() }));
jest.mock('@services/currencies/rate-sources/test-http-rate-source.service', () => ({ testHttpRateSource: jest.fn() }));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@services/common/rate-limit.service', () => ({ RateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('@models/users-currencies.model', () => ({ getCurrency: jest.fn() }));

import { getCurrencyRateHistoryTool } from './get-currency-rate-history';
import { searchCoingeckoCoinsTool } from './search-coingecko-coins';
import { setCurrencyRateSourceTool } from './set-currency-rate-source';
import { testCurrencyRateSourceTool } from './test-currency-rate-source';

const READ = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });

const parsed = (result: ToolResult) => parseToolResult({ result });

const toolOf = (register: Parameters<typeof captureTools>[0]['register']) => {
  const tool = captureTools({ register })[0]!;
  return { tool, schema: tool.config.inputSchema! };
};

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const checkRateLimit = jest.mocked(RateLimitService.checkRateLimit);
const coingeckoService = jest.mocked(coingecko);
const historyService = jest.mocked(rateHistory);
const saveService = jest.mocked(saveRateSource);
const testService = jest.mocked(testRateSource);
const getCurrency = jest.mocked(usersCurrencies.getCurrency);

const httpConfig = {
  urlTemplate: 'https://rates.example.com/{code}?day={date}&quote={quote}',
  jsonPath: 'data.price',
  quoteCurrency: 'USD',
};

beforeEach(() => {
  jest.resetAllMocks();
  lockCheck.mockResolvedValue(false);
  checkRateLimit.mockResolvedValue({ allowed: true });
});

describe('search_coingecko_coins', () => {
  const { tool, schema } = toolOf(searchCoingeckoCoinsTool);

  it('rejects an empty or too long query', () => {
    expect(schema.safeParse({ query: 'bitcoin' }).success).toBe(true);
    expect(schema.safeParse({ query: '' }).success).toBe(false);
    expect(schema.safeParse({ query: '   ' }).success).toBe(false);
    expect(schema.safeParse({ query: 'x'.repeat(101) }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('searches without a scope helper and returns the coins', async () => {
    const coins = [{ coinId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', logoUrl: null, marketCapRank: 1 }];
    coingeckoService.searchCoingeckoCoins.mockResolvedValueOnce(coins);

    const result = await tool.handler({ query: 'bitcoin' }, READ);

    expect(coingeckoService.searchCoingeckoCoins).toHaveBeenCalledWith({ query: 'bitcoin' });
    expect(parsed(result)).toEqual(coins);
  });

  it('passes the unavailable-key refusal of the service through', async () => {
    coingeckoService.searchCoingeckoCoins.mockRejectedValueOnce(new Error('CoinGecko is not available'));

    await expect(tool.handler({ query: 'bitcoin' }, READ)).rejects.toThrow('CoinGecko is not available');
  });
});

describe('get_currency_rate_history', () => {
  const { tool, schema } = toolOf(getCurrencyRateHistoryTool);

  it('accepts a code with paging and rejects a limit or offset out of range', () => {
    expect(schema.safeParse({ code: 'usdt' }).success).toBe(true);
    expect(schema.safeParse({ code: 'USDT', limit: 100, offset: 0 }).success).toBe(true);
    expect(schema.safeParse({ code: 'USDT', limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ code: 'USDT', limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ code: 'USDT', offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ code: 'USDT', limit: 1.5 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('defaults to the first page of 30 and returns the service result', async () => {
    const page = { items: [], totalCount: 0 };
    historyService.listCurrencyRateHistory.mockResolvedValueOnce(page as never);

    const result = await tool.handler({ code: 'USDT' }, READ);

    expect(historyService.listCurrencyRateHistory).toHaveBeenCalledWith({
      userId: 42,
      code: 'USDT',
      limit: 30,
      offset: 0,
    });
    expect(parsed(result)).toEqual(page);
  });

  it('passes the page it was given', async () => {
    historyService.listCurrencyRateHistory.mockResolvedValueOnce({ items: [] } as never);

    await tool.handler({ code: 'USDT', limit: 10, offset: 20 }, READ);

    expect(historyService.listCurrencyRateHistory).toHaveBeenCalledWith({
      userId: 42,
      code: 'USDT',
      limit: 10,
      offset: 20,
    });
  });
});

describe('set_currency_rate_source', () => {
  const { tool, schema } = toolOf(setCurrencyRateSourceTool);

  const peg = { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1.02 } };
  const coingeckoSource = {
    rateSource: 'coingecko',
    config: { coinId: 'tether', quoteCurrency: 'USD' },
    logoUrl: 'https://example.com/tether.png',
  };
  const http = { rateSource: 'http', config: { ...httpConfig, headers: { 'X-Api-Key': 'sk-live-secret' } } };

  it.each([
    { label: 'manual rates', input: { rateSource: 'manual' } },
    { label: 'a peg', input: peg },
    { label: 'a CoinGecko coin with its logo', input: coingeckoSource },
    { label: 'an HTTP source with headers', input: http },
  ])('accepts $label', ({ input }) => {
    expect(schema.safeParse({ code: 'USDT', ...input }).success).toBe(true);
  });

  it.each([
    { label: 'an unknown source', input: { rateSource: 'oracle' } },
    { label: 'the market provider, which is not a custom source', input: { rateSource: 'provider' } },
    { label: 'a missing source', input: {} },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse({ code: 'USDT', ...input }).success).toBe(false);
  });

  it('saves through saveCurrencyRateSource with the user, the code and the parsed body', async () => {
    const saved = { currencyCode: 'USDT', rateSource: 'peg', rateSourceConfig: peg.config };
    saveService.saveCurrencyRateSource.mockResolvedValueOnce(saved as never);

    const result = await tool.handler({ code: 'USDT', ...peg }, WRITE);

    expect(saveService.saveCurrencyRateSource).toHaveBeenCalledWith({ userId: 42, code: 'USDT', body: peg });
    expect(parsed(result)).toEqual(saved);
  });

  it('sends a CoinGecko body with its logo', async () => {
    saveService.saveCurrencyRateSource.mockResolvedValueOnce({} as never);

    await tool.handler({ code: 'USDT', ...coingeckoSource }, WRITE);

    expect(saveService.saveCurrencyRateSource).toHaveBeenCalledWith({
      userId: 42,
      code: 'USDT',
      body: coingeckoSource,
    });
  });

  it('refuses a body the source does not allow, such as a config on manual or a peg without one', async () => {
    await expect(tool.handler({ code: 'USDT', rateSource: 'manual', config: peg.config }, WRITE)).rejects.toThrow();
    await expect(tool.handler({ code: 'USDT', rateSource: 'peg' }, WRITE)).rejects.toThrow();
    expect(saveService.saveCurrencyRateSource).not.toHaveBeenCalled();
  });

  describe('a CoinGecko config without a quote', () => {
    const resent = schema.parse({ code: 'USDT', rateSource: 'coingecko', config: { coinId: 'tether' } });
    const savedOn = (config: { coinId: string; quoteCurrency: string }) =>
      getCurrency.mockResolvedValueOnce({ rateSource: 'coingecko', rateSourceConfig: config } as never);
    const sentQuote = () =>
      (saveService.saveCurrencyRateSource.mock.calls[0]![0].body as { config: { quoteCurrency: string } }).config
        .quoteCurrency;

    beforeEach(() => {
      saveService.saveCurrencyRateSource.mockResolvedValueOnce({} as never);
    });

    it('keeps the saved quote when the coin is the one already saved', async () => {
      savedOn({ coinId: 'tether', quoteCurrency: 'EUR' });

      await tool.handler(resent, WRITE);

      expect(getCurrency).toHaveBeenCalledWith({ userId: 42, currencyCode: 'USDT' });
      expect(sentQuote()).toBe('EUR');
    });

    it('takes USD for another coin', async () => {
      savedOn({ coinId: 'bitcoin', quoteCurrency: 'EUR' });

      await tool.handler(resent, WRITE);

      expect(sentQuote()).toBe('USD');
    });

    it('takes USD for a currency that is not on CoinGecko', async () => {
      getCurrency.mockResolvedValueOnce({ rateSource: 'manual', rateSourceConfig: null } as never);

      await tool.handler(resent, WRITE);

      expect(sentQuote()).toBe('USD');
    });

    it('sends a quote it was given without reading the saved one', async () => {
      await tool.handler(
        schema.parse({ code: 'USDT', rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: 'GBP' } }),
        WRITE,
      );

      expect(getCurrency).not.toHaveBeenCalled();
      expect(sentQuote()).toBe('GBP');
    });
  });

  it('is refused without the write scope, for read-only and for demo users', async () => {
    const input = { code: 'USDT', rateSource: 'manual' };

    await expect(tool.handler(input, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler(input, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    await expect(tool.handler(input, makeExtra({ scopes: ['finance:write'], role: USER_ROLES.demo }))).rejects.toThrow(
      /demo mode/,
    );
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(saveService.saveCurrencyRateSource).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set, without spending the rate budget', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ code: 'USDT', rateSource: 'manual' }, WRITE)).rejects.toThrow(
      /currencies.baseCurrencyChangeInProgress/,
    );
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(saveService.saveCurrencyRateSource).not.toHaveBeenCalled();
  });

  it('draws from the save budget of the user, the one the REST middleware uses', async () => {
    saveService.saveCurrencyRateSource.mockResolvedValueOnce({} as never);

    await tool.handler({ code: 'USDT', rateSource: 'manual' }, WRITE);

    expect(checkRateLimit).toHaveBeenCalledWith(
      RATE_SOURCE_SAVE_LIMIT.key({ userId: 42 }),
      RATE_SOURCE_SAVE_LIMIT.windowSeconds,
      RATE_SOURCE_SAVE_LIMIT.maxAttempts,
    );
    expect(RATE_SOURCE_SAVE_LIMIT.key({ userId: 42 })).toBe('rate-source-save:user:42');
  });
});

describe('test_currency_rate_source', () => {
  const { tool, schema } = toolOf(testCurrencyRateSourceTool);

  it('accepts an HTTP config with an optional date and rejects a bad config or date', () => {
    expect(schema.safeParse({ code: 'USDT', config: httpConfig }).success).toBe(true);
    expect(schema.safeParse({ code: 'USDT', config: httpConfig, date: '2026-10-01' }).success).toBe(true);
    expect(schema.safeParse({ code: 'USDT', config: { ...httpConfig, jsonPath: '' } }).success).toBe(false);
    expect(schema.safeParse({ code: 'USDT', config: httpConfig, date: '01/10/2026' }).success).toBe(false);
    expect(schema.safeParse({ code: 'USDT' }).success).toBe(false);
  });

  it('previews through testHttpRateSource and returns its answer as is', async () => {
    const answer = { ok: true as const, date: '2026-10-01', rate: 0.41, quoteCurrency: 'USD' };
    testService.testHttpRateSource.mockResolvedValueOnce(answer);

    const result = await tool.handler({ code: 'USDT', config: httpConfig, date: '2026-10-01' }, WRITE);

    expect(testService.testHttpRateSource).toHaveBeenCalledWith({
      userId: 42,
      code: 'USDT',
      body: { rateSource: 'http', config: httpConfig, date: '2026-10-01' },
    });
    expect(parsed(result)).toEqual(answer);
  });

  it('draws from the preview budget of the user, not the save one', async () => {
    testService.testHttpRateSource.mockResolvedValueOnce({ ok: false, reason: 'x', message: 'y' } as never);

    await tool.handler({ code: 'USDT', config: httpConfig }, WRITE);

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(checkRateLimit).toHaveBeenCalledWith(
      RATE_SOURCE_TEST_LIMIT.key({ userId: 42 }),
      RATE_SOURCE_TEST_LIMIT.windowSeconds,
      RATE_SOURCE_TEST_LIMIT.maxAttempts,
    );
    expect(RATE_SOURCE_TEST_LIMIT.key({ userId: 42 })).toBe('rate-source-test:user:42');
  });

  it('is refused when the limiter cannot count, as its route is', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: true, serviceUnavailable: true });

    await expect(tool.handler({ code: 'USDT', config: httpConfig }, WRITE)).rejects.toThrow(
      /middleware.tooManyRequests/,
    );
    expect(testService.testHttpRateSource).not.toHaveBeenCalled();
  });

  it('is refused without the write scope or for a read-only user', async () => {
    await expect(
      tool.handler({ code: 'USDT', config: httpConfig }, makeExtra({ scopes: ['finance:read'] })),
    ).rejects.toThrow(/Missing required scope: finance:write/);
    await expect(
      tool.handler({ code: 'USDT', config: httpConfig }, makeExtra({ scopes: ['finance:write'], readOnly: true })),
    ).rejects.toThrow(/no longer includes editing/);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(testService.testHttpRateSource).not.toHaveBeenCalled();
  });

  it('does not check the base-currency lock, as its route does not', async () => {
    lockCheck.mockResolvedValue(true);
    testService.testHttpRateSource.mockResolvedValueOnce({ ok: true } as never);

    await expect(tool.handler({ code: 'USDT', config: httpConfig }, WRITE)).resolves.toBeDefined();
    expect(lockCheck).not.toHaveBeenCalled();
  });
});
