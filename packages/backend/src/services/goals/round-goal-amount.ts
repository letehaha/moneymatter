import { getCurrencyDecimals } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/**
 * Rounds an amount a person entered for a goal half-up to its currency's decimals. One that rounds
 * to nothing is refused: every goal amount is stored under a `> 0` check.
 */
export const roundGoalAmount = async ({
  money,
  userId,
  currencyCode,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
}): Promise<Money> => {
  const decimals = await getCurrencyDecimals({ userId, code: currencyCode });
  const rounded = money.round(decimals);

  if (!rounded.isPositive()) {
    throw new ValidationError({
      message: t({ key: 'currencies.amountExceedsDecimals', variables: { code: currencyCode, decimals } }),
    });
  }
  return rounded;
};
