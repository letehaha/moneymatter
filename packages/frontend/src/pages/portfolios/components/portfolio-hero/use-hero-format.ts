import { formatSignedPercent } from '@/common/utils/percentage';
import { useFormatCurrency } from '@/composable/formatters';
import { maskAmountText } from '@/js/helpers/formatters';
import { type MaybeRefOrGetter, toValue } from 'vue';

/** Numeric value of an optional API decimal string; null when absent or not a number. */
export const toOptionalNumber = ({ value }: { value: string | null | undefined }): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const isMissing = (amount: number | null): amount is null => amount === null || !Number.isFinite(amount);

export const useHeroFormat = ({ currencyCode }: { currencyCode: MaybeRefOrGetter<string> }) => {
  const { formatAmountByCurrencyCode, getCurrencySymbol } = useFormatCurrency();

  const formatMoney = ({ amount }: { amount: number | null }) =>
    isMissing(amount) ? '—' : formatAmountByCurrencyCode({ amount, currencyCode: toValue(currencyCode) });

  const formatSignedMoney = ({ amount }: { amount: number | null }) =>
    isMissing(amount) ? '—' : maskAmountText({ text: `${amount >= 0 ? '+' : ''}${formatMoney({ amount })}` });

  const formatPercent = ({ fraction }: { fraction: number | null }) => formatSignedPercent({ fraction });

  const currencySymbol = () => getCurrencySymbol(toValue(currencyCode));

  return { formatMoney, formatSignedMoney, formatPercent, currencySymbol };
};
