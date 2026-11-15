import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';

/**
 * Rounds amounts denominated in the user's base currency (budgets, and other figures the user
 * states in it) half-up to that currency's decimals. `null` and `undefined` pass through. A user
 * without a base currency is an error, as in `getBaseCurrencyDecimals`.
 */
export const roundToBaseCurrency = async <TValue extends Money | null | undefined>({
  userId,
  values,
}: {
  userId: number;
  values: TValue[];
}): Promise<TValue[]> => {
  if (values.every((value) => value === null || value === undefined)) return values;

  const decimals = await getBaseCurrencyDecimals({ userId });

  return values.map((value) => (value === null || value === undefined ? value : (value.round(decimals) as TValue)));
};
