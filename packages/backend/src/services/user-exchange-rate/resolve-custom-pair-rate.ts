import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

type ResolveRate = (params: { baseCode: string; quoteCode: string }) => Promise<ResolvedRate>;

/**
 * The user's rate for a custom code against an ISO currency: the one quoted in `preferredQuoteCode`
 * when it exists, otherwise the first quote by code, so the choice never depends on write order.
 */
export const findCustomCurrencyQuote = async ({
  userId,
  code,
  preferredQuoteCode,
}: {
  userId: number;
  code: string;
  preferredQuoteCode?: string;
}): Promise<{ quoteCode: string; rate: number } | null> => {
  const rows = await UserExchangeRates.findAll({
    where: { userId, baseCode: code },
    attributes: ['quoteCode', 'rate'],
    order: [['quoteCode', 'ASC']],
    raw: true,
  });
  const customQuotes = await findCustomCurrencyCodes({ codes: rows.map((row) => row.quoteCode) });
  const isoRows = rows.filter((row) => !customQuotes.has(row.quoteCode) && row.rate > 0);
  const row = isoRows.find((item) => item.quoteCode === preferredQuoteCode) ?? isoRows[0];

  return row ? { quoteCode: row.quoteCode, rate: row.rate } : null;
};

/**
 * Rate of a pair with a custom side: the user's exact-pair rate, else each custom side via its ISO
 * quote. Skips the global cross-rate cache (keyed by date and code only) and keeps full precision,
 * since market formatting would erase a coin worth a fraction of a cent. Plain float math keeps
 * ~15 significant digits at any magnitude, where Big.js cuts at 20 decimal places.
 */
export const resolveCustomPairRate = async ({
  userId,
  pair,
  date,
  resolveIsoRate,
}: {
  userId: number;
  pair: { baseCode: string; quoteCode: string };
  date: Date;
  resolveIsoRate: ResolveRate;
}): Promise<ResolvedRate> => {
  const exact = await UserExchangeRates.findOne({
    where: { userId, baseCode: pair.baseCode, quoteCode: pair.quoteCode },
    raw: true,
  });
  if (exact && exact.rate > 0)
    return { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: exact.date, rate: exact.rate, custom: true };

  const customCodes = await findCustomCurrencyCodes({ codes: [pair.baseCode, pair.quoteCode] });

  const priceInIsoCurrency = async ({ code, otherCode }: { code: string; otherCode: string }) => {
    if (!customCodes.has(code)) return { quoteCode: code, rate: 1 };

    const quote = await findCustomCurrencyQuote({ userId, code, preferredQuoteCode: otherCode });
    if (!quote) {
      throw new ExchangeRateUnavailableError({
        message: t({
          key: 'currencies.exchangeRateNotAvailable',
          variables: { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: date.toISOString() },
        }),
      });
    }
    return quote;
  };

  const base = await priceInIsoCurrency({ code: pair.baseCode, otherCode: pair.quoteCode });
  const quote = await priceInIsoCurrency({ code: pair.quoteCode, otherCode: pair.baseCode });

  const isoRate =
    base.quoteCode === quote.quoteCode
      ? 1
      : (await resolveIsoRate({ baseCode: base.quoteCode, quoteCode: quote.quoteCode })).rate;

  const rate = (base.rate * isoRate) / quote.rate;

  return { ...pair, rate, date, custom: true };
};
