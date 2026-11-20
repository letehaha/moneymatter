const cache = new Map<string, number>();

export const getCachedCurrencyDecimals = ({ code }: { code: string }): number | undefined => cache.get(code);

export const setCachedCurrencyDecimals = ({ code, decimals }: { code: string; decimals: number }): void => {
  cache.set(code, decimals);
};

/**
 * Drops cached decimals after a currency row changes: the entry of `code`, or the whole cache
 * without it.
 */
export const invalidateCurrencyDecimalsCache = ({ code }: { code?: string } = {}): void => {
  if (code === undefined) {
    cache.clear();
    return;
  }

  cache.delete(code);
};
