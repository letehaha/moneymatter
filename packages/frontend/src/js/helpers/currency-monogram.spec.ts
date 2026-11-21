import { describe, expect, it } from 'vitest';

import { currencyMonogram } from './currency-monogram';

describe('currencyMonogram', () => {
  it.each([
    ['₿', 'BTC'],
    ['Ξ', 'ETH'],
  ])('uses the symbol %s of %s', (symbol, code) => {
    expect(currencyMonogram({ code, symbol, maxLength: 4 })).toBe(symbol);
  });

  it('uses a symbol of two characters as it is', () => {
    expect(currencyMonogram({ code: 'SATS', symbol: 'st', maxLength: 4 })).toBe('st');
  });

  it('uses the code when there is no symbol', () => {
    expect(currencyMonogram({ code: 'USDT', symbol: null, maxLength: 4 })).toBe('USDT');
    expect(currencyMonogram({ code: 'USDT', maxLength: 4 })).toBe('USDT');
  });

  it('uses the code when the symbol is empty or only whitespace', () => {
    expect(currencyMonogram({ code: 'USDT', symbol: '', maxLength: 4 })).toBe('USDT');
    expect(currencyMonogram({ code: 'USDT', symbol: '  ', maxLength: 4 })).toBe('USDT');
  });

  it('uses the code when the symbol is longer than two characters', () => {
    expect(currencyMonogram({ code: 'USDC', symbol: 'USDC$', maxLength: 4 })).toBe('USDC');
  });

  it('cuts the code or the symbol to maxLength characters', () => {
    expect(currencyMonogram({ code: 'DOGECOIN', symbol: null, maxLength: 4 })).toBe('DOGE');
    expect(currencyMonogram({ code: 'SATS', symbol: 'st', maxLength: 1 })).toBe('s');
  });

  it('counts a symbol outside the basic plane as one character', () => {
    expect(currencyMonogram({ code: 'GEM', symbol: '💎', maxLength: 4 })).toBe('💎');
  });
});
