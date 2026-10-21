import { currencyCode, dateBound } from '@common/lib/zod/custom-types';
import { ValidationError } from '@js/errors';
import { z } from 'zod';

/** One pair of an edit: the rate to store, and for a custom currency the day it starts to apply. */
export const editExchangeRatePairSchema = z
  .object({
    baseCode: currencyCode(),
    quoteCode: currencyCode(),
    rate: z.number().positive(),
    // The day a rate of a custom currency starts to apply; today when omitted. Rates between ISO
    // currencies apply to every day and refuse one.
    effectiveDate: dateBound().optional(),
  })
  .strict();

/** One pair of a removal. */
export const removeExchangeRatePairSchema = z.object({
  baseCode: z.string(),
  quoteCode: z.string(),
  rate: z.number().optional(),
  // Removes only the rate that starts on this day; every rate of the pair when omitted.
  effectiveDate: dateBound().optional(),
});

type Pair = { baseCode: string; quoteCode: string };

const hasOpposite = ({ pair, pairs }: { pair: Pair; pairs: Pair[] }): boolean =>
  pairs.some((item) => item.baseCode === pair.quoteCode);

/**
 * The rules of an edit that the body shape cannot hold: a pair never has the same base and quote, and
 * every pair comes with its opposite in the same call. REST and MCP reach them through
 * `editUserExchangeRates`, so both refuse the same calls with the same message.
 */
export const assertEditPairRules = ({ pairs }: { pairs: Pair[] }): void => {
  if (!pairs.every((pair) => pair.baseCode !== pair.quoteCode)) {
    throw new ValidationError({ message: 'You cannot edit pair with the same base and quote currency code.' });
  }

  if (!pairs.every((pair) => hasOpposite({ pair, pairs }))) {
    throw new ValidationError({
      message: "When changing base-quote pair rate, you need to also change opposite pair's rate.",
    });
  }
};

/** A removal drops both directions of a pair together, as an edit sets them together. */
export const assertRemovePairRules = ({ pairs }: { pairs: Pair[] }): void => {
  if (!pairs.every((pair) => hasOpposite({ pair, pairs }))) {
    throw new ValidationError({
      message: "When removing base-qoute pair rate, you need to also remove opposite pair's rate.",
    });
  }
};
