import { describe, expect, it } from '@jest/globals';

import { httpHistoryFingerprint } from './http-history-fingerprint';

const config = {
  urlTemplate: 'https://rates.io/price/{code}?quote={quote}',
  jsonPath: 'data.price',
  quoteCurrency: 'USD',
};

describe('httpHistoryFingerprint', () => {
  it('is the same for the same config and holds no readable part of the URL', () => {
    const fingerprint = httpHistoryFingerprint(config);

    expect(httpHistoryFingerprint({ ...config })).toBe(fingerprint);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['URL path', { urlTemplate: 'https://rates.io/other/{code}?quote={quote}' }],
    ['host', { urlTemplate: 'https://rates.example/price/{code}?quote={quote}' }],
    ['non-credential query value', { urlTemplate: 'https://rates.io/price/{code}?quote=EUR' }],
    ['query parameter name', { urlTemplate: 'https://rates.io/price/{code}?currency={quote}' }],
    ['json path', { jsonPath: 'data.last' }],
    ['quote currency', { quoteCurrency: 'EUR' }],
  ])('differs when the %s changes', (_label, change) => {
    expect(httpHistoryFingerprint({ ...config, ...change })).not.toBe(httpHistoryFingerprint(config));
  });

  it.each(['apikey', 'api_key', 'apiKey', 'access_token', 'token', 'key', 'appid', 'client_secret', 'sig'])(
    'ignores the value of the credential parameter %s',
    (name) => {
      const withKey = (value: string) => ({
        ...config,
        urlTemplate: `https://rates.io/price/{code}?${name}=${value}&quote={quote}`,
      });

      expect(httpHistoryFingerprint(withKey('old-secret'))).toBe(httpHistoryFingerprint(withKey('new-secret')));
      expect(httpHistoryFingerprint(withKey('old-secret'))).not.toBe(httpHistoryFingerprint(config));
    },
  );

  it('does not depend on the order of the query parameters or on a fragment', () => {
    const a = { ...config, urlTemplate: 'https://rates.io/p?a=1&b=2' };
    const b = { ...config, urlTemplate: 'https://rates.io/p?b=2&a=1#section' };

    expect(httpHistoryFingerprint(a)).toBe(httpHistoryFingerprint(b));
  });
});
