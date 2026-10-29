import { removeUndefinedKeys } from '@js/helpers';
import { serializeNetWorthDrivers } from '@root/serializers/stats.serializer';

import { getNetWorthDrivers } from '../get-net-worth-drivers';

type NetWorthDriversParams = Parameters<typeof getNetWorthDrivers>[0];

/** What moved net worth per period (savings, investment flows and growth), in the base currency. */
export const getNetWorthDriversReport = async (params: NetWorthDriversParams) => {
  const result = await getNetWorthDrivers(removeUndefinedKeys(params));

  return serializeNetWorthDrivers(result);
};
