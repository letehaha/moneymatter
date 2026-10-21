import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ValidationError } from '@js/errors';

import {
  buildHttpRateUrl,
  extractRate,
  fetchHttpRate,
  fetchJson,
  HttpRateSourceError,
  readJsonPath,
  toRate,
} from './http';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const failureOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpRateSourceError) return error.reason;
    throw error;
  }

  throw new Error('Expected the call to fail');
};

describe('buildHttpRateUrl', () => {
  it('fills the day, the code and the quote', () => {
    expect(
      buildHttpRateUrl({
        urlTemplate: 'https://api.example.test/{code}/{quote}?on={date}',
        code: 'SAT',
        quoteCurrency: 'EUR',
        day: '2026-03-04',
      }),
    ).toBe('https://api.example.test/SAT/EUR?on=2026-03-04');
  });

  it('leaves a template without placeholders as it is', () => {
    expect(
      buildHttpRateUrl({
        urlTemplate: 'https://api.example.test/price',
        code: 'SAT',
        quoteCurrency: 'EUR',
        day: '2026-03-04',
      }),
    ).toBe('https://api.example.test/price');
  });
});

describe('readJsonPath', () => {
  const json = { data: { rates: [{ price: '42.5' }, { price: 7 }], 'usd-coin': { usd: 1.0001 } }, 0: 'zero' };

  it.each([
    ['data.rates[0].price', '42.5'],
    ['data.rates.1.price', 7],
    ['$.data.rates[1].price', 7],
    ['$data.rates[1].price', 7],
    ['data.usd-coin.usd', 1.0001],
    ['0', 'zero'],
  ])('reads %s', (path, expected) => {
    expect(readJsonPath({ json, path })).toEqual(expected);
  });

  it.each([
    'data.missing',
    'data.rates[5].price',
    'data.rates[0].price.deeper',
    'constructor',
    'data.__proto__',
    'data.rates.length',
  ])('finds nothing at %s', (path) => {
    expect(readJsonPath({ json, path })).toBeUndefined();
  });

  it('finds nothing in a response that is not an object', () => {
    expect(readJsonPath({ json: 5, path: 'a' })).toBeUndefined();
    expect(readJsonPath({ json: null, path: 'a' })).toBeUndefined();
  });
});

describe('toRate', () => {
  it.each([
    [0.000001, 0.000001],
    ['42000.5', 42000.5],
    [' 3 ', 3],
    ['1e-8', 1e-8],
  ])('reads %p', (value, expected) => {
    expect(toRate({ value })).toBe(expected);
  });

  it.each([0, -1, Number.NaN, Infinity, '', 'abc', '-3', '1,5', '0x10', null, undefined, {}, [], true])(
    'refuses %p',
    (value) => {
      expect(toRate({ value })).toBeNull();
    },
  );
});

describe('extractRate', () => {
  it('names the failure when the path leads nowhere or to something that is not a price', async () => {
    expect(() => extractRate({ json: { a: 1 }, path: 'b' })).toThrow(HttpRateSourceError);
    expect(await failureOf(Promise.resolve().then(() => extractRate({ json: { a: 1 }, path: 'b' })))).toBe(
      'path_not_found',
    );
    expect(await failureOf(Promise.resolve().then(() => extractRate({ json: { a: 'cheap' }, path: 'a' })))).toBe(
      'not_a_number',
    );
    expect(await failureOf(Promise.resolve().then(() => extractRate({ json: { a: 0 }, path: 'a' })))).toBe(
      'not_a_number',
    );
  });
});

describe('fetchJson', () => {
  const url = 'https://rates.example.test/price';
  let selfHostBefore: string | undefined;

  beforeEach(() => {
    selfHostBefore = process.env.IS_SELF_HOST;
    delete process.env.IS_SELF_HOST;
  });

  afterEach(() => {
    if (selfHostBefore === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = selfHostBefore;
  });

  it('sends the headers and returns the parsed body', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ price: 1 }));

    const result = await fetchJson({ url, headers: { 'X-Api-Key': 'k' }, fetchImpl });

    expect(result).toEqual({ price: 1 });
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(url);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json', 'X-Api-Key': 'k' },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses http while the outbound guard is on, without making a request', async () => {
    const fetchImpl = jest.fn<typeof fetch>();

    expect(await failureOf(fetchJson({ url: 'http://rates.example.test/price', fetchImpl }))).toBe('https_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows http and LAN addresses on a self-hosted instance', async () => {
    process.env.IS_SELF_HOST = 'true';
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ price: 2 }));

    expect(await fetchJson({ url: 'http://192.168.1.10:8080/price', fetchImpl })).toEqual({ price: 2 });
  });

  it('reports a request the guard blocked', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new ValidationError({ message: 'private address' }));

    const error = await fetchJson({ url, fetchImpl }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: 'blocked', message: 'private address' });
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );

    expect(await failureOf(fetchJson({ url, fetchImpl, timeoutMs: 20 }))).toBe('timeout');
  });

  it('gives up on a body that stalls after the headers', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
        },
      });

      return new Response(stream, { status: 200 });
    });

    expect(await failureOf(fetchJson({ url, fetchImpl, timeoutMs: 20 }))).toBe('timeout');
  });

  it('reports a network failure without the address', async () => {
    const cause = Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    const fetchImpl = jest.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed', { cause }));

    const error = await fetchJson({ url, fetchImpl }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: 'network', message: 'The request failed (ECONNREFUSED)' });
    expect((error as Error).message).not.toContain('rates.example.test');
  });

  it('reports a status that is not 2xx', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 401 }));

    const error = await fetchJson({ url, fetchImpl }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: 'http_status', message: 'The server answered 401' });
  });

  it('reports a body that is not JSON', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response('<html></html>', { status: 200 }));

    expect(await failureOf(fetchJson({ url, fetchImpl }))).toBe('not_json');
  });

  it('refuses a response that declares more than the limit', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-length': '300000' } }));

    expect(await failureOf(fetchJson({ url, fetchImpl }))).toBe('too_large');
  });

  it('stops reading a body that passes the limit without declaring its size', async () => {
    const chunk = new TextEncoder().encode(`"${'a'.repeat(1024)}"`);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(stream, { status: 200 }));

    expect(await failureOf(fetchJson({ url, fetchImpl, maxBytes: 4096 }))).toBe('too_large');
    // The reader stopped soon after the limit instead of draining an endless stream.
    expect(pulled).toBeLessThan(20);
  });

  it('accepts a body exactly at the limit', async () => {
    const body = JSON.stringify({ price: 1 });
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }));

    expect(await fetchJson({ url, fetchImpl, maxBytes: body.length })).toEqual({ price: 1 });
  });
});

describe('fetchHttpRate', () => {
  it('builds the URL for the day and reads the price at the path', async () => {
    process.env.IS_SELF_HOST = 'true';
    try {
      const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { SAT: { EUR: '0.0004' } } }));

      const rate = await fetchHttpRate({
        urlTemplate: 'https://rates.example.test/{date}?c={code}',
        jsonPath: 'data.SAT.EUR',
        quoteCurrency: 'EUR',
        code: 'SAT',
        day: '2026-03-04',
        fetchImpl,
      });

      expect(rate).toBe(0.0004);
      expect(fetchImpl.mock.calls[0]![0]).toBe('https://rates.example.test/2026-03-04?c=SAT');
    } finally {
      delete process.env.IS_SELF_HOST;
    }
  });
});
