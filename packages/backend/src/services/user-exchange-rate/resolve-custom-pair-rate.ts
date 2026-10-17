import type { CurrencyRateSource } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { findStoredCustomRate, findStoredPairRate } from '@services/currencies/rate-sources/manual';
import { findPeg } from '@services/currencies/rate-sources/peg';
import Big from 'big.js';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

/** The sources whose own rates value a currency: a stored rate for an exact pair never overrides them. */
const SOURCE_OWNED_RATE_SOURCES = ['peg', 'coingecko', 'http'] as const satisfies readonly CurrencyRateSource[];

type IsCustomCode = (params: { code: string }) => Promise<boolean>;

type ResolveRate = (params: { baseCode: string; quoteCode: string }) => Promise<ResolvedRate>;

const unavailable = ({ pair, date }: { pair: { baseCode: string; quoteCode: string }; date: Date }) =>
  new ExchangeRateUnavailableError({
    message: t({
      key: 'currencies.exchangeRateNotAvailable',
      variables: { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: date.toISOString() },
    }),
  });

/**
 * Walks a custom code down to the first code that is not custom. A step is the user's peg for the
 * code (a fixed factor of its peg currency, valued on the same day) or, for every other source, the
 * quote currency of the user's own stored rate. `factor` is how many units of the ISO currency
 * reached one unit of the custom code is worth. A custom code without a rate, a peg whose config
 * cannot be read, or a loop of custom codes (a peg cycle, or rates that quote each other) has no
 * value.
 *
 * Whether a quote is custom is asked at every step, not read from the codes of the requested pair: a
 * rate can quote another custom code, and treating that code as ISO would hand it to the ISO
 * resolution, which would come back here and walk the same loop again. The rate editor stores both
 * directions of a pair, so a stored step never takes a rate that quotes a code already walked when
 * another rate exists. A peg has no alternative: a peg onto a code already walked is a cycle.
 */
const priceInIsoCurrency = async ({
  userId,
  code,
  isCustom,
  date,
  pair,
}: {
  userId: number;
  code: string;
  isCustom: IsCustomCode;
  date: Date;
  pair: { baseCode: string; quoteCode: string };
}): Promise<{ code: string; factor: Big }> => {
  const asOfDate = toEffectiveDate({ date });
  const visited = new Set<string>();
  let current = code;
  let factor = new Big(1);

  while (await isCustom({ code: current })) {
    if (visited.has(current)) throw unavailable({ pair, date });
    visited.add(current);

    const peg = await findPeg({ userId, code: current });
    if (peg.kind === 'invalid') throw unavailable({ pair, date });

    if (peg.kind === 'peg') {
      factor = factor.times(peg.factor);
      current = peg.quoteCode;
      continue;
    }

    const step = await findStoredCustomRate({ userId, baseCode: current, asOfDate, excludedQuotes: [...visited] });
    if (!step) throw unavailable({ pair, date });

    factor = factor.times(step.rate);
    current = step.quoteCode;
  }

  return { code: current, factor };
};

/** Whether the user's rates for a custom code come from a peg or from a synced source, not from their own entries. */
const followsASource = async ({ userId, code }: { userId: number; code: string }): Promise<boolean> => {
  const held = await UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    attributes: ['rateSource'],
    raw: true,
  });

  return held ? (SOURCE_OWNED_RATE_SOURCES as readonly string[]).includes(held.rateSource) : false;
};

/**
 * Rate of a pair in which at least one side is a custom currency, on the day of `date`. It never
 * touches the global cross-rate cache, which is keyed by date and code only.
 *
 * Every user rate is read by day: the one that started most recently on or before that day applies,
 * whatever the user's live-rate setting or base currency, and a day before the first rate has none.
 * A pegged currency is valued by its peg on the day instead: `factor` times the peg currency's own
 * rate, which may be another custom currency, so every source resolves on this one path.
 *
 * 1. A rate the user entered for exactly this pair wins (unless a side follows a peg or a synced source).
 * 2. Otherwise each custom side is priced in the quote currency of the user's own rate or peg for
 *    it, and the remaining ISO-to-ISO conversion goes through `resolveIsoRate` for the same day, so
 *    a manual ISO rate into the base wins and the market rate fills in otherwise.
 *
 * Custom rates keep their full precision: the 5-decimal market formatting would erase a coin worth
 * a fraction of a cent.
 */
export const resolveCustomPairRate = async ({
  userId,
  pair,
  date,
  isCustom,
  resolveIsoRate,
}: {
  userId: number;
  pair: { baseCode: string; quoteCode: string };
  date: Date;
  /** Whether a code is a custom currency, asked for the codes the user's rates quote as well. */
  isCustom: IsCustomCode;
  /** Resolves a pair of codes that are both ISO: it is never given a custom code. */
  resolveIsoRate: ResolveRate;
}): Promise<ResolvedRate> => {
  // A currency that follows a peg or a synced source is valued by it alone: a rate quoted in the base
  // currency that the user entered earlier (or a backup restored) would otherwise win over every
  // later day of the source. Only a `manual` currency takes the exact pair shortcut.
  const sidesFollowingASource = await Promise.all(
    [pair.baseCode, pair.quoteCode].map(
      async (code) => (await isCustom({ code })) && (await followsASource({ userId, code })),
    ),
  );
  const exact = sidesFollowingASource.some(Boolean)
    ? null
    : await findStoredPairRate({
        userId,
        baseCode: pair.baseCode,
        quoteCode: pair.quoteCode,
        asOfDate: toEffectiveDate({ date }),
      });
  if (exact) {
    return {
      baseCode: pair.baseCode,
      quoteCode: pair.quoteCode,
      date: new Date(exact.effectiveDate),
      rate: exact.rate,
      custom: true,
    };
  }

  const base = await priceInIsoCurrency({ userId, code: pair.baseCode, isCustom, date, pair });
  const quote = await priceInIsoCurrency({ userId, code: pair.quoteCode, isCustom, date, pair });

  const isoRate =
    base.code === quote.code ? 1 : (await resolveIsoRate({ baseCode: base.code, quoteCode: quote.code })).rate;

  // Decimal arithmetic, so chaining rates does not add binary floating-point noise.
  const rate = base.factor.times(isoRate).div(quote.factor).toNumber();

  return { ...pair, rate, date, custom: true };
};
