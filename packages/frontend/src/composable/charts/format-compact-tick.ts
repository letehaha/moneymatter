const MAX_DECIMALS = 2;
const MAX_SUB_CENT_DECIMALS = 8;

/** Compact axis label whose decimals follow the tick step, so close ticks ($177K vs $177.5K) stay distinct. */
export const formatCompactTick = ({ value, step, symbol }: { value: number; step: number; symbol: string }) => {
  const abs = Math.abs(value);
  const [divisor, suffix] = abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  const scaledStep = step / divisor;
  const maxDecimals = step > 0 && step < 0.01 ? MAX_SUB_CENT_DECIMALS : MAX_DECIMALS;
  const decimals =
    Array.from({ length: maxDecimals + 1 }, (_, digits) => digits).find((digits) => {
      const scaled = Math.round(scaledStep * 10 ** digits * 1e6) / 1e6;
      return Number.isInteger(scaled) && (scaled !== 0 || scaledStep === 0);
    }) ?? maxDecimals;
  const sign = value < 0 ? '-' : '';
  return `${sign}${symbol}${(abs / divisor).toFixed(decimals)}${suffix}`;
};
