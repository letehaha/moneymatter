import type { Money } from '@common/types/money';
import { roundPositiveAmount } from '@services/transactions/round-positive-amount';

/** Every goal amount is stored under a `> 0` check, so one that rounds to nothing is refused. */
export const roundGoalAmount = ({
  money,
  userId,
  currencyCode,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
}): Promise<Money> =>
  roundPositiveAmount({ money, userId, currencyCode, errorKey: 'currencies.amountExceedsDecimals' });
