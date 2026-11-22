import { roundRate } from '../rate-precision';

const RATIO_DECIMALS = 6;

/** The rate of the opposite direction of a pair; `0` when `value` has no usable inverse. */
export const calculateRatio = ({ value, isCustom }: { value: number | string; isCustom: boolean }) => {
  const result = roundRate({ value: 1 / Number(value), isCustom, isoDecimals: RATIO_DECIMALS });

  return Number.isFinite(result) ? result : 0;
};
