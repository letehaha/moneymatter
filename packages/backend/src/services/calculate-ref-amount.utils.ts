import { Money } from '@common/types/money';

// Converted amounts are stored with 2 decimals until every write path rounds per currency.
const CONVERTED_AMOUNT_DECIMALS = 2;

export const calculateRefAmountFromParams = ({
  amount,
  rate,
  useFloorAbs = true,
}: {
  amount: Money;
  rate: number;
  // Investments keep the full decimal precision of the product instead of rounding it.
  useFloorAbs?: boolean;
}): Money => {
  if (!useFloorAbs) {
    // Investments are stored as DECIMAL columns - preserve full precision via Money arithmetic.
    return amount.multiply(rate);
  }

  // Banker's rounding (round half to even) per IEEE 754 and IFRS/GAAP standards. It minimizes
  // cumulative rounding bias in bidirectional currency conversions (e.g., USD → EUR → USD) and is
  // symmetric around zero, so the sign needs no special handling.
  return amount.round(CONVERTED_AMOUNT_DECIMALS).multiply(rate).roundHalfEven(CONVERTED_AMOUNT_DECIMALS);
};
