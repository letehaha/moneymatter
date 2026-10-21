const cache = new Map<string, number>();

const buildKey = ({ userId, code }: { userId: number; code: string }) => `${userId}:${code}`;

export const getCachedCurrencyDecimals = ({ userId, code }: { userId: number; code: string }): number | undefined =>
  cache.get(buildKey({ userId, code }));

export const setCachedCurrencyDecimals = ({
  userId,
  code,
  decimals,
}: {
  userId: number;
  code: string;
  decimals: number;
}): void => {
  cache.set(buildKey({ userId, code }), decimals);
};

/**
 * Drops cached decimals after a currency or a per-user override changes.
 * Without `userId` the entries of every user for the code are dropped; without `code` the
 * entries of every code for the user are dropped; with neither the whole cache is cleared.
 */
export const invalidateCurrencyDecimalsCache = ({ userId, code }: { userId?: number; code?: string } = {}): void => {
  if (userId === undefined && code === undefined) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    const separatorIndex = key.indexOf(':');
    const keyUserId = key.slice(0, separatorIndex);
    const keyCode = key.slice(separatorIndex + 1);

    if ((userId === undefined || keyUserId === String(userId)) && (code === undefined || keyCode === code)) {
      cache.delete(key);
    }
  }
};
