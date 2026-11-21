const CUSTOM_RATE_SIGNIFICANT_DIGITS = 12;

/** A custom currency can be worth a tiny fraction of its quote, so its rate keeps significant digits, not decimals. */
export const roundRate = ({
  value,
  isCustom,
  isoDecimals,
}: {
  value: number;
  isCustom: boolean;
  isoDecimals: number;
}): number =>
  isCustom ? Number(value.toPrecision(CUSTOM_RATE_SIGNIFICANT_DIGITS)) : Number(value.toFixed(isoDecimals));

export const rateDisplayOptions = ({
  isCustom,
  isoDecimals,
}: {
  isCustom: boolean;
  isoDecimals: number;
}): Intl.NumberFormatOptions =>
  isCustom
    ? { minimumFractionDigits: 0, maximumSignificantDigits: CUSTOM_RATE_SIGNIFICANT_DIGITS }
    : { minimumFractionDigits: 0, maximumFractionDigits: isoDecimals };
