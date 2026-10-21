import { formatCompactFiat, formatCompactUIAmount, formatShortFiat, formatUIAmount } from '@/js/helpers';
import { useCurrenciesStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

const COMPACT_AMOUNT_THRESHOLD = 10_000;

/**
 * Composable for getting translated currency names
 */
export const useCurrencyName = () => {
  const { t, te } = useI18n();

  /**
   * Get the translated name of a currency by its code.
   * Falls back to the original name if no translation exists.
   *
   * @param code - Currency code (e.g., "USD", "UAH")
   * @param fallbackName - Original currency name to use if no translation exists
   * @returns Translated currency name or fallback
   */
  const getCurrencyName = ({ code, fallbackName }: { code: string; fallbackName?: string }): string => {
    const translationKey = `currencyNames.${code}`;

    // Check if translation exists
    if (te(translationKey)) {
      return t(translationKey);
    }

    // Fall back to the original name or the code itself
    return fallbackName || code;
  };

  /**
   * Format currency display string (e.g., "USD - US Dollar")
   *
   * @param code - Currency code
   * @param fallbackName - Original currency name
   * @returns Formatted string like "USD - US Dollar"
   */
  const formatCurrencyLabel = ({ code, fallbackName }: { code: string; fallbackName?: string }): string => {
    const name = getCurrencyName({ code, fallbackName });
    return `${code} - ${name}`;
  };

  return {
    getCurrencyName,
    formatCurrencyLabel,
  };
};

export const useFormatCurrency = () => {
  const { baseCurrency } = storeToRefs(useCurrenciesStore());

  const formatBaseCurrency = (amount: number, { fractionDigits }: { fractionDigits?: number } = {}) =>
    formatUIAmount(amount, {
      currency: baseCurrency.value?.currency?.code,
      fractionDigits,
    });

  const formatWholeBaseCurrency = (amount: number) => formatBaseCurrency(amount, { fractionDigits: 0 });

  const formatCompactBaseCurrency = ({ amount }: { amount: number }) =>
    formatCompactFiat({ amount, currency: baseCurrency.value?.currency?.code });

  const formatShortBaseCurrency = ({ amount }: { amount: number }) =>
    formatShortFiat({ amount, currency: baseCurrency.value?.currency?.code });

  const formatAmountByCurrencyCode = (amount: number, currencyCode: string) =>
    formatUIAmount(amount, {
      currency: currencyCode,
    });

  /**
   * Currency symbol for a code (e.g. "$", "€"). Defaults to base currency for
   * existing no-arg callers; falls back to the code itself if unresolvable.
   */
  const getCurrencySymbol = (currencyCode?: string) => {
    const code = currencyCode || baseCurrency.value?.currency?.code || 'USD';
    try {
      // Format a zero amount and extract just the symbol
      const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: code,
        currencyDisplay: 'narrowSymbol',
      }).format(0);
      // Remove the number part to get just the symbol
      return formatted.replace(/[\d.,\s]/g, '').trim();
    } catch {
      return code;
    }
  };

  const formatCompactAmount = (amount: number, currencyCode: string) =>
    formatCompactUIAmount({ amount, currency: currencyCode });

  /** Read-only stat amounts: whole units below 10k, compact (₴50.4k, ₴1.24M) from there. */
  const formatWholeOrCompactAmount = ({ amount, currencyCode }: { amount: number; currencyCode: string }) =>
    Math.abs(amount) >= COMPACT_AMOUNT_THRESHOLD
      ? formatCompactUIAmount({ amount, currency: currencyCode })
      : formatUIAmount(amount, { currency: currencyCode, fractionDigits: 0 });

  /** `formatWholeOrCompactAmount` with an explicit sign: "+₴500", "−₴1.2k", "₴0". */
  const formatSignedWholeOrCompactAmount = ({ amount, currencyCode }: { amount: number; currencyCode: string }) => {
    const formatted = formatWholeOrCompactAmount({ amount: Math.abs(amount), currencyCode });
    if (amount > 0) return `+${formatted}`;
    if (amount < 0) return `−${formatted}`;
    return formatted;
  };

  return {
    formatBaseCurrency,
    formatWholeBaseCurrency,
    formatAmountByCurrencyCode,
    formatCompactAmount,
    formatWholeOrCompactAmount,
    formatSignedWholeOrCompactAmount,
    formatCompactBaseCurrency,
    formatShortBaseCurrency,
    getCurrencySymbol,
  };
};
