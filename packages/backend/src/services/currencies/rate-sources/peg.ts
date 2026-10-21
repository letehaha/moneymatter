import type { CurrencyRateSource } from '@bt/shared/types';
import UsersCurrencies from '@models/users-currencies.model';

import { pegRateSourceConfigSchema } from './index';

/**
 * What a peg turns a currency into: one unit of the pegged currency is worth `factor` units of
 * `quoteCode`. Nothing is stored; the quote's own rate for the day is looked up when asked.
 */
type PegStep = { quoteCode: string; factor: number };

type PegLookup =
  /** The user's rates for this currency do not come from a peg. */
  | { kind: 'none' }
  /** The currency is pegged, but the saved config cannot be read (a backup restores it verbatim). */
  | { kind: 'invalid' }
  | ({ kind: 'peg' } & PegStep);

const PEG_SOURCE = 'peg' satisfies CurrencyRateSource;

/**
 * Reads the peg of one of the user's currencies. The config is parsed defensively: a restored
 * backup can hold anything, and an unreadable peg is reported rather than guessed at.
 */
export const findPeg = async ({ userId, code }: { userId: number; code: string }): Promise<PegLookup> => {
  const held = await UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    attributes: ['rateSource', 'rateSourceConfig'],
    raw: true,
  });
  if (held?.rateSource !== PEG_SOURCE) return { kind: 'none' };

  const parsed = pegRateSourceConfigSchema.safeParse(held.rateSourceConfig);
  if (!parsed.success) return { kind: 'invalid' };

  return { kind: 'peg', quoteCode: parsed.data.pegCurrency, factor: parsed.data.factor };
};
