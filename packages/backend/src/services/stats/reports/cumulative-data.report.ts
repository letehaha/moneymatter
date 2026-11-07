import { removeUndefinedKeys } from '@js/helpers';
import { serializeCumulativeData } from '@root/serializers/stats.serializer';

import { getCumulativeData } from '../get-cumulative-data';

type CumulativeParams = Parameters<typeof getCumulativeData>[0];

/** Running totals of one metric for a period and the period before it, in the base currency. */
export const getCumulativeDataReport = async (params: CumulativeParams) => {
  const cumulative = await getCumulativeData(removeUndefinedKeys(params));

  return serializeCumulativeData(cumulative);
};
