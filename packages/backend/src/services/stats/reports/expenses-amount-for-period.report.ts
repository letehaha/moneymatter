import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeExpensesAmountForPeriod } from '@root/serializers/stats.serializer';

import { getExpensesAmountForPeriod } from '../get-expenses-amount-for-period';

type ExpensesParams = Omit<Parameters<typeof getExpensesAmountForPeriod>[0], 'decimals'>;

/** Total expense amount for a period in the base currency, as a decimal. */
export const getExpensesAmountForPeriodReport = async (params: ExpensesParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const amountMinor = await getExpensesAmountForPeriod(removeUndefinedKeys({ ...params, decimals }));

  return serializeExpensesAmountForPeriod({ amountMinor, decimals });
};
