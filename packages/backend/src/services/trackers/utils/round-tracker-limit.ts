import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { getBaseCurrency } from '@models/users-currencies.model';
import { roundToBaseCurrency } from '@services/currencies/round-to-base-currency';

/**
 * A tracker or line limit is denominated in the owner's base currency and rounds half-up to its
 * decimals. A limit that rounds to nothing is refused: limits are positive, and a zero limit has no
 * utilisation. `null` and `undefined` pass through.
 */
export const roundTrackerLimit = async <TLimit extends Money | null | undefined>({
  ownerUserId,
  limitAmount,
}: {
  ownerUserId: number;
  limitAmount: TLimit;
}): Promise<TLimit> => {
  const [rounded] = await roundToBaseCurrency({ userId: ownerUserId, values: [limitAmount] });
  if (rounded === null || rounded === undefined || rounded.isPositive()) return rounded as TLimit;

  const [{ currencyCode }, decimals] = await Promise.all([
    getBaseCurrency({ userId: ownerUserId }),
    getBaseCurrencyDecimals({ userId: ownerUserId }),
  ]);
  throw new ValidationError({
    message: t({ key: 'currencies.amountExceedsDecimals', variables: { code: currencyCode, decimals } }),
  });
};
