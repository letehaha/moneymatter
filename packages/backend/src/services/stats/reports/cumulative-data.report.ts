import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeCumulativeData } from '@root/serializers/stats.serializer';

import { getCumulativeData } from '../get-cumulative-data';

type CumulativeParams = Omit<Parameters<typeof getCumulativeData>[0], 'decimals'>;

/** Running totals of one metric for a period and the period before it, in the base currency. */
export const getCumulativeDataReport = async (params: CumulativeParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const cumulative = await getCumulativeData(removeUndefinedKeys({ ...params, decimals }));

  return serializeCumulativeData({ cumulative, decimals });
};
