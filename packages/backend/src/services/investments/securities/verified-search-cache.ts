import type { SecuritySearchResult } from '@bt/shared/types/investments';
import { logger } from '@js/utils';
import { redisClient } from '@root/redis-client';

import type { SecurityIdentity } from './identity';

const TTL_SECONDS = 24 * 60 * 60;

type SearchResultKey = Pick<SecurityIdentity, 'providerName' | 'providerSymbol' | 'currencyCode'>;

// Deliberately not the Securities identity key: it addresses one provider listing.
const cacheKey = ({ providerName, providerSymbol, currencyCode }: SearchResultKey) =>
  `security-search:${providerName}:${providerSymbol}:${currencyCode.toUpperCase()}`;

export const rememberSearchResults = async ({ results }: { results: SecuritySearchResult[] }) => {
  if (results.length === 0) return;

  try {
    const pipeline = redisClient.pipeline();
    for (const result of results) {
      pipeline.set(cacheKey(result), JSON.stringify(result), 'EX', TTL_SECONDS);
    }
    const replies = await pipeline.exec();
    const failedCount = replies === null ? results.length : replies.filter(([error]) => error).length;
    if (failedCount > 0) {
      logger.error(`Failed to remember ${failedCount} of ${results.length} security search results`);
    }
  } catch (error) {
    logger.error({ message: 'Failed to remember security search results', error: error as Error });
  }
};

const parseCached = ({ value }: { value: string | null }): SecuritySearchResult | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as SecuritySearchResult;
  } catch {
    return null;
  }
};

/** Returns the provider-returned copy of each given result, aligned by index; null when not remembered. */
export const getVerifiedSearchResults = async ({
  securities,
}: {
  securities: SearchResultKey[];
}): Promise<(SecuritySearchResult | null)[]> => {
  if (securities.length === 0) return [];

  const values = await redisClient.mget(securities.map(cacheKey));
  return values.map((value) => parseCached({ value }));
};
