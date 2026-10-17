// Decimals assumed when the original currency's own are unknown.
const FALLBACK_SUGGESTION_DIGITS = 2;

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

const resolveSuggestionDigits = ({ currencyDigits }: { currencyDigits: number | null | undefined }): number => {
  if (typeof currencyDigits !== 'number' || !Number.isFinite(currencyDigits)) return FALLBACK_SUGGESTION_DIGITS;
  return Math.max(Math.trunc(currencyDigits), 0);
};

/**
 * Converted amount rounded to the original currency's own fraction digits, or `null` when
 * the rate is unusable. Writing a NaN instead would read as a filled field and serialize
 * to `null` next to a currency code, which the API rejects as a half pair.
 */
export const resolveSuggestedOriginalAmount = ({
  amount,
  rate,
  currencyDigits,
}: {
  amount: number;
  rate: number | null | undefined;
  currencyDigits: number | null | undefined;
}): number | null => {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
  if (!Number.isFinite(amount)) return null;

  const factor = 10 ** resolveSuggestionDigits({ currencyDigits });
  return Math.round(amount * rate * factor) / factor;
};
