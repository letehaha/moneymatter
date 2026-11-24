import { maskAmountText } from '@/js/helpers/formatters';

/**
 * Compact currency formatter for chart axes: abbreviates thousands as `K`
 * and millions as `M` with one decimal. Below 1000 the value is rendered
 * as-is so axis ticks like `$0`, `$250`, `$1k`, `$1.5M` all share one style.
 */
export const formatAxisCurrency = ({ value, symbol }: { value: number; symbol: string }): string => {
  const absValue = Math.abs(value);
  let text = `${symbol}${value}`;
  if (absValue >= 1_000_000) {
    text = `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  } else if (absValue >= 1_000) {
    text = `${symbol}${(value / 1_000).toFixed(0)}K`;
  }
  return maskAmountText({ text });
};
