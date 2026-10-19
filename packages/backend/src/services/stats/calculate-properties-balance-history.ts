import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import ExchangeRates from '@models/exchange-rates.model';
import Properties from '@models/properties.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { computePropertyValue } from '@services/properties/compute-property-value';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import {
  createFindLatestUsdRate,
  createGetExchangeRate,
} from '@services/stats/get-combined-balance-history/exchange-rate-lookup';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

const formatDate = (date: Date | string): string => format(date, 'yyyy-MM-dd');

const propertyValueAtDate = (property: PropertyCompute, dateStr: string): number => {
  if (property.purchaseDate > dateStr) return 0;

  let activeAnchor = property.anchors[0]!;
  for (const anchor of property.anchors) {
    if (anchor.date <= dateStr) activeAnchor = anchor;
    else break;
  }

  const value = computePropertyValue({
    anchorValue: Money.fromCents(activeAnchor.valueCents),
    anchorDate: parseISO(activeAnchor.date),
    asOf: parseISO(dateStr),
    annualRatePct: property.annualRatePct,
  });

  return value.toCents();
};

interface PropertyAnchor {
  /** yyyy-MM-dd. Either purchaseDate or the latest override tx date. */
  date: string;
  /** Property value at the anchor moment, in account currency cents. */
  valueCents: number;
}

interface PropertyCompute {
  id: string;
  accountId: string;
  accountCurrencyCode: string;
  purchaseDate: string;
  annualRatePct: number;
  /**
   * Anchor history in chronological order. Starts at purchase, then each manual
   * override (`transfer_out_wallet` tx) resets the anchor to the curve-projected
   * value plus the signed override amount.
   */
  anchors: PropertyAnchor[];
}

/**
 * Day-by-day appreciated value of all property accounts for a user, in base.
 *
 * We do not rely on `Balances` rows for properties: they are sparse and a forward-
 * fill from those snapshots would flatten the appreciation curve across the whole
 * range. Instead, we rebuild the anchor chain from purchase plus the property's
 * revaluation transactions and evaluate the same `computePropertyValue` curve for
 * each requested date.
 */
export const calculatePropertiesBalanceHistory = async ({
  userId,
  maxDate,
  uniqueDates,
  userBaseCurrencyPromise,
}: {
  userId: number;
  maxDate: string;
  uniqueDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
}): Promise<Map<string, number> | null> => {
  const [userBaseCurrency, properties] = await Promise.all([
    userBaseCurrencyPromise,
    Properties.findAll({
      where: { userId },
      include: [{ model: Accounts, as: 'account', attributes: ['id', 'currencyCode', 'excludeFromStats'] }],
    }),
  ]);

  if (!userBaseCurrency?.currencyCode || properties.length === 0) {
    return null;
  }

  const activeProperties = properties.filter((property) => property.account && !property.account.excludeFromStats);

  if (activeProperties.length === 0) {
    return null;
  }

  const accountIds = activeProperties.map((property) => property.accountId);

  // Revaluation txs are applied to the property account as balance adjustments, so
  // the value series needs their override chain to reconstruct effective anchors.
  const overrideTxs = await findTransactions({
    planned: 'exclude',
    access: { accountOwner: userId },
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet] },
    completeness: 'all',
    where: {
      accountId: { [Op.in]: accountIds },
      time: { [Op.lte]: endOfDay(parseISO(maxDate)) },
    },
    order: [
      ['accountId', 'ASC'],
      ['time', 'ASC'],
      ['createdAt', 'ASC'],
    ],
    attributes: ['accountId', 'time', 'amount', 'transactionType'],
  });

  const txsByAccount = new Map<string, Transactions[]>();
  for (const tx of overrideTxs) {
    const list = txsByAccount.get(tx.accountId);
    if (list) list.push(tx);
    else txsByAccount.set(tx.accountId, [tx]);
  }

  const propertyComputes: PropertyCompute[] = activeProperties.map((property) => {
    const compute: PropertyCompute = {
      id: property.id,
      accountId: property.accountId,
      accountCurrencyCode: property.account.currencyCode,
      purchaseDate: property.purchaseDate,
      annualRatePct: Number(property.annualAppreciationRatePct),
      anchors: [{ date: property.purchaseDate, valueCents: property.purchasePrice.toCents() }],
    };

    const txs = txsByAccount.get(property.accountId) ?? [];
    for (const tx of txs) {
      const txDateStr = formatDate(tx.time);
      const lastAnchor = compute.anchors[compute.anchors.length - 1]!;

      const preTxValue = computePropertyValue({
        anchorValue: Money.fromCents(lastAnchor.valueCents),
        anchorDate: parseISO(lastAnchor.date),
        asOf: parseISO(txDateStr),
        annualRatePct: compute.annualRatePct,
      });

      const signedAmountCents =
        tx.transactionType === TRANSACTION_TYPES.income ? tx.amount.toCents() : -tx.amount.toCents();
      const newAnchorCents = preTxValue.toCents() + signedAmountCents;

      compute.anchors.push({ date: txDateStr, valueCents: newAnchorCents });
    }

    return compute;
  });

  const minRangeDate = uniqueDates[0] ?? maxDate;
  const dataFetchMinDate = format(subDays(parseISO(minRangeDate), 7), 'yyyy-MM-dd');

  const propertyCurrencyCodes = [...new Set(propertyComputes.map((property) => property.accountCurrencyCode))];
  const usdRateQuoteCodes = [...new Set([userBaseCurrency.currencyCode, ...propertyCurrencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  type ExchangeRateRow = Pick<UserExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate'>;

  const [userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: { [Op.in]: propertyCurrencyCodes },
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
  for (const rate of userCustomExchangeRates) {
    userRatesMap.set(`${rate.baseCode}_${formatDate(rate.date)}`, rate.rate);
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

  const propertyValuesByDate = new Map<string, number>();
  for (const dateStr of uniqueDates) {
    let totalInBaseCents = 0;
    for (const property of propertyComputes) {
      const valueInAccountCents = propertyValueAtDate(property, dateStr);
      if (valueInAccountCents === 0) continue;
      const rate = getExchangeRate(property.accountCurrencyCode, dateStr);
      totalInBaseCents += Math.round(valueInAccountCents * rate);
    }
    propertyValuesByDate.set(dateStr, totalInBaseCents);
  }

  if (missingRateCurrencies.size > 0) {
    logger.warn('Property history exchange rate fallback to 1:1', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(missingRateCurrencies),
      dateRange: { from: minRangeDate, to: maxDate },
    });
  }

  return propertyValuesByDate;
};
