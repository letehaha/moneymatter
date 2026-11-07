import { removeUndefinedKeys } from '@js/helpers';
import { serializePivotReport } from '@root/serializers/stats.serializer';

import { getPivotReport } from '../get-pivot';

type PivotParams = Parameters<typeof getPivotReport>[0];

/** Rows (category, subcategory, payee or tag) by time buckets, summing one measure in the base currency. */
export const getPivotTableReport = async (params: PivotParams) => {
  const result = await getPivotReport(removeUndefinedKeys(params));

  return serializePivotReport(result);
};
