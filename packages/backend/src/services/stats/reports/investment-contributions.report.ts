import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { removeUndefinedKeys } from '@js/helpers';
import { serializeInvestmentContributions } from '@root/serializers/stats.serializer';

import { getInvestmentContributions } from '../get-investment-contributions';

type InvestmentContributionsParams = Omit<Parameters<typeof getInvestmentContributions>[0], 'decimals'>;

/** Money moved into and out of portfolios per period, in the base currency. */
export const getInvestmentContributionsReport = async (params: InvestmentContributionsParams) => {
  const decimals = await getBaseCurrencyDecimals({ userId: params.userId });

  const result = await getInvestmentContributions(removeUndefinedKeys({ ...params, decimals }));

  return serializeInvestmentContributions({ result, decimals });
};
