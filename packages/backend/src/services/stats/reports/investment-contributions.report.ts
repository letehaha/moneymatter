import { removeUndefinedKeys } from '@js/helpers';
import { serializeInvestmentContributions } from '@root/serializers/stats.serializer';

import { getInvestmentContributions } from '../get-investment-contributions';

type InvestmentContributionsParams = Parameters<typeof getInvestmentContributions>[0];

/** Money moved into and out of portfolios per period, in the base currency. */
export const getInvestmentContributionsReport = async (params: InvestmentContributionsParams) => {
  const result = await getInvestmentContributions(removeUndefinedKeys(params));

  return serializeInvestmentContributions(result);
};
