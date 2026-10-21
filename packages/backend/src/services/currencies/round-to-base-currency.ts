import { getCurrencyDecimals } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { getBaseCurrency } from '@models/users-currencies.model';

/**
 * Rounds amounts denominated in the user's base currency (budgets, and other figures the user
 * states in it) half-up to that currency's decimals. `null` and `undefined` pass through, and a
 * user without a base currency keeps the values as they are.
 */
export const roundToBaseCurrency = async <TValue extends Money | null | undefined>({
  userId,
  values,
}: {
  userId: number;
  values: TValue[];
}): Promise<TValue[]> => {
  if (values.every((value) => value === null || value === undefined)) return values;

  const base = await getBaseCurrency({ userId });
  if (!base) return values;

  const decimals = await getCurrencyDecimals({ userId, code: base.currencyCode });

  return values.map((value) => (value === null || value === undefined ? value : (value.round(decimals) as TValue)));
};
