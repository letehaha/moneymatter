import { maskAmountText } from '@/js/helpers/formatters';

/**
 * Compact currency formatter for chart axes: abbreviates thousands as `K` and millions as `M`
 * with up to two decimals, trailing zeros trimmed, so close ticks ($1.5K vs $2K) stay distinct.
 */
export const formatAxisCurrency = ({ value, symbol }: { value: number; symbol: string }): string => {
  const absValue = Math.abs(value);
  let text = `${symbol}${value}`;
  if (absValue >= 1_000_000) {
    text = `${symbol}${Number((value / 1_000_000).toFixed(2))}M`;
  } else if (absValue >= 1_000) {
    text = `${symbol}${Number((value / 1_000).toFixed(2))}K`;
  }
  return maskAmountText({ text });
};
