import type { Money } from '@common/types/money';

export type CurrencyRoundingMode = 'half-up' | 'half-even';

const PLACEHOLDER_DECIMALS = 2;

/**
 * Number of decimal places the currency carries for the user.
 *
 * Placeholder: always 2 until the `Currencies.digits` lookup lands.
 */
export const getCurrencyDecimals = async (_params: { userId: number; code: string }): Promise<number> =>
  PLACEHOLDER_DECIMALS;

/**
 * Rounds `money` to the currency's decimals.
 *
 * Placeholder: always rounds half-up to 2 decimals, whatever the currency and mode.
 */
export const roundToCurrency = async ({
  money,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
  mode: CurrencyRoundingMode;
}): Promise<Money> => money.round(PLACEHOLDER_DECIMALS);
