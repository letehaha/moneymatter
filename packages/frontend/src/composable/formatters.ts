import {
  formatAccountAmount,
  formatCompactFiat,
  formatCompactUIAmount,
  formatShortFiat,
  formatUIAmount,
  getCurrencyDecimals,
  isIntlCurrencyCode,
  resolveCurrencyDisplay,
} from '@/js/helpers';
import { maskAmountText } from '@/js/helpers/formatters';
import { useCurrenciesStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
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

  /** Decimals the base currency's amounts (budgets, reference values) are stored with. */
  const baseCurrencyDecimals = computed(() => getCurrencyDecimals({ code: baseCurrency.value?.currency?.code }));

  const formatBaseCurrency = (
    amount: number,
    { fractionDigits, revealed }: { fractionDigits?: number; revealed?: boolean } = {},
  ) =>
    formatUIAmount(amount, {
      currency: baseCurrency.value?.currency?.code,
      fractionDigits,
      revealed,
    });

  const formatWholeBaseCurrency = (amount: number) => formatBaseCurrency(amount, { fractionDigits: 0 });

  const formatCompactBaseCurrency = ({ amount }: { amount: number }) =>
    formatCompactFiat({ amount, currency: baseCurrency.value?.currency?.code });

  const formatShortBaseCurrency = ({ amount }: { amount: number }) =>
    formatShortFiat({ amount, currency: baseCurrency.value?.currency?.code });

  /** For amounts on an account or transaction use `formatAccountAmount`, which applies the owner's `currencyMeta`. */
  const formatAmountByCurrencyCode = ({
    amount,
    currencyCode,
    fullPrecision,
  }: {
    amount: number;
    currencyCode: string;
    fullPrecision?: boolean;
  }) => formatUIAmount(amount, { currency: currencyCode, fullPrecision });

  /**
   * Currency symbol for a code (e.g. "$", "€"). Defaults to base currency for
   * existing no-arg callers; falls back to the code itself if unresolvable.
   */
  const getCurrencySymbol = (currencyCode?: string) => {
    const code = currencyCode || baseCurrency.value?.currency?.code || 'USD';
    const display = resolveCurrencyDisplay({ code });
    if (display.isCustom || !isIntlCurrencyCode({ code })) return display.symbol || code;
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
      : formatUIAmount(amount, {
          currency: currencyCode,
          // A custom unit can be worth a lot (BTC), so whole units would round its amounts away.
          fractionDigits: resolveCurrencyDisplay({ code: currencyCode }).isCustom ? undefined : 0,
        });

  /** Full amount with cents below 100k, compact (₴385k, ₴1.24M) from there. */
  const formatCompactLargeBaseCurrency = ({ amount }: { amount: number }) =>
    formatCompactUIAmount({ amount, currency: baseCurrency.value?.currency?.code, from: 100_000 });

  /** `formatWholeOrCompactAmount` with an explicit sign: "+₴500", "−₴1.2k", "₴0". */
  const formatSignedWholeOrCompactAmount = ({ amount, currencyCode }: { amount: number; currencyCode: string }) => {
    const formatted = formatWholeOrCompactAmount({ amount: Math.abs(amount), currencyCode });
    if (amount > 0) return maskAmountText({ text: `+${formatted}` });
    if (amount < 0) return maskAmountText({ text: `−${formatted}` });
    return formatted;
  };

  return {
    baseCurrencyDecimals,
    formatBaseCurrency,
    formatWholeBaseCurrency,
    formatAmountByCurrencyCode,
    formatAccountAmount,
    formatCompactAmount,
    formatWholeOrCompactAmount,
    formatCompactLargeBaseCurrency,
    formatSignedWholeOrCompactAmount,
    formatCompactBaseCurrency,
    formatShortBaseCurrency,
    getCurrencySymbol,
  };
};
