import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializePivotReport } from '@root/serializers/stats.serializer';

import { getPivotReport } from '../get-pivot';

type PivotParams = Omit<Parameters<typeof getPivotReport>[0], 'decimals'>;

/** Rows (category, subcategory, payee or tag) by time buckets, summing one measure in the base currency. */
export const getPivotTableReport = async (params: PivotParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const result = await getPivotReport(removeUndefinedKeys({ ...params, decimals }));

  return serializePivotReport({ result, decimals });
};
