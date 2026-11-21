const cache = new Map<string, number>();

/** ISO decimals are the same for everyone and sit under the bare code; custom ones under `userId:code`. */
const buildKey = ({ userId, code }: { userId?: number; code: string }) =>
  userId === undefined ? code : `${userId}:${code}`;

export const getCachedCurrencyDecimals = ({ userId, code }: { userId?: number; code: string }): number | undefined =>
  cache.get(buildKey({ userId, code }));

export const setCachedCurrencyDecimals = ({
  userId,
  code,
  decimals,
}: {
  userId?: number;
  code: string;
  decimals: number;
}): void => {
  cache.set(buildKey({ userId, code }), decimals);
};

/**
 * Drops cached decimals after a currency or a per-user override changes.
 * Without `userId` every entry of the code is dropped; without `code` every custom entry of the
 * user is dropped; with neither the whole cache is cleared.
 */
export const invalidateCurrencyDecimalsCache = ({ userId, code }: { userId?: number; code?: string } = {}): void => {
  if (userId === undefined && code === undefined) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    const separatorIndex = key.indexOf(':');
    const keyUserId = separatorIndex === -1 ? undefined : key.slice(0, separatorIndex);
    const keyCode = key.slice(separatorIndex + 1);

    if ((userId === undefined || keyUserId === String(userId)) && (code === undefined || keyCode === code)) {
      cache.delete(key);
    }
  }
};
