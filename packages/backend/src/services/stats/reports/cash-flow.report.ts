import { removeUndefinedKeys } from '@js/helpers';
import { serializeCashFlow } from '@root/serializers/stats.serializer';

import { getCashFlow } from '../get-cash-flow';

type CashFlowParams = Parameters<typeof getCashFlow>[0];

/** Income, expenses and net cash flow per period in the base currency. */
export const getCashFlowReport = async (params: CashFlowParams) => {
  const cashFlow = await getCashFlow(removeUndefinedKeys(params));

  return serializeCashFlow(cashFlow);
};
