import type { ConversionDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';

/**
 * Investment figures reach the API as two-decimal display strings whatever the currency, so their
 * conversions round to 2 on purpose instead of looking the decimals up.
 */
export const INVESTMENT_CONVERSION_DECIMALS: ConversionDecimals = { baseDecimals: 2, quoteDecimals: 2 };

export const calculateRefAmountFromParams = ({
  amount,
  rate,
  useFloorAbs = true,
  baseDecimals,
  quoteDecimals,
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
