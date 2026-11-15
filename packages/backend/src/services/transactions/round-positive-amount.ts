import { roundToCurrency } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/**
 * Rounds an entered amount that must stay positive half-up to the currency's decimals. One that
 * rounds to nothing (0.4 JPY, 0.004 USD) is rejected rather than stored as zero.
 */
export const roundPositiveAmount = async ({
  money,
  userId,
  currencyCode,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
}): Promise<Money> => {
  const rounded = await roundToCurrency({ money, userId, currencyCode, mode: 'half-up' });

  if (!rounded.isPositive()) {
    throw new ValidationError({
      message: t({ key: 'transactions.amountBelowSmallestUnit', variables: { code: currencyCode } }),
    });
  }

  return rounded;
};
