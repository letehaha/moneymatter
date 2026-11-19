import type { Money } from '@common/types/money';
import { roundPositiveBaseAmount } from '@services/transactions/round-positive-amount';

/**
 * A tracker or line limit is denominated in the owner's base currency. A limit that rounds to
 * nothing is refused: a zero limit has no utilisation. `null` and `undefined` pass through.
 */
export const roundTrackerLimit = async <TLimit extends Money | null | undefined>({
  ownerUserId,
  limitAmount,
}: {
  ownerUserId: number;
  limitAmount: TLimit;
}): Promise<TLimit> => {
  if (limitAmount === null || limitAmount === undefined) return limitAmount;

  return (await roundPositiveBaseAmount({
    money: limitAmount,
    userId: ownerUserId,
    errorKey: 'currencies.amountExceedsDecimals',
  })) as TLimit;
};
