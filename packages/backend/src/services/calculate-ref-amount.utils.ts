import { Money } from '@common/types/money';

/** Decimals of a currency pair that no `getCurrencyDecimals` lookup refined: the ISO 4217 majority. */
const DEFAULT_CONVERSION_DECIMALS = 2;

export interface ConversionDecimals {
  /** Decimals of the amount's own currency; the amount is rounded to them before it is converted. */
  baseDecimals?: number;
  /** Decimals of the currency the amount converts into; the product is rounded to them. */
  quoteDecimals?: number;
}

export const calculateRefAmountFromParams = ({
  amount,
  rate,
  useFloorAbs = true,
  baseDecimals = DEFAULT_CONVERSION_DECIMALS,
  quoteDecimals = DEFAULT_CONVERSION_DECIMALS,
}: {
  amount: Money;
  rate: number;
  // Investments keep the full decimal precision of the product instead of rounding it.
  useFloorAbs?: boolean;
} & ConversionDecimals): Money => {
  if (!useFloorAbs) {
    // Investments are stored as DECIMAL columns - preserve full precision via Money arithmetic.
    return amount.multiply(rate);
  }

  // Banker's rounding (round half to even) per IEEE 754 and IFRS/GAAP standards. It minimizes
  // cumulative rounding bias in bidirectional currency conversions (e.g., USD → EUR → USD) and is
  // symmetric around zero, so the sign needs no special handling.
  return amount.round(baseDecimals).multiply(rate).roundHalfEven(quoteDecimals);
};
