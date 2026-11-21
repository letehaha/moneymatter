import type { CurrencyRateSource } from '@bt/shared/types';
import { UnexpectedError } from '@js/errors';
import UsersCurrencies from '@models/users-currencies.model';

import { pegRateSourceConfigSchema } from './index';

/**
 * What a peg turns a currency into: one unit of the pegged currency is worth `factor` units of the
 * ISO currency `quoteCode`. Nothing is stored; the quote's own rate for the day is looked up when asked.
 */
interface PegStep {
  quoteCode: string;
  factor: number;
}

const PEG_SOURCE = 'peg' satisfies CurrencyRateSource;

/**
 * The peg of one of the user's currencies, or `null` when its rates do not come from a peg. A saved
 * config that cannot be read is a data error: the save validates it, so guessing a value would hide it.
 */
export const findPeg = async ({ userId, code }: { userId: number; code: string }): Promise<PegStep | null> => {
  const held = await UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    attributes: ['rateSource', 'rateSourceConfig'],
    raw: true,
  });
  if (held?.rateSource !== PEG_SOURCE) return null;

  const parsed = pegRateSourceConfigSchema.safeParse(held.rateSourceConfig);
  if (!parsed.success) {
    throw new UnexpectedError({ message: `The peg of ${code} for user ${userId} has an unreadable config` });
  }

  return { quoteCode: parsed.data.pegCurrency, factor: parsed.data.factor };
};
