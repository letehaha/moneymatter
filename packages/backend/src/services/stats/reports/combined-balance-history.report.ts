import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { serializeCombinedBalanceHistory } from '@root/serializers/stats.serializer';
import { getUserSettings } from '@services/user-settings/get-user-settings';

import { getCombinedBalanceHistory } from '../get-combined-balance-history';

/** Daily balance of accounts, portfolios, ventures, vehicles and loans, net of credit limits when the user setting is on. */
export const getCombinedBalanceHistoryReport = async ({
  userId,
  from,
  to,
}: {
  userId: number;
  from?: string;
  to?: string;
}) => {
  const [settings, decimals] = await Promise.all([getUserSettings({ userId }), getBaseCurrencyDecimals({ userId })]);

  const items = await getCombinedBalanceHistory({
    userId,
    from,
    to,
    includeCreditLimit: settings.includeCreditLimitInStats,
    decimals,
  });

  return serializeCombinedBalanceHistory({ items, decimals });
};
