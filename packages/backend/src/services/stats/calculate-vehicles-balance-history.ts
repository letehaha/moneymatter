import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import ExchangeRates from '@models/exchange-rates.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import Vehicles from '@models/vehicles.model';
import { API_LAYER_BASE_CURRENCY_CODE } from '@services/exchange-rates/constants';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import {
  createFindLatestUsdRate,
  createGetExchangeRate,
} from '@services/stats/get-combined-balance-history/exchange-rate-lookup';
import { computeVehicleValue } from '@services/vehicles/compute-vehicle-value';
import { endOfDay, format, parseISO, startOfDay, subDays } from 'date-fns';
import { Op } from 'sequelize';

const formatDate = (date: Date | string): string => format(date, 'yyyy-MM-dd');

const vehicleValueAtDate = (vehicle: VehicleCompute, dateStr: string): number => {
  if (vehicle.purchaseDate > dateStr) return 0;

  let activeAnchor = vehicle.anchors[0]!;
  for (const anchor of vehicle.anchors) {
    if (anchor.date <= dateStr) activeAnchor = anchor;
    else break;
  }

  const value = computeVehicleValue({
    anchorValue: Money.fromMinorUnits({ value: activeAnchor.valueMinor, decimals: vehicle.accountDecimals }),
    anchorDate: parseISO(activeAnchor.date),
    asOf: parseISO(dateStr),
    vehicleClass: vehicle.vehicleClass,
    preset: vehicle.preset,
    customAnnualRatePct: vehicle.customAnnualRatePct,
    salvageFloorPct: vehicle.salvageFloorPct,
  });

  return value.toMinorUnits({ decimals: vehicle.accountDecimals });
};

interface VehicleAnchor {
  /** yyyy-MM-dd. Either purchaseDate or an override tx date. */
  date: string;
  /** Vehicle value at the anchor moment, in minor units at the account currency's decimals. */
  valueMinor: number;
}

interface VehicleCompute {
  id: string;
  accountId: string;
  accountCurrencyCode: string;
  /** Decimals of the account currency: the scale of every anchor and per-day value of this vehicle. */
  accountDecimals: number;
  purchaseDate: string;
  vehicleClass: Vehicles['vehicleClass'];
  preset: Vehicles['depreciationPreset'];
  customAnnualRatePct: number | null;
  salvageFloorPct: number;
  /**
   * Anchor history in chronological order. First entry is always the purchase
   * (purchaseDate, purchasePrice). Subsequent entries are manual overrides
   * (transfer_out_wallet txs), each with the post-override value reconstructed
   * from the previous anchor plus the signed tx amount.
   */
  anchors: VehicleAnchor[];
}

/**
 * Day-by-day depreciated value of all vehicle accounts for a user, in minor units of the base currency.
 *
 * Why we don't read `Balances` for vehicles: those rows are sparse — written
 * only on vehicle create, on manual override, and on the 7-day lazy refresh.
 * Filling forward from those snapshots makes the chart show a flat vehicle
 * value across the entire range. Instead, we recompute the depreciation curve
 * for each chart date using the same pure function the live read path uses.
 *
 * Anchor handling mirrors what `refresh-vehicle-value.service` does at write
 * time: start from (purchaseDate, purchasePrice), then each manual override
 * (`transfer_out_wallet` tx on the vehicle's account) resets the anchor to
 * (tx.time, depreciated_value_at_tx + signed_tx_amount). For dates before a
 * vehicle's purchase, it contributes 0 — it didn't exist in net worth yet.
 */
