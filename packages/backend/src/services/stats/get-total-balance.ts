import { type MinorUnits, asMinorUnits } from '@bt/shared/types';

import { getBalanceHistory } from './get-balance-history';
import { getCreditLimitAdjustment } from './get-credit-limit-adjustment';

/**
 * Retrieves the total balance for a user on a specified date.
 *
 * When `includeCreditLimit` is true, subtracts the total credit limit
 * (in base currency) from the balance so credit card available credit
 * does not inflate the total.
 *
 * @param {Object} params - The parameters for fetching the total balance.
 * @param {number} params.userId - The ID of the user for whom the total balance is to be fetched.
 * @param {string} params.date - The date in 'yyyy-mm-dd' format for which the total balance is to be calculated.
 * @param {boolean} [params.includeCreditLimit] - Whether to subtract credit limits from the total.
 * @param {number} params.decimals - Decimals of the base currency: the scale of the result.
 * @returns {Promise<MinorUnits>} - Total balance for asked date (in minor units of the base currency).
 */
export const getTotalBalance = async ({
  userId,
  date,
  includeCreditLimit = false,
  decimals,
}: {
  userId: number;
  date: string;
  includeCreditLimit?: boolean;
  decimals: number;
}): Promise<MinorUnits> => {
  const [balancesForDate, creditLimitSum] = await Promise.all([
    getBalanceHistory({ userId, accountScope: 'accessible', from: date, to: date, decimals }),
    includeCreditLimit
      ? getCreditLimitAdjustment({ userId, accountScope: 'accessible', decimals })
      : Promise.resolve(0),
  ]);

  const totalBalance = balancesForDate.reduce((acc, value) => (acc += value.amount.toMinorUnits({ decimals })), 0);

  return asMinorUnits(totalBalance - creditLimitSum);
};
