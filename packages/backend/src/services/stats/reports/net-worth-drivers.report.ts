import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeNetWorthDrivers } from '@root/serializers/stats.serializer';

import { getNetWorthDrivers } from '../get-net-worth-drivers';

type NetWorthDriversParams = Omit<Parameters<typeof getNetWorthDrivers>[0], 'decimals'>;

/** What moved net worth per period (savings, investment flows and growth), in the base currency. */
export const getNetWorthDriversReport = async (params: NetWorthDriversParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const result = await getNetWorthDrivers(removeUndefinedKeys({ ...params, decimals }));

  return serializeNetWorthDrivers({ result, decimals });
};
