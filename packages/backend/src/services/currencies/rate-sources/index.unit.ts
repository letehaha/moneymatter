import { describe, expect, it } from '@jest/globals';

import {
  HTTP_URL_TEMPLATE_PLACEHOLDERS,
  fillUrlTemplate,
  httpHeadersSchema,
  httpRateSourceConfigSchema,
  isValidJsonPath,
  storedHttpRateSourceConfigSchema,
  testRateSourceBodySchema,
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

describe('isValidJsonPath', () => {
  it.each([
    'price',
    'data.price',
    'data.rates[0].price',
    'data.rates.0.price',
    '$.bitcoin.usd',
    '$[0].price',
    'a-b.c_d',
    'a[0]b',
    'a[0][1].b',
    '$a',
  ])('accepts %s', (path) => {
    expect(isValidJsonPath(path)).toBe(true);
  });

  it.each(['', '.', 'a..b', 'a[x]', 'a[]', 'a b', '$', 'a.', "a['b']", '$$', 'a[0', 'a[0]]', '[]', 'a.[0]'])(
    'rejects %j',
    (path) => {
      expect(isValidJsonPath(path)).toBe(false);
    },
  );

  it.each([
    ['64 key characters and a bad one', `${'a'.repeat(64)}!`],
    ['256 key characters and a bad one', `${'a'.repeat(255)}!`],
    ['dotted keys and a bad one', `${'ab.'.repeat(80)}!`],
    ['bracketed positions and a bad one', `${'a[0]'.repeat(60)}!`],
  ])('rejects %s in linear time', (_label, path) => {
    const started = performance.now();
    const valid = isValidJsonPath(path);
    const elapsed = performance.now() - started;

    expect(valid).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it('rejects the hostile path through the schema without stalling', () => {
    const started = performance.now();
    const parsed = httpRateSourceConfigSchema.safeParse({
      urlTemplate: 'https://x.io/{date}',
      jsonPath: `${'a'.repeat(64)}!`,
    });

    expect(parsed.success).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
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

describe('request headers of an HTTP source', () => {
  it('accepts an API key header and keeps the name as given', () => {
    expect(httpHeadersSchema.parse({ 'X-Api-Key': 'abc123', Authorization: 'Bearer abc.def' })).toEqual({
      'X-Api-Key': 'abc123',
      Authorization: 'Bearer abc.def',
    });
  });

  it('accepts the request body of an update with headers, and none', () => {
    const base = { urlTemplate: 'https://x.io/{date}', jsonPath: 'a.b' };

    expect(httpRateSourceConfigSchema.parse({ ...base, headers: { 'X-Key': 'k' } }).headers).toEqual({ 'X-Key': 'k' });
    expect(httpRateSourceConfigSchema.parse(base).headers).toBeUndefined();
    expect(httpRateSourceConfigSchema.parse({ ...base, headers: {} }).headers).toEqual({});
  });

  it.each([
    ['a name with a space', { 'X Key': 'v' }],
    ['an empty name', { '': 'v' }],
    ['a value with a line break', { 'X-Key': 'a\r\nHost: evil' }],
    ['a value with a non-ASCII character', { 'X-Key': 'ключ' }],
    ['a header the HTTP layer owns', { Host: 'internal' }],
    ['a cookie', { cookie: 'session=1' }],
    ['a content length', { 'Content-Length': '0' }],
    ['the same name in two cases', { 'X-Key': 'a', 'x-key': 'b' }],
    ['an over-long value', { 'X-Key': 'a'.repeat(2049) }],
    ['more than ten headers', Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`X-H${index}`, 'v']))],
  ])('rejects %s', (_name, headers) => {
    expect(httpHeadersSchema.safeParse(headers).success).toBe(false);
  });

  it('reads a saved config without header names as having none', () => {
    const parsed = storedHttpRateSourceConfigSchema.parse({
      urlTemplate: 'https://x.io/{date}',
      jsonPath: 'a.b',
      quoteCurrency: 'USD',
    });

    expect(parsed.headerNames).toEqual([]);
  });

  it('does not accept header values in a saved config', () => {
    const parsed = storedHttpRateSourceConfigSchema.safeParse({
      urlTemplate: 'https://x.io/{date}',
      jsonPath: 'a.b',
      quoteCurrency: 'USD',
      headers: { 'X-Key': 'k' },
    });

    expect(parsed.success).toBe(false);
  });
});

describe('testRateSourceBodySchema', () => {
  const config = { urlTemplate: 'https://x.io/{date}', jsonPath: 'a.b' };

  it('takes an HTTP config and an optional UTC day', () => {
    expect(testRateSourceBodySchema.parse({ rateSource: 'http', config, date: '2026-02-03' }).date).toBe('2026-02-03');
    expect(testRateSourceBodySchema.parse({ rateSource: 'http', config }).date).toBeUndefined();
  });

  it.each([
    { rateSource: 'peg', config },
    { rateSource: 'http', config, date: '2026-02-30' },
    { rateSource: 'http', config, date: 'today' },
    { rateSource: 'http', config, extra: true },
  ])('rejects %j', (body) => {
    expect(testRateSourceBodySchema.safeParse(body).success).toBe(false);
  });
});
