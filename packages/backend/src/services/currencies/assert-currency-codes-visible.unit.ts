import { describe, expect, it } from '@jest/globals';

import { buildInvalidCurrencyMessage } from './assert-currency-codes-visible';

describe('buildInvalidCurrencyMessage', () => {
  it('names the ISO choice alone for a user without custom currencies', () => {
    expect(buildInvalidCurrencyMessage({ code: 'ZZZ', ownCustomCodes: [] })).toBe(
      'Invalid currency code "ZZZ". Use an ISO 4217 code, e.g. "USD".',
    );
  });

  it('lists the custom currencies the user holds', () => {
    expect(buildInvalidCurrencyMessage({ code: 'ZZZ', ownCustomCodes: ['BTC', 'USDT'] })).toBe(
      'Invalid currency code "ZZZ". Use an ISO 4217 code, e.g. "USD", or one of your custom currencies: BTC, USDT.',
    );
  });

  it('describes a malformed code by its shape', () => {
    expect(buildInvalidCurrencyMessage({ code: 'A-B', ownCustomCodes: ['BTC'] })).toBe(
      'Invalid currency code "A-B". Use 2 to 16 letters or digits, e.g. "USD".',
    );
  });
});
