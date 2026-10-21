const RATIO_DIGITS = 6;
// A custom currency can be worth a tiny fraction of its quote, so its inverse keeps significant
// digits rather than a fixed number of decimals.
const CUSTOM_RATIO_SIGNIFICANT_DIGITS = 12;

/** The rate of the opposite direction of a pair; `0` when `value` has no usable inverse. */
export const calculateRatio = ({ value, isCustomCurrency }: { value: number | string; isCustomCurrency: boolean }) => {
  const num = 1 / Number(value);
  const result = isCustomCurrency
    ? Number(num.toPrecision(CUSTOM_RATIO_SIGNIFICANT_DIGITS))
    : Math.round(num * 10 ** RATIO_DIGITS) / 10 ** RATIO_DIGITS;

  return Number.isFinite(result) ? result : 0;
};
