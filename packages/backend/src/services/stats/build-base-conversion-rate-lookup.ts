import { logger } from '@js/utils';
import ExchangeRates from '@models/exchange-rates.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

/**
 * Number of days of rate history to load before the requested range. Rates are
 * published per business day, so a snapshot landing on a weekend or holiday has
 * to fall back to the most recent earlier quote.
 */
const RATE_LOOKBACK_DAYS = 7;

const formatDate = (date: Date | string): string => format(date, 'yyyy-MM-dd');

interface BuildParams {
  userId: number;
  /** Currencies the caller needs converted into base. */
  currencyCodes: string[];
  baseCurrencyCode: string;
  /** yyyy-MM-dd bounds of the snapshot range. */
  minDate: string;
  maxDate: string;
}

interface RateLookup {
  /** Multiplier turning an amount in `currencyCode` into base, on `dateStr`. */
  getExchangeRate: (currencyCode: string, dateStr: string) => number;
  /** Currencies that had no usable rate and silently fell back to 1:1. */
  missingRateCurrencies: Set<string>;
}

/**
 * Build a point-in-time currency→base conversion function for one user.
 *
 * The projected-asset history calculators (vehicles, properties) each recompute
 * their curve per snapshot date and then need the same conversion: user-defined
 * override rate first, otherwise the stored USD cross-rate carried forward from
 * the nearest earlier publication date.
 *
 * A currency with no usable rate converts 1:1 and is recorded in
 * `missingRateCurrencies` so the caller can log it once instead of per date.
 */
export const buildBaseConversionRateLookup = async ({
  userId,
  currencyCodes,
  baseCurrencyCode,
  minDate,
  maxDate,
}: BuildParams): Promise<RateLookup> => {
  const dataFetchMinDate = format(subDays(parseISO(minDate), RATE_LOOKBACK_DAYS), 'yyyy-MM-dd');

  const uniqueCurrencyCodes = [...new Set(currencyCodes)];
  const usdRateQuoteCodes = [...new Set([baseCurrencyCode, ...uniqueCurrencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  type ExchangeRateRow = Pick<UserExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate'>;

  const [userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: { [Op.in]: uniqueCurrencyCodes },
        quoteCode: baseCurrencyCode,
        date: { [Op.between]: [dataFetchMinDate, maxDate] },
      },
      attributes: ['baseCode', 'quoteCode', 'date', 'rate'],
      raw: true,
    }) as Promise<ExchangeRateRow[]>,
    ExchangeRates.findAll({
      where: {
        baseCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCode: { [Op.in]: usdRateQuoteCodes },
        date: {
          [Op.between]: [startOfDay(parseISO(dataFetchMinDate)), endOfDay(parseISO(maxDate))],
        },
      },
      order: [
        ['quoteCode', 'ASC'],
        ['date', 'ASC'],
      ],
      raw: true,
    }),
  ]);

  const userRatesMap = new Map<string, number>();
  for (const r of userCustomExchangeRates) {
    userRatesMap.set(`${r.baseCode}_${formatDate(r.date)}`, r.rate);
  }

  const { usdRatesMap, usdRateDatesByQuote } = await buildUsdRateLookup({
    systemRates: systemExchangeRates,
    quoteCodes: usdRateQuoteCodes,
    windowStart: dataFetchMinDate,
  });

  const missingRateCurrencies = new Set<string>();

  const findLatestUsdRate = (quoteCode: string, dateStr: string): number | null => {
    if (quoteCode === API_LAYER_BASE_CURRENCY_CODE) return 1;
    const exact = usdRatesMap.get(`${quoteCode}_${dateStr}`);
    if (exact !== undefined) return exact;

    const dates = usdRateDatesByQuote.get(quoteCode);
    if (!dates || dates.length === 0) return null;

    let candidate: number | null = null;
    for (const d of dates) {
      if (d <= dateStr) candidate = usdRatesMap.get(`${quoteCode}_${d}`) ?? candidate;
      else break;
    }
    return candidate;
  };

  const getExchangeRate = (currencyCode: string, dateStr: string): number => {
    if (currencyCode === baseCurrencyCode) return 1;

    const userOverride = userRatesMap.get(`${currencyCode}_${dateStr}`);
    if (userOverride !== undefined) return userOverride;

    const usdToCurrency = findLatestUsdRate(currencyCode, dateStr);
    const usdToBase = findLatestUsdRate(baseCurrencyCode, dateStr);

    if (usdToCurrency == null || usdToBase == null) {
      missingRateCurrencies.add(currencyCode);
      return 1;
    }
    if (usdToCurrency === 0) {
      logger.error(`Stored exchange rate is zero for USD->${currencyCode} on ${dateStr}; treating as missing.`);
      missingRateCurrencies.add(currencyCode);
      return 1;
    }

    return usdToBase / usdToCurrency;
  };

  return { getExchangeRate, missingRateCurrencies };
};
