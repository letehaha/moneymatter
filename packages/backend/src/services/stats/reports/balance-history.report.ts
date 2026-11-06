import { serializeBalanceHistory } from '@root/serializers/stats.serializer';

import { getBalanceHistory } from '../get-balance-history';
import { getBalanceHistoryForAccount } from '../get-balance-history-for-account';

/**
 * Daily balance rows for one account, or for every account the user can reach when no account
 * is given. Returns the API payload: amounts as decimals.
 */
export const getBalanceHistoryReport = async ({
  userId,
  from,
  to,
  accountId,
}: {
  userId: number;
  from?: string;
  to?: string;
  accountId?: string;
}) => {
  if (accountId) {
    return serializeBalanceHistory(await getBalanceHistoryForAccount({ userId, from, to, accountId }));
  }

  return serializeBalanceHistory(await getBalanceHistory({ userId, accountScope: 'accessible', from, to }));
};
