import { USER_ROLES } from '@bt/shared/types';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import { RATE_SOURCE_SAVE_LIMIT, RATE_SOURCE_TEST_LIMIT } from '@services/common/user-rate-limits';
import { isBaseCurrencyChangeLocked } from '@services/currencies/base-currency-lock';
import * as coingecko from '@services/currencies/rate-sources/coingecko';
import * as rateHistory from '@services/currencies/rate-sources/rate-history.service';
import * as saveRateSource from '@services/currencies/rate-sources/save-rate-source.service';
import * as testRateSource from '@services/currencies/rate-sources/test-http-rate-source.service';
import * as userExchangeRates from '@services/user-exchange-rate';
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';
import { z } from 'zod';

// Blocks the real services, whose import chains build queues at module scope and
// would open Redis connections in a unit test.
jest.mock('@services/currencies/rate-sources/coingecko', () => ({ searchCoingeckoCoins: jest.fn() }));
jest.mock('@services/currencies/rate-sources/rate-history.service', () => ({ listCurrencyRateHistory: jest.fn() }));
jest.mock('@services/currencies/rate-sources/save-rate-source.service', () => ({ saveCurrencyRateSource: jest.fn() }));
jest.mock('@services/currencies/rate-sources/test-http-rate-source.service', () => ({ testHttpRateSource: jest.fn() }));
jest.mock('@services/user-exchange-rate', () => ({
  editUserExchangeRates: jest.fn(),
  removeUserExchangeRates: jest.fn(),
}));
jest.mock('@services/currencies/base-currency-lock', () => ({ isBaseCurrencyChangeLocked: jest.fn() }));
jest.mock('@services/common/rate-limit.service', () => ({ RateLimitService: { checkRateLimit: jest.fn() } }));

import { registerDeleteExchangeRates } from './delete-exchange-rates';
import { registerGetCurrencyRateHistory } from './get-currency-rate-history';
import { registerSearchCoingeckoCoins } from './search-coingecko-coins';
import { registerSetCurrencyRateSource } from './set-currency-rate-source';
import { registerSetExchangeRates } from './set-exchange-rates';
import { registerTestCurrencyRateSource } from './test-currency-rate-source';

const READ = makeExtra({ scopes: ['finance:read'], readOnly: true });
const WRITE = makeExtra({ scopes: ['finance:read', 'finance:write'] });
const DELETE = makeExtra({ scopes: ['finance:read', 'finance:delete'] });

const lockCheck = jest.mocked(isBaseCurrencyChangeLocked);
const checkRateLimit = jest.mocked(RateLimitService.checkRateLimit);
const coingeckoService = jest.mocked(coingecko);
const historyService = jest.mocked(rateHistory);
const saveService = jest.mocked(saveRateSource);
const testService = jest.mocked(testRateSource);
const ratesService = jest.mocked(userExchangeRates);

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
  const tool = captureTools({ register: registerSearchCoingeckoCoins })[0]!;
  const schema = z.object(tool.config.inputSchema!);

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
    expect(parseToolResult({ result })).toEqual(coins);
  });

  it('passes the unavailable-key refusal of the service through', async () => {
    coingeckoService.searchCoingeckoCoins.mockRejectedValueOnce(new Error('CoinGecko is not available'));

    await expect(tool.handler({ query: 'bitcoin' }, READ)).rejects.toThrow('CoinGecko is not available');
  });
});

describe('get_currency_rate_history', () => {
  const tool = captureTools({ register: registerGetCurrencyRateHistory })[0]!;
  const schema = z.object(tool.config.inputSchema!);

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
    expect(parseToolResult({ result })).toEqual(page);
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
  const tool = captureTools({ register: registerSetCurrencyRateSource })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const peg = { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 1.02 } };
  const coingeckoSource = {
    rateSource: 'coingecko',
    config: { coinId: 'tether', quoteCurrency: 'USD' },
    logoUrl: 'https://example.com/tether.png',
  };
  const http = { rateSource: 'http', config: { ...httpConfig, headers: { 'X-Api-Key': 'sk-live-secret' } } };

  it.each([
    { label: 'the market provider', input: { rateSource: 'provider' } },
    { label: 'manual rates', input: { rateSource: 'manual' } },
    { label: 'a peg', input: peg },
    { label: 'a CoinGecko coin with its logo', input: coingeckoSource },
    { label: 'an HTTP source with headers', input: http },
  ])('accepts $label', ({ input }) => {
    expect(schema.safeParse({ code: 'USDT', ...input }).success).toBe(true);
  });

  it.each([
    { label: 'an unknown source', input: { rateSource: 'oracle' } },
    { label: 'a missing source', input: {} },
    { label: 'a peg with a zero factor', input: { rateSource: 'peg', config: { pegCurrency: 'USD', factor: 0 } } },
    { label: 'a peg with an unknown key', input: { rateSource: 'peg', config: { ...peg.config, extra: 1 } } },
    {
      label: 'an HTTP URL with credentials',
      input: { rateSource: 'http', config: { ...httpConfig, urlTemplate: 'https://u:p@example.com/{code}' } },
    },
    { label: 'a CoinGecko coin id with spaces', input: { rateSource: 'coingecko', config: { coinId: 'not a coin' } } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse({ code: 'USDT', ...input }).success).toBe(false);
  });

  it('saves through saveCurrencyRateSource with the user, the code and the parsed body', async () => {
    const saved = { currencyCode: 'USDT', rateSource: 'peg', rateSourceConfig: peg.config };
    saveService.saveCurrencyRateSource.mockResolvedValueOnce(saved as never);

    const result = await tool.handler({ code: 'USDT', ...peg }, WRITE);

    expect(saveService.saveCurrencyRateSource).toHaveBeenCalledWith({ userId: 42, code: 'USDT', body: peg });
    expect(parseToolResult({ result })).toEqual(saved);
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

  it('refuses a body the source does not allow, such as a config on the market provider or a peg without one', async () => {
    await expect(tool.handler({ code: 'USDT', rateSource: 'provider', config: peg.config }, WRITE)).rejects.toThrow();
    await expect(tool.handler({ code: 'USDT', rateSource: 'peg' }, WRITE)).rejects.toThrow();
    expect(saveService.saveCurrencyRateSource).not.toHaveBeenCalled();
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

  it('is refused when the limiter says no', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remainingSeconds: 12 });

    await expect(tool.handler({ code: 'USDT', rateSource: 'manual' }, WRITE)).rejects.toThrow(
      /middleware.tooManyRequests/,
    );
    expect(saveService.saveCurrencyRateSource).not.toHaveBeenCalled();
  });
});

