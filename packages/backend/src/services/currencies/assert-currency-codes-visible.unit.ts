import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@i18n/index', () => ({
  t: ({ key, variables }: { key: string; variables?: Record<string, unknown> }) =>
    `${key} ${JSON.stringify(variables ?? {})}`,
}));

/* eslint-disable import/first */
import { buildInvalidCurrencyMessage } from './assert-currency-codes-visible';

describe('buildInvalidCurrencyMessage', () => {
  it('names the ISO choice alone for a user without custom currencies', () => {
    expect(buildInvalidCurrencyMessage({ code: 'ZZZ', ownCustomCodes: [] })).toBe(
      'currencies.invalidCodeIso {"code":"ZZZ"}',
    );
  });

  it('lists the custom currencies the user holds', () => {
    expect(buildInvalidCurrencyMessage({ code: 'ZZZ', ownCustomCodes: ['BTC', 'USDT'] })).toBe(
      'currencies.invalidCodeWithCustom {"code":"ZZZ","customCodes":"BTC, USDT"}',
    );
  });

  it('describes a malformed code by its shape', () => {
    expect(buildInvalidCurrencyMessage({ code: 'A-B', ownCustomCodes: ['BTC'] })).toBe(
      'currencies.invalidCode {"code":"A-B"}',
    );
  });
});
