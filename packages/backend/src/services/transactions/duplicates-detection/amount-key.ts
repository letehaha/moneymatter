import { Money } from '@common/types/money';

/**
 * Duplicate-key form of an amount: its absolute value rounded half-up to the account currency's
 * decimals, as a fixed-width decimal string (`1.234`, `12.35`, `1501`). An incoming amount can carry
 * more digits than the account stores, so it is rounded the way the transaction write rounds it
 * before it is compared with a stored amount; the stored side passes through unchanged.
 */
export const duplicateAmountKey = ({
  amount,
  decimals,
}: {
  amount: Money | number | string;
  decimals: number;
}): string => Money.fromDecimal(amount).abs().round(decimals).toDecimalString(decimals);
