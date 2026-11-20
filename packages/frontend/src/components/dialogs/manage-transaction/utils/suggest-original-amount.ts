import { roundToDecimals } from '@/js/helpers/currency-decimals';

const isFilled = (value: number | string | null | undefined): boolean =>
  value !== null && value !== undefined && value !== '';

/** A suggestion is offered only while the original amount is still empty. */
export const canSuggestOriginalAmount = ({
  amount,
  accountCurrencyCode,
  originalCurrencyCode,
  originalAmount,
}: {
  /** Main form amount, expressed in the account's currency. */
  amount: number | string | null | undefined;
  accountCurrencyCode: string | null | undefined;
  originalCurrencyCode: string | null | undefined;
  originalAmount: number | string | null | undefined;
}): boolean => {
  if (!accountCurrencyCode || !originalCurrencyCode) return false;
  if (isFilled(originalAmount)) return false;
  return isFilled(amount) && Number.isFinite(Number(amount));
};

/**
 * Converted amount rounded to the original currency's own fraction digits, or `null` when
 * the rate is unusable. Writing a NaN instead would read as a filled field and serialize
 * to `null` next to a currency code, which the API rejects as a half pair.
 */
export const resolveSuggestedOriginalAmount = ({
  amount,
  rate,
  decimals,
}: {
  amount: number;
  rate: number | null | undefined;
  /** Decimals of the original currency. */
  decimals: number;
}): number | null => {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
  if (!Number.isFinite(amount)) return null;

  return roundToDecimals({ value: amount * rate, decimals });
};
