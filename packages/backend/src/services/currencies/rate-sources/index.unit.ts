import { describe, expect, it } from '@jest/globals';

import {
  HTTP_URL_TEMPLATE_PLACEHOLDERS,
  JSON_PATH_PATTERN,
  fillUrlTemplate,
  httpRateSourceConfigSchema,
  updateRateSourceBodySchema,
} from './index';

describe('fillUrlTemplate', () => {
  const values = HTTP_URL_TEMPLATE_PLACEHOLDERS;

  it('fills every placeholder, each as many times as it appears', () => {
    expect(fillUrlTemplate({ template: 'https://x.io/{code}/{quote}/{date}?d={date}', values })).toBe(
      'https://x.io/BTC/USD/2026-01-01?d=2026-01-01',
    );
  });

  it('returns the template as it is when it holds no placeholder', () => {
    expect(fillUrlTemplate({ template: 'https://x.io/price', values })).toBe('https://x.io/price');
  });

  it.each(['https://x.io/{day}', 'https://x.io/{date', 'https://x.io/date}', 'https://x.io/{}'])(
    'returns null for %s',
    (template) => {
      expect(fillUrlTemplate({ template, values })).toBeNull();
    },
  );

  it('does not treat an inherited property name as a placeholder', () => {
    expect(fillUrlTemplate({ template: 'https://x.io/{constructor}', values })).toBeNull();
  });
});

describe('JSON_PATH_PATTERN', () => {
  it.each([
    'price',
    'data.price',
    'data.rates[0].price',
    'data.rates.0.price',
    '$.bitcoin.usd',
    '$[0].price',
    'a-b.c_d',
  ])('accepts %s', (path) => {
    expect(JSON_PATH_PATTERN.test(path)).toBe(true);
  });

  it.each(['', '.', 'a..b', 'a[x]', 'a[]', 'a b', '$', 'a.', "a['b']"])('rejects %j', (path) => {
    expect(JSON_PATH_PATTERN.test(path)).toBe(false);
  });
});

describe('updateRateSourceBodySchema', () => {
  it('fills the default quote currency of a synced source and uppercases codes', () => {
    const parsed = updateRateSourceBodySchema.parse({ rateSource: 'coingecko', config: { coinId: 'tether' } });
    expect(parsed).toEqual({ rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: 'USD' } });

    expect(updateRateSourceBodySchema.parse({ rateSource: 'peg', config: { pegCurrency: 'usd', factor: 1 } })).toEqual({
      rateSource: 'peg',
      config: { pegCurrency: 'USD', factor: 1 },
    });
  });

  it('trims the URL template and the JSON path', () => {
    const parsed = httpRateSourceConfigSchema.parse({ urlTemplate: ' https://x.io/{date} ', jsonPath: ' a.b ' });
    expect(parsed).toMatchObject({ urlTemplate: 'https://x.io/{date}', jsonPath: 'a.b' });
  });

  it.each([
    { rateSource: 'manual', config: null },
    { rateSource: 'peg', config: { pegCurrency: 'USD', factor: Infinity } },
    { rateSource: 'peg', config: { pegCurrency: 'USD', factor: Number.NaN } },
  ])('rejects %j', (body) => {
    expect(updateRateSourceBodySchema.safeParse(body).success).toBe(false);
  });
});
