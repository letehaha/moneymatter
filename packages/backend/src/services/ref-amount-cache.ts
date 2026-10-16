import type { Money } from '@common/types/money';
import { CacheClient } from '@js/utils/cache';

/**
 * Cache namespace of converted amounts. Cached values are exact decimal strings; the
 * version segment keeps entries of an older value format from ever being read.
 */
const REF_AMOUNT_CACHE_NAMESPACE = 'ref_amount:v2';

/** Decimals kept in cache keys and values; matches the scale of the money columns. */
const REF_AMOUNT_CACHE_SCALE = 18;

export const refAmountCache = new CacheClient<string>({
  logPrefix: 'calculateRefAmountImpl',
  ttl: 3600, // 1 hour
  // Values are decimal strings; JSON parsing would turn them into lossy numbers.
  parseJson: false,
});

/** Key of one converted amount: user, native amount, pair and calendar day. */
export const buildRefAmountCacheKey = ({
  userId,
  amount,
  baseCode,
  quoteCode,
  dateStr,
}: {
  userId: number;
  amount: Money;
  baseCode: string;
  quoteCode: string;
  dateStr: string;
}): string =>
  `${REF_AMOUNT_CACHE_NAMESPACE}:${userId}:${amount.toDecimalString(REF_AMOUNT_CACHE_SCALE)}:${baseCode}:${quoteCode}:${dateStr}`;

/** Cached value of a converted amount. */
export const serializeRefAmountCacheValue = ({ amount }: { amount: Money }): string =>
  amount.toDecimalString(REF_AMOUNT_CACHE_SCALE);

/** Redis pattern matching every cached converted amount of one user. Every invalidator uses it. */
export const buildRefAmountCachePattern = ({ userId }: { userId: number }): string =>
  `${REF_AMOUNT_CACHE_NAMESPACE}:${userId}:*`;
