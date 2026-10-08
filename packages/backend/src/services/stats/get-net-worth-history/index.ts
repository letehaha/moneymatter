import {
  ACCOUNT_CATEGORIES,
  type Cents,
  MAX_NET_WORTH_HISTORY_BUCKETS,
  type NetWorthHistoryDegraded,
  type NetWorthHistoryGranularity,
  type NetWorthHistoryUnpricedSecurity,
  asCents,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { calculateVehiclesBalanceHistory } from '@services/stats/calculate-vehicles-balance-history';
import { calculateVentureBalanceHistory } from '@services/stats/calculate-venture-balance-history';
import { getPerAccountBalanceHistory } from '@services/stats/get-balance-history';
import { getCreditLimitCentsByAccount } from '@services/stats/get-credit-limit-adjustment';
import { generatePeriodBuckets } from '@services/stats/utils';
import { format } from 'date-fns';
import { Op } from 'sequelize';

import { buildDenseDateRange } from '../get-net-worth-drivers/date-range';
import { assembleNetWorthPoint } from './assemble-point';
import { calculatePortfolioValueByDate } from './portfolio-value';
import type { NetWorthHistoryResultCents } from './types';

export type { NetWorthHistoryResultCents } from './types';

// `getPerAccountBalanceHistory` keys each day by `format(new Date(dateStr), 'yyyy-MM-dd')`
// — a `yyyy-MM-dd` string parsed as UTC midnight, then re-formatted in server-local time.
// Snapshot calendar strings must pass through the identical transform to line up under a
// negative-offset server timezone; without it the lookup shifts a calendar day and every
// account partition silently reads as zero.
const toAccountsDateKey = (dayStr: string): string => format(new Date(dayStr), 'yyyy-MM-dd');

/**
 * Balance at each snapshot date for one account partition. A missing snapshot key
 * on a NON-empty history is a key-derivation bug, not a zero balance —
 * every account series fills every day in its range — so it fails loud
 * instead of letting `?? 0` silently drop the partition. An empty history (no
 * accounts in the partition) is a real zero.
 */
const buildPartitionResolver = ({
  history,
  partition,
  userId,
}: {
  history: { date: string; amount: number }[];
  partition: string;
  userId: number;
}): ((snapshotDate: string) => Cents) => {
  const centsByDate = new Map(history.map((item) => [item.date, asCents(item.amount)]));

  return (snapshotDate: string): Cents => {
    const cents = centsByDate.get(toAccountsDateKey(snapshotDate));
    if (cents !== undefined) return cents;
    if (history.length === 0) return asCents(0);

    logger.error('Net-worth history: balance partition missing a snapshot day', {
      userId,
      partition,
      snapshotDate,
      accountsDateKey: toAccountsDateKey(snapshotDate),
    });
    throw new UnexpectedError({
      message: `Net-worth history: ${partition} balance history is missing a snapshot day.`,
    });
  };
};

/**
 * Split one per-account balance series at a snapshot date by balance sign, after
 * netting each balance against the account's credit limit (absent when the
 * setting is off): accounts currently owing (negative) sum into `owedCents`,
 * accounts holding the user's own funds (positive) into `surplusCents`. Used for every account class
 * that can sit on either side of zero — cards, overdrafts and plain deposit
 * accounts alike — so an overdrawn account counts as debt, not a negative asset.
 * A missing snapshot key on a present account is a key-derivation bug — the series
 * fills every day of its range — so it fails loud rather than zeroing the account.
 */
const splitSeriesBySign = ({
  series,
  snapshotDate,
  partition,
  userId,
  creditLimitCentsByAccount,
}: {
  series: Record<string, Record<string, number>>;
  snapshotDate: string;
  partition: string;
  userId: number;
  creditLimitCentsByAccount: Map<string, Cents>;
}): { owedCents: Cents; surplusCents: Cents } => {
  const dateKey = toAccountsDateKey(snapshotDate);
  let owed = 0;
  let surplus = 0;

  for (const [accountId, rawCentsByDate] of Object.entries(series)) {
    const rawCents = rawCentsByDate[dateKey];
    if (rawCents === undefined) {
      logger.error('Net-worth history: per-account series missing a snapshot day', {
        userId,
        partition,
        accountId,
        snapshotDate,
        accountsDateKey: dateKey,
      });
      throw new UnexpectedError({
        message: `Net-worth history: ${partition} account series is missing a snapshot day.`,
      });
    }
    const cents = rawCents - (creditLimitCentsByAccount.get(accountId) ?? 0);
    if (cents < 0) owed += cents;
    else surplus += cents;
  }

  return { owedCents: asCents(owed), surplusCents: asCents(surplus) };
};

/**
 * Value for one non-account asset class (vehicles, portfolios, ventures) at a
 * snapshot date. `map` is null when the user has nothing in that asset class —
 * a real zero. When `map` is present but missing `dateStr`, that's a
 * key-derivation bug — the calculator fills every requested date — so it fails
 * loud instead of letting `?? 0` silently drop the asset class.
 */
const readAssetValue = <T extends number>({
  map,
  dateStr,
  label,
  userId,
}: {
  map: Map<string, T> | null;
  dateStr: string;
  label: string;
  userId: number;
}): number => {
  if (map === null) return 0;

  const value = map.get(dateStr);
  if (value !== undefined) return value;

  logger.error('Net-worth history: asset value map missing a snapshot day', { userId, label, dateStr });
  throw new UnexpectedError({
    message: `Net-worth history: ${label} value map is missing a snapshot day.`,
  });
};

/**
 * Assemble the `degraded` payload from the portfolio valuation's two independent
 * data-quality failures, or `undefined` when neither fired. The wire contract
 * forbids an empty object: a truthiness check on `degraded` alone decides whether
 * the client renders a warning, so each inner field is set only when non-empty and
 * the whole object is dropped when both are.
 */
const buildDegraded = ({
  unpricedSecurities,
  fxFallbackCurrencies,
}: {
  unpricedSecurities: NetWorthHistoryUnpricedSecurity[];
  fxFallbackCurrencies: string[];
}): NetWorthHistoryDegraded | undefined => {
  const degraded: NetWorthHistoryDegraded = {};
  if (unpricedSecurities.length > 0) degraded.unpricedSecurities = unpricedSecurities;
  if (fxFallbackCurrencies.length > 0) degraded.fxFallbackCurrencies = fxFallbackCurrencies;

  return degraded.unpricedSecurities || degraded.fxFallbackCurrencies ? degraded : undefined;
};

/**
 * Assets/liabilities/net-worth series: one end-of-bucket balance snapshot per
 * granularity bucket over [from, to], the last bucket clamped to `to`. Assets =
 * every non-liability account plus portfolios (holdings + uninvested cash),
 * ventures and vehicles. Every account that can cross zero — cards, overdrafts
 * and plain deposit accounts — is classified per account by balance sign at each
 * snapshot: an owing (negative) balance sums into a liability kind, while a
 * positive balance counts as assets. An overdrawn deposit account has no liability
 * category of its own, so its owed balance joins the overdraft kind. Loans are
 * always liabilities at their whole signed value. All amounts are base-currency
 * cents; the serializer converts to decimals.
 *
 * `includeCreditLimit` means a stored balance on an account with a limit embeds
 * that limit. Subtract it per account before the sign split, or undrawn credit
 * counts as cash.
 */
export const getNetWorthHistory = async ({
  userId,
  from,
  to,
  granularity,
  includeCreditLimit = false,
}: {
  userId: number;
  from: string;
  to: string;
  granularity: NetWorthHistoryGranularity;
  includeCreditLimit?: boolean;
}): Promise<NetWorthHistoryResultCents> => {
  // Weekly buckets follow ISO weeks (Monday start) — the shared spec every stats
  // report uses, so week edges line up across the analytics pages.
  const buckets = generatePeriodBuckets({ from, to, granularity });

  if (buckets.length === 0) {
    return { points: [] };
  }

  // Past this cap the chart is unreadable anyway and a fine-grained all-time range
  // would price holdings on thousands of days — the client should pick a coarser
  // granularity instead.
  if (buckets.length > MAX_NET_WORTH_HISTORY_BUCKETS) {
    throw new ValidationError({
      message: t({ key: 'stats.netWorthHistoryTooManyPoints' }),
      details: { maxPoints: MAX_NET_WORTH_HISTORY_BUCKETS, requestedPoints: buckets.length },
    });
  }

  // Holdings are valued on these days only (the boundary-dates optimization) —
  // never per calendar day, which is what keeps an all-time range affordable.
  const snapshotDates = buckets.map((bucket) => format(bucket.periodEnd, 'yyyy-MM-dd'));
  // The portfolio cash replay only adds deltas landing exactly on a listed day,
  // so it gets every day between the first and last snapshot.
  const denseDates = buildDenseDateRange({ boundaryDates: snapshotDates });

  const minDate = snapshotDates[0]!;
  const maxDate = snapshotDates[snapshotDates.length - 1]!;

  // The account partitions span the full requested range, not just the snapshot
  // span: a Balances row dated between `from` and the first bucket end must anchor
  // the first snapshot instead of letting a later row back-fill over it.
  const accountsRange = { from, to: maxDate };

  // One read transaction pins a single Postgres connection across the fan-out
  // below, rather than each branch checking out its own and a burst of report
  // loads draining the pool.
  const [
    { accountSeries, categoryByAccount },
    vehicleValuesByDate,
    portfolioValuation,
    ventureValuesByDate,
    creditLimitCentsByAccount,
  ] = await withTransaction(async () => {
    // Shared by every sub-calculator that converts to base currency — fetch once.
    const userBaseCurrencyPromise = UsersCurrencies.findOne({
      where: { userId, isDefaultCurrency: true },
      raw: true,
      attributes: ['currencyCode'],
    }) as Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;

    return Promise.all([
      // One per-account series for every non-vehicle account, split by category
      // after the fetch. Fill and back-fill are decided per account, so splitting
      // afterwards yields the same numbers as one filtered read per partition.
      // Vehicles enter assets through their own depreciation series below.
      (async () => {
        const accounts = await Accounts.findAll({
          where: { userId, excludeFromStats: false, accountCategory: { [Op.ne]: ACCOUNT_CATEGORIES.vehicle } },
          attributes: ['id', 'accountCategory', 'refInitialBalance'],
        });
        // Back-fill each loan's pre-anchor days from its opening balance
        // (`refInitialBalance`, immutable on payment) so a payoff dated on the
        // anchor day can't retroactively rewrite the loan balance on earlier days.
        const openingCentsByAccount = new Map(
          accounts
            .filter((a) => a.accountCategory === ACCOUNT_CATEGORIES.loan)
            .map((a) => [a.id, a.refInitialBalance.toCents()]),
        );

        const series = await getPerAccountBalanceHistory({
          userId,
          accountScope: 'owned',
          ...accountsRange,
          categoryFilter: { exclude: [ACCOUNT_CATEGORIES.vehicle] },
          openingCentsByAccount,
        });

        return {
          accountSeries: series,
          categoryByAccount: new Map(accounts.map((a) => [a.id as string, a.accountCategory])),
        };
      })(),
      calculateVehiclesBalanceHistory({ userId, maxDate, uniqueDates: snapshotDates, userBaseCurrencyPromise }),
      calculatePortfolioValueByDate({ userId, snapshotDates, denseDates, userBaseCurrencyPromise }),
      calculateVentureBalanceHistory({ userId, minDate, maxDate, uniqueDates: snapshotDates, userBaseCurrencyPromise }),
      includeCreditLimit ? getCreditLimitCentsByAccount({ userId, accountScope: 'owned' }) : new Map<string, Cents>(),
    ]);
  })();

  // Per-account (not pre-summed) so the sign split is per account: one account
  // owing −500 and another holding +300 on the same day land on opposite sides.
  // An account missing from the category map (created between the two reads)
  // counts as an asset account rather than being dropped.
  const assetAccountsSeries: Record<string, Record<string, number>> = {};
  const creditCardSeries: Record<string, Record<string, number>> = {};
  const overdraftSeries: Record<string, Record<string, number>> = {};
  const loanCentsByDate = new Map<string, number>();

  for (const [accountId, centsByDate] of Object.entries(accountSeries)) {
    const category = categoryByAccount.get(accountId);
    if (category === ACCOUNT_CATEGORIES.creditCard) {
      creditCardSeries[accountId] = centsByDate;
    } else if (category === ACCOUNT_CATEGORIES.overdraft) {
      overdraftSeries[accountId] = centsByDate;
    } else if (category === ACCOUNT_CATEGORIES.loan) {
      for (const [date, cents] of Object.entries(centsByDate)) {
        loanCentsByDate.set(date, (loanCentsByDate.get(date) ?? 0) + cents);
      }
    } else {
      assetAccountsSeries[accountId] = centsByDate;
    }
  }

  const loanHistory = Array.from(loanCentsByDate, ([date, amount]) => ({ date, amount }));

  const resolveLoan = buildPartitionResolver({ history: loanHistory, partition: ACCOUNT_CATEGORIES.loan, userId });

  // A user with no data still gets one all-zero point per bucket — the chart
  // renders a flat zero line for the requested range rather than an empty state.
  // The per-account sign split, loan resolution and asset-class valuation happen
  // here (they need the fetched series); the folding into kinds is `assembleNetWorthPoint`.
  const points = snapshotDates.map((dateStr) =>
    assembleNetWorthPoint({
      date: dateStr,
      assetAccounts: splitSeriesBySign({
        series: assetAccountsSeries,
        snapshotDate: dateStr,
        partition: 'asset-accounts',
        userId,
        creditLimitCentsByAccount,
      }),
      creditCard: splitSeriesBySign({
        series: creditCardSeries,
        snapshotDate: dateStr,
        partition: ACCOUNT_CATEGORIES.creditCard,
        userId,
        creditLimitCentsByAccount,
      }),
      overdraft: splitSeriesBySign({
        series: overdraftSeries,
        snapshotDate: dateStr,
        partition: ACCOUNT_CATEGORIES.overdraft,
        userId,
        creditLimitCentsByAccount,
      }),
      loanCents: resolveLoan(dateStr),
      portfolioCents: asCents(
        readAssetValue({ map: portfolioValuation.valuesByDate, dateStr, label: 'portfolio', userId }),
      ),
      vehicleCents: asCents(readAssetValue({ map: vehicleValuesByDate, dateStr, label: 'vehicle', userId })),
      ventureCents: asCents(readAssetValue({ map: ventureValuesByDate, dateStr, label: 'venture', userId })),
    }),
  );

  return {
    points,
    degraded: buildDegraded({
      unpricedSecurities: portfolioValuation.unpricedSecurities,
      fxFallbackCurrencies: portfolioValuation.fxFallbackCurrencies,
    }),
  };
};
