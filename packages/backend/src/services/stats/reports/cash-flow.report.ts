import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeCashFlow } from '@root/serializers/stats.serializer';

import { getCashFlow } from '../get-cash-flow';

type CashFlowParams = Omit<Parameters<typeof getCashFlow>[0], 'decimals'>;

/** Income, expenses and net cash flow per period in the base currency. */
export const getCashFlowReport = async (params: CashFlowParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const cashFlow = await getCashFlow(removeUndefinedKeys({ ...params, decimals }));

  return serializeCashFlow({ cashFlow, decimals });
};
