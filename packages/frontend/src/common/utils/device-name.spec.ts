import { describe, expect, it } from 'vitest';

import { getDeviceName } from './device-name';

describe('getDeviceName', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Chrome on Mac',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      'Edge on Windows',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0', 'Firefox on Linux'],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    ['curl/8.0', 'Passkey'],
  ])('%s -> %s', (userAgent, expected) => {
    expect(getDeviceName({ userAgent })).toBe(expected);
  });

  it('uses the given fallback for an unknown agent', () => {
    expect(getDeviceName({ userAgent: 'curl/8.0', fallback: 'Browser' })).toBe('Browser');
  });

  it('keeps a recognised agent when a fallback is given', () => {
    expect(
      getDeviceName({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0',
        fallback: 'Browser',
      }),
    ).toBe('Firefox on Linux');
  });
});
