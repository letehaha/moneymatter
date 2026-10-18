import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { serializeVentureContributions } from '@root/serializers/stats.serializer';

import { getVentureContributions } from '../get-venture-contributions';

/** Net contribution per venture deal over a period, in the base currency. */
export const getVentureContributionsReport = async ({
  userId,
  from,
  to,
}: {
  userId: number;
  from: string;
  to: string;
}) => {
  const decimals = await getBaseCurrencyDecimals({ userId });

  const result = await getVentureContributions({ userId, from, to, decimals });

  return serializeVentureContributions({ result, decimals });
};
