import { describe, expect, it } from 'vitest';

import { isHttpUrl, isHttpsUrl } from './external-url';

describe('external-url', () => {
  it.each([
    ['https://example.com', true, true],
    ['HTTPS://example.com', true, true],
    ['http://example.com', true, false],
    ['javascript:alert(1)', false, false],
    ['not a url', false, false],
    ['', false, false],
  ])('%s → http %s, https %s', (value, http, https) => {
    expect(isHttpUrl(value)).toBe(http);
    expect(isHttpsUrl(value)).toBe(https);
  });
});
