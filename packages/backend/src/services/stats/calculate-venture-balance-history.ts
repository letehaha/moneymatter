import { VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import ExchangeRates from '@models/exchange-rates.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEvents from '@models/venture/venture-events.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import {
  createFindLatestUsdRate,
  createGetExchangeRate,
} from '@services/stats/get-combined-balance-history/exchange-rate-lookup';
import Big from 'big.js';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

const formatDate = (date: Date | string): string => format(date, 'yyyy-MM-dd');

const NAV_BEARING_TYPES: readonly VENTURE_EVENT_TYPE[] = [
  VENTURE_EVENT_TYPE.nav_update,
  VENTURE_EVENT_TYPE.writedown,
  VENTURE_EVENT_TYPE.exit,
  VENTURE_EVENT_TYPE.distribution,
];

const COST_BASIS_GROWING_TYPES: readonly VENTURE_EVENT_TYPE[] = [
  VENTURE_EVENT_TYPE.capital_call,
  VENTURE_EVENT_TYPE.fee_payment,
];

const DISTRIBUTION_TYPES: readonly VENTURE_EVENT_TYPE[] = [VENTURE_EVENT_TYPE.distribution, VENTURE_EVENT_TYPE.exit];

interface DealCompute {
  id: string;
  currencyCode: string;
  investmentDate: string;
  baseCost: Big;
  events: VentureEvents[];
}

/**
 * Day-by-day LP-side value of all venture deals for a user, converted to base.
 *
 * For each day D and each deal:
 *   - If investmentDate > D, deal contributes 0 (not yet invested).
 *   - Else find the latest NAV-bearing event (nav_update / writedown / exit /
 *     distribution) at-or-before D with a non-null navAfter; that value wins.
 *   - Else fall back to `costBasis(D) − cumulativeDistributions(D)`, where
 *     costBasis grows on capital_call and fee_payment events.
 *
 * Matches the live deal-metrics calculation (see compute-current-value.ts)
 * but skips the current-status short-circuit because historical points can't
 * use a present-tense status field.
 */
export const calculateVentureBalanceHistory = async ({
  userId,
  minDate,
  maxDate,
  uniqueDates,
  userBaseCurrencyPromise,
  decimals,
}: {
  userId: number;
  minDate: string;
  maxDate: string;
  uniqueDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
  /** Decimals of the base currency: the minor-unit scale the per-day totals are rounded to. */
  decimals: number;
}): Promise<Map<string, number> | null> => {
  const [userBaseCurrency, deals] = await Promise.all([
    userBaseCurrencyPromise,
    VentureDeals.findAll({
      where: { userId },
      attributes: ['id', 'currencyCode', 'investmentDate', 'principal', 'entryFee'],
    }),
  ]);

  if (!userBaseCurrency?.currencyCode || deals.length === 0) {
    return null;
  }

  const dealIds = deals.map((d) => d.id);
  const events = await VentureEvents.findAll({
    where: { dealId: { [Op.in]: dealIds } },
    order: [
      ['dealId', 'ASC'],
      ['eventDate', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });

  const eventsByDeal = new Map<string, VentureEvents[]>();
  for (const ev of events) {
    const list = eventsByDeal.get(ev.dealId);
    if (list) list.push(ev);
    else eventsByDeal.set(ev.dealId, [ev]);
  }

  const dealComputes: DealCompute[] = deals.map((d) => ({
    id: d.id,
    currencyCode: d.currencyCode,
    investmentDate: d.investmentDate,
    baseCost: new Big(d.principal.toDecimalString(10)).plus(d.entryFee.toDecimalString(10)),
    events: eventsByDeal.get(d.id) ?? [],
  }));

  const dealCurrencyCodes = [...new Set(deals.map((d) => d.currencyCode))];

  // Same +7-day backfill as portfolio history — gives findLatestUsdRate a
  // prior trading day to fall back on for weekends/holidays at minDate.
  const dataFetchMinDate = format(subDays(parseISO(minDate), 7), 'yyyy-MM-dd');

  const usdRateQuoteCodes = [...new Set([userBaseCurrency.currencyCode, ...dealCurrencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  type ExchangeRateRow = Pick<UserExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate'>;

  const [userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: { [Op.in]: dealCurrencyCodes },
        quoteCode: userBaseCurrency.currencyCode,
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
  const getExchangeRate = createGetExchangeRate({
    userBaseCurrencyCode: userBaseCurrency.currencyCode,
    userRatesMap,
    findLatestUsdRate: createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote }),
    onMissingRate: ({ currencyCode, approximated }) => {
      if (!approximated) missingRateCurrencies.add(currencyCode);
    },
  });

  const dealValueAt = (deal: DealCompute, dateStr: string): Big => {
    if (deal.investmentDate > dateStr) return new Big(0);

    let basis = new Big(deal.baseCost);
    let cumDist = new Big(0);
    let latestNav: Big | null = null;

    for (const ev of deal.events) {
      if (ev.eventDate > dateStr) break;

      if (COST_BASIS_GROWING_TYPES.includes(ev.type) && ev.grossAmount) {
        basis = basis.plus(ev.grossAmount.toDecimalString(10));
      }
      if (DISTRIBUTION_TYPES.includes(ev.type) && ev.lpNetAmount) {
        cumDist = cumDist.plus(ev.lpNetAmount.toDecimalString(10));
      }
      if (NAV_BEARING_TYPES.includes(ev.type) && ev.navAfter !== null) {
        latestNav = new Big(ev.navAfter.toDecimalString(10));
      }
    }

    return latestNav ?? basis.minus(cumDist);
  };

  const ventureValuesByDate = new Map<string, number>();
  for (const dateStr of uniqueDates) {
    let totalInBase = new Big(0);
    for (const deal of dealComputes) {
      const valueInDealCurrency = dealValueAt(deal, dateStr);
      if (valueInDealCurrency.eq(0)) continue;
      const rate = getExchangeRate(deal.currencyCode, dateStr);
      totalInBase = totalInBase.plus(valueInDealCurrency.times(rate));
    }
    ventureValuesByDate.set(dateStr, Money.fromDecimal(Number(totalInBase.toFixed(10))).toMinorUnits({ decimals }));
  }

  if (missingRateCurrencies.size > 0) {
    logger.warn('Venture history exchange rate fallback to 1:1', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(missingRateCurrencies),
      dateRange: { from: minDate, to: maxDate },
    });
  }

  return ventureValuesByDate;
};
