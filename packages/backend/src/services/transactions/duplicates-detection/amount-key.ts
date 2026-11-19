import { Money } from '@common/types/money';

/**
 * Duplicate-key form of an amount: its absolute value rounded half-up to the account currency's
 * decimals, as a fixed-width decimal string (`1.234`, `12.35`, `1501`). Both the incoming and the
 * stored amount are keyed this way, so an incoming amount with more digits than the account stores
 * rounds the way the transaction write rounds it, and a stored one with extra digits matches too.
 */
export const duplicateAmountKey = ({
  amount,
  decimals,
}: {
  amount: Money | number | string;
  decimals: number;
}): string => Money.fromDecimal(amount).abs().round(decimals).toDecimalString(decimals);
