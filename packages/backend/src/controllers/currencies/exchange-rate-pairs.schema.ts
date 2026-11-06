import { currencyCode } from '@common/lib/zod/custom-types';
import { z } from 'zod';

export const exchangeRatePairSchema = z
  .object({
    baseCode: currencyCode(),
    quoteCode: currencyCode(),
  })
  .strict();

export const exchangeRatePairWithRateSchema = z
  .object({
    baseCode: currencyCode(),
    quoteCode: currencyCode(),
    rate: z.number().positive(),
  })
  .strict();

const hasExactInverse = (pairs: { baseCode: string; quoteCode: string }[]) =>
  pairs.every((pair) => pairs.some((item) => item.baseCode === pair.quoteCode && item.quoteCode === pair.baseCode));

export const removeExchangeRatePairsSchema = z
  .array(exchangeRatePairSchema)
  .nonempty()
  .refine(hasExactInverse, "When removing base-quote pair rate, you need to also remove opposite pair's rate.");

export const setExchangeRatePairsSchema = z
  .array(exchangeRatePairWithRateSchema)
  .nonempty()
  .refine(
    (pairs) => pairs.every((pair) => pair.baseCode !== pair.quoteCode),
    'You cannot edit pair with the same base and quote currency code.',
  )
  .refine(hasExactInverse, "When changing base-quote pair rate, you need to also change opposite pair's rate.");
