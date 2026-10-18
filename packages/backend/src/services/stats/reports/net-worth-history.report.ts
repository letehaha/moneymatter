import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { serializeNetWorthHistory } from '@root/serializers/stats.serializer';
import { getUserSettings } from '@services/user-settings/get-user-settings';

import { getNetWorthHistory } from '../get-net-worth-history';

type NetWorthHistoryParams = Omit<Parameters<typeof getNetWorthHistory>[0], 'decimals' | 'includeCreditLimit'>;

/** Net worth per period split into assets and liabilities, net of credit limits when the user setting is on. */
export const getNetWorthHistoryReport = async (params: NetWorthHistoryParams) => {
  const [settings, decimals] = await Promise.all([
    getUserSettings({ userId: params.userId }),
    getBaseCurrencyDecimals({ userId: params.userId }),
  ]);

  const result = await getNetWorthHistory({
    ...params,
    includeCreditLimit: settings.includeCreditLimitInStats,
    decimals,
  });

  return serializeNetWorthHistory({ result, decimals });
};