export const calculateVehiclesBalanceHistory = async ({
  userId,
  maxDate,
  uniqueDates,
  userBaseCurrencyPromise,
  decimals,
}: {
  userId: number;
  maxDate: string;
  uniqueDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
  /** Decimals of the base currency: the scale of the returned per-day values. */
  decimals: number;
}): Promise<Map<string, number> | null> => {
  const [userBaseCurrency, vehicles] = await Promise.all([
    userBaseCurrencyPromise,
    Vehicles.findAll({
      where: { userId },
      include: [{ model: Accounts, attributes: ['id', 'currencyCode', 'excludeFromStats'] }],
    }),
  ]);

  if (!userBaseCurrency?.currencyCode || vehicles.length === 0) {
    return null;
  }

  const activeVehicles = vehicles.filter((v) => v.account && !v.account.excludeFromStats);

  if (activeVehicles.length === 0) {
    return null;
  }

  const accountIds = activeVehicles.map((v) => v.accountId);

  // Overrides are written by the balance-adjustment flow, which stamps them as adjustments —
  // excluding those (the boundary's default) would erase every anchor after the purchase.
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

  // A custom code's decimals are per user and the owner's definition governs every native amount.
  const decimalsByCurrency = new Map(
    await Promise.all(
      [...new Set(activeVehicles.map((v) => v.account.currencyCode))].map(
        async (code) => [code, await getCurrencyDecimals({ userId, code })] as const,
      ),
    ),
  );

  const vehicleComputes: VehicleCompute[] = activeVehicles.map((vehicle) => {
    const accountDecimals = decimalsByCurrency.get(vehicle.account.currencyCode)!;
    const compute: VehicleCompute = {
      id: vehicle.id,
      accountId: vehicle.accountId,
      accountCurrencyCode: vehicle.account.currencyCode,
      accountDecimals,
      purchaseDate: vehicle.purchaseDate,
      vehicleClass: vehicle.vehicleClass,
      preset: vehicle.depreciationPreset,
      customAnnualRatePct: vehicle.customAnnualRatePct ? Number(vehicle.customAnnualRatePct) : null,
      salvageFloorPct: Number(vehicle.salvageFloorPct),
      anchors: [
        { date: vehicle.purchaseDate, valueMinor: vehicle.purchasePrice.toMinorUnits({ decimals: accountDecimals }) },
      ],
    };

    const txs = txsByAccount.get(vehicle.accountId) ?? [];
    for (const tx of txs) {
      const txDateStr = formatDate(tx.time);
      const lastAnchor = compute.anchors[compute.anchors.length - 1]!;

      const preTxValue = computeVehicleValue({
        anchorValue: Money.fromMinorUnits({ value: lastAnchor.valueMinor, decimals: accountDecimals }),
        anchorDate: parseISO(lastAnchor.date),
        asOf: parseISO(txDateStr),
        vehicleClass: compute.vehicleClass,
        preset: compute.preset,
        customAnnualRatePct: compute.customAnnualRatePct,
        salvageFloorPct: compute.salvageFloorPct,
      });

      const txMinor = tx.amount.toMinorUnits({ decimals: accountDecimals });
      const signedTxMinor = tx.transactionType === TRANSACTION_TYPES.income ? txMinor : -txMinor;
      const newAnchorMinor = preTxValue.toMinorUnits({ decimals: accountDecimals }) + signedTxMinor;

      compute.anchors.push({ date: txDateStr, valueMinor: newAnchorMinor });
    }

    return compute;
  });

  const minRangeDate = uniqueDates[0] ?? maxDate;
  const dataFetchMinDate = format(subDays(parseISO(minRangeDate), 7), 'yyyy-MM-dd');

  const vehicleCurrencyCodes = [...new Set(vehicleComputes.map((v) => v.accountCurrencyCode))];
  const usdRateQuoteCodes = [...new Set([userBaseCurrency.currencyCode, ...vehicleCurrencyCodes])].filter(
    (code) => code !== API_LAYER_BASE_CURRENCY_CODE,
  );

  type ExchangeRateRow = Pick<UserExchangeRates, 'baseCode' | 'quoteCode' | 'date' | 'rate'>;

  const [userCustomExchangeRates, systemExchangeRates] = await Promise.all([
    UserExchangeRates.findAll({
      where: {
        userId,
        baseCode: { [Op.in]: vehicleCurrencyCodes },
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

  const vehicleValuesByDate = new Map<string, number>();
  for (const dateStr of uniqueDates) {
    let totalInBaseMinor = 0;
    for (const vehicle of vehicleComputes) {
      const valueInAccountMinor = vehicleValueAtDate(vehicle, dateStr);
      if (valueInAccountMinor === 0) continue;
      const rate = getExchangeRate(vehicle.accountCurrencyCode, dateStr);
      // The rate converts whole units; the factor re-expresses the account's minor units in the base's.
      const scale = 10 ** (decimals - vehicle.accountDecimals);
      totalInBaseMinor += Math.round(valueInAccountMinor * rate * scale);
    }
    vehicleValuesByDate.set(dateStr, totalInBaseMinor);
  }

  if (missingRateCurrencies.size > 0) {
    logger.warn('Vehicle history exchange rate fallback to 1:1', {
      userId,
      baseCurrency: userBaseCurrency.currencyCode,
      currencies: Array.from(missingRateCurrencies),
      dateRange: { from: minRangeDate, to: maxDate },
    });
  }

  return vehicleValuesByDate;
};
