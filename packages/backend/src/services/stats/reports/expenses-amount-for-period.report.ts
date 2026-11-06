import { removeUndefinedKeys } from '@js/helpers';
import { serializeExpensesAmountForPeriod } from '@root/serializers/stats.serializer';

import { getExpensesAmountForPeriod } from '../get-expenses-amount-for-period';

type ExpensesParams = Parameters<typeof getExpensesAmountForPeriod>[0];

/** Total expense amount for a period in the base currency, as a decimal. */
export const getExpensesAmountForPeriodReport = async (params: ExpensesParams) => {
  const amount = await getExpensesAmountForPeriod(removeUndefinedKeys(params));

  return serializeExpensesAmountForPeriod(amount);
};
