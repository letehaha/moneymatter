/**
 * Per-user budgets shared by the REST middleware (`middlewares/rate-limit.ts`) and the MCP tools
 * (`enforceUserRateLimit`). The key is the one REST has always used, so both paths draw from one
 * counter per user.
 */
export interface UserRateLimit {
  windowSeconds: number;
  maxAttempts: number;
  key: ({ userId }: { userId: number }) => string;
}

const userRateLimit = ({
  prefix,
  windowSeconds,
  maxAttempts,
}: {
  prefix: string;
  windowSeconds: number;
  maxAttempts: number;
}): UserRateLimit => ({
  windowSeconds,
  maxAttempts,
  key: ({ userId }) => `${prefix}:user:${userId}`,
});

/**
 * Rate-source save limit (20 saves per minute). A save that changes the source fetches from CoinGecko
 * (one shared key for the instance) or from the user's URL, and values every saved row of the
 * currency again, so it cannot be repeated without bound.
 */
export const RATE_SOURCE_SAVE_LIMIT = userRateLimit({ prefix: 'rate-source-save', windowSeconds: 60, maxAttempts: 20 });

/**
 * Rate-source preview limit (20 previews per minute). Each call makes the server fetch a URL the
 * user typed, so it stays low enough that the endpoint cannot be used to hammer a host.
 */
export const RATE_SOURCE_TEST_LIMIT = userRateLimit({ prefix: 'rate-source-test', windowSeconds: 60, maxAttempts: 20 });
