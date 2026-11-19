import {
  assertMoneyWithinMinorUnitRange,
  getBaseCurrencyPrecision,
  getCurrencyDecimals,
} from '@common/lib/currency-precision';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

const roundPositive = ({
  money,
  code,
  decimals,
  errorKey,
}: {
  money: Money;
  code: string;
  decimals: number;
  errorKey: string;
}): Money => {
  const rounded = money.round(decimals);

  if (!rounded.isPositive()) {
    throw new ValidationError({ message: t({ key: errorKey, variables: { code, decimals } }) });
  }
  assertMoneyWithinMinorUnitRange({ money: rounded, decimals, code });

  return rounded;
};

/**
 * Rounds an entered amount that must stay positive half-up to the currency's decimals. One that
 * rounds to nothing (0.4 JPY, 0.004 USD) is rejected rather than stored as zero. `errorKey` gets
 * `code` and `decimals` as variables.
 */
export const roundPositiveAmount = async ({
  money,
  userId,
  currencyCode,
  errorKey = 'transactions.amountBelowSmallestUnit',
}: {
  money: Money;
  userId: number;
  currencyCode: string;
  errorKey?: string;
}): Promise<Money> =>
  roundPositive({
    money,
    code: currencyCode,
    decimals: await getCurrencyDecimals({ userId, code: currencyCode }),
    errorKey,
  });

/** `roundPositiveAmount` for an amount stated in the user's base currency. */
export const roundPositiveBaseAmount = async ({
  money,
  userId,
  errorKey,
}: {
  money: Money;
  userId: number;
  errorKey: string;
}): Promise<Money> => {
  const { code, decimals } = await getBaseCurrencyPrecision({ userId });

  return roundPositive({ money, code, decimals, errorKey });
};
