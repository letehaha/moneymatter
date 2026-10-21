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
  const result = await getVentureContributions({ userId, from, to });

  return serializeVentureContributions(result);
};
