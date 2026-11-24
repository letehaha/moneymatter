import { registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { areAmountsHidden } from '@/js/helpers/formatters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFormatCurrency } from './formatters';

vi.mock('pinia', async (importOriginal) => {
  const original = await importOriginal<typeof import('pinia')>();
  return { ...original, storeToRefs: (store: Record<string, unknown>) => store };
});

vi.mock('@/stores', async () => {
  const { ref } = await import('vue');
  return { useCurrenciesStore: () => ({ baseCurrency: ref({ currency: { code: 'USD' } }) }) };
});

describe('useFormatCurrency', () => {
  beforeEach(() => {
    registerCurrencyDecimals({
      entries: [
        { code: 'BTC', decimals: 8, isCustom: true, symbol: '₿' },
        { code: 'USDT', decimals: 6, isCustom: true, symbol: null },
      ],
    });
  });

  afterEach(() => {
    resetCurrencyDecimals();
  });

  describe('formatWholeOrCompactAmount', () => {
    it('drops the cents of an ISO amount', () => {
      const { formatWholeOrCompactAmount } = useFormatCurrency();

      expect(formatWholeOrCompactAmount({ amount: 1234.56, currencyCode: 'USD' })).toBe('$1,235');
    });

    it("keeps a custom currency's decimals, so a small amount is not rounded away", () => {
      const { formatWholeOrCompactAmount } = useFormatCurrency();

      expect(formatWholeOrCompactAmount({ amount: 0.00012345, currencyCode: 'BTC' })).toBe('0.0001235 ₿');
    });
  });

  describe('getCurrencySymbol', () => {
    it("uses a custom currency's symbol, or its code without one", () => {
      const { getCurrencySymbol } = useFormatCurrency();

      expect(getCurrencySymbol('BTC')).toBe('₿');
      expect(getCurrencySymbol('USDT')).toBe('USDT');
    });

    it('uses the Intl symbol of an ISO code', () => {
      const { getCurrencySymbol } = useFormatCurrency();

      expect(getCurrencySymbol('EUR')).toBe('€');
    });
  });

  describe('hidden amounts', () => {
    beforeEach(() => {
      areAmountsHidden.value = true;
    });
    afterEach(() => {
      areAmountsHidden.value = false;
    });

    it('masks a signed amount without its sign', () => {
      const { formatSignedWholeOrCompactAmount } = useFormatCurrency();

      expect(formatSignedWholeOrCompactAmount({ amount: -500, currencyCode: 'USD' })).toBe('••••');
    });

    it('shows a revealed base-currency amount', () => {
      const { formatBaseCurrency } = useFormatCurrency();

      expect(formatBaseCurrency(1234.5, { revealed: true })).toBe('$1,234.50');
    });
  });
});
