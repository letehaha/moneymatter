import { describe, expect, it } from 'vitest';

import { currencyMonogram } from './currency-monogram';

describe('currencyMonogram', () => {
  it.each([
    ['₿', 'BTC'],
    ['Ξ', 'ETH'],
  ])('uses the symbol %s of %s', (symbol, code) => {
    expect(currencyMonogram({ code, symbol })).toBe(symbol);
  });

  it('uses a symbol of two characters as it is', () => {
    expect(currencyMonogram({ code: 'SATS', symbol: 'st' })).toBe('st');
  });

  it('uses the code when there is no symbol', () => {
    expect(currencyMonogram({ code: 'USDT', symbol: null })).toBe('USDT');
    expect(currencyMonogram({ code: 'USDT' })).toBe('USDT');
  });

  it('uses the code when the symbol is empty or only whitespace', () => {
    expect(currencyMonogram({ code: 'USDT', symbol: '' })).toBe('USDT');
    expect(currencyMonogram({ code: 'USDT', symbol: '  ' })).toBe('USDT');
  });

  it('uses the code when the symbol is longer than two characters', () => {
    expect(currencyMonogram({ code: 'USDC', symbol: 'USDC$' })).toBe('USDC');
  });

  it('shortens a code longer than four characters to its first four', () => {
    expect(currencyMonogram({ code: 'DOGECOIN', symbol: null })).toBe('DOGE');
  });

  it('counts a symbol outside the basic plane as one character', () => {
    expect(currencyMonogram({ code: 'GEM', symbol: '💎' })).toBe('💎');
  });
});