describe('test_currency_rate_source', () => {
  const tool = captureTools({ register: registerTestCurrencyRateSource })[0]!;
  const schema = z.object(tool.config.inputSchema!);

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
    expect(parseToolResult({ result })).toEqual(answer);
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

  it('is refused when the limiter says no', async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remainingSeconds: 12 });

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

describe('set_exchange_rates', () => {
  const tool = captureTools({ register: registerSetExchangeRates })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const pairs = [
    { baseCode: 'USDT', quoteCode: 'USD', rate: 1.01 },
    { baseCode: 'USD', quoteCode: 'USDT', rate: 0.99, effectiveDate: '2026-10-01' },
  ];

  it('accepts pairs with an optional effective date', () => {
    expect(schema.safeParse({ pairs }).success).toBe(true);
  });

  it.each([
    { label: 'no pairs', input: { pairs: [] } },
    { label: 'a zero rate', input: { pairs: [{ baseCode: 'USDT', quoteCode: 'USD', rate: 0 }] } },
    { label: 'a negative rate', input: { pairs: [{ baseCode: 'USDT', quoteCode: 'USD', rate: -1 }] } },
    { label: 'an unknown key', input: { pairs: [{ baseCode: 'USDT', quoteCode: 'USD', rate: 1, note: 'x' }] } },
    { label: 'a missing quote', input: { pairs: [{ baseCode: 'USDT', rate: 1 }] } },
    { label: 'a malformed effective date', input: { pairs: [{ ...pairs[0], effectiveDate: 'yesterday' }] } },
  ])('rejects $label', ({ input }) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it('hands the pairs to editUserExchangeRates, which enforces the pair rules, and returns its result', async () => {
    const edited = { rates: [], remeasure: { updated: 0, failed: 0 } };
    ratesService.editUserExchangeRates.mockResolvedValueOnce(edited as never);

    const result = await tool.handler({ pairs }, WRITE);

    expect(ratesService.editUserExchangeRates).toHaveBeenCalledWith({ userId: 42, pairs });
    expect(parseToolResult({ result })).toEqual(edited);
  });

  it('passes a refusal of the service through', async () => {
    ratesService.editUserExchangeRates.mockRejectedValueOnce(new Error('you need to also change opposite pair'));

    await expect(tool.handler({ pairs: [pairs[0]] }, WRITE)).rejects.toThrow('opposite pair');
  });

  it('is refused without the write scope, for read-only users and while the lock is set', async () => {
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:read'] }))).rejects.toThrow(
      /Missing required scope: finance:write/,
    );
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:write'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    lockCheck.mockResolvedValueOnce(true);
    await expect(tool.handler({ pairs }, WRITE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(ratesService.editUserExchangeRates).not.toHaveBeenCalled();
  });
});

describe('delete_exchange_rates', () => {
  const tool = captureTools({ register: registerDeleteExchangeRates })[0]!;
  const schema = z.object(tool.config.inputSchema!);

  const pairs = [
    { baseCode: 'USDT', quoteCode: 'USD' },
    { baseCode: 'USD', quoteCode: 'USDT', effectiveDate: '2026-10-01' },
  ];

  it('accepts pairs with an optional effective date and rejects a pair without a quote', () => {
    expect(schema.safeParse({ pairs }).success).toBe(true);
    expect(schema.safeParse({ pairs: [{ baseCode: 'USDT' }] }).success).toBe(false);
    expect(schema.safeParse({ pairs: [] }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('hands the pairs to removeUserExchangeRates, which enforces the opposite pair, and returns its result', async () => {
    const removed = { remeasure: { updated: 1, failed: 0 } };
    ratesService.removeUserExchangeRates.mockResolvedValueOnce(removed as never);

    const result = await tool.handler({ pairs }, DELETE);

    expect(ratesService.removeUserExchangeRates).toHaveBeenCalledWith({ userId: 42, pairs });
    expect(parseToolResult({ result })).toEqual(removed);
  });

  it('needs finance:delete, not finance:write, and a user who can edit', async () => {
    await expect(tool.handler({ pairs }, WRITE)).rejects.toThrow(/Missing required scope: finance:delete/);
    await expect(tool.handler({ pairs }, makeExtra({ scopes: ['finance:delete'], readOnly: true }))).rejects.toThrow(
      /no longer includes editing/,
    );
    expect(ratesService.removeUserExchangeRates).not.toHaveBeenCalled();
  });

  it('is refused while the base-currency lock is set', async () => {
    lockCheck.mockResolvedValueOnce(true);

    await expect(tool.handler({ pairs }, DELETE)).rejects.toThrow(/currencies.baseCurrencyChangeInProgress/);
    expect(ratesService.removeUserExchangeRates).not.toHaveBeenCalled();
  });
});
