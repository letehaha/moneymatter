import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import * as Accounts from '@models/accounts.model';
import * as Balances from '@models/balances.model';
import { connection } from '@models/connection';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';
import { format } from 'date-fns';
import { Op, QueryTypes, WhereOptions } from 'sequelize';

import { getWhereConditionForTime } from './utils';

interface AccountCategoryFilter {
  /** Exclude these categories from the result. Mutually exclusive with `only`. */
  exclude?: ACCOUNT_CATEGORIES[];
  /** Include only these categories. Mutually exclusive with `exclude`. */
  only?: ACCOUNT_CATEGORIES[];
}

/**
 * Balance row fetched without model hydration — a deliberate exception to the
 * "no raw on Money queries" rule: Balances has one row per account per day,
 * so per-row Sequelize instances + Money objects dominate dashboard-load memory.
 * `amount` is cents (BIGINT; the global INT8 parser in models/index.ts yields
 * JS numbers). Money is constructed only at the public `getBalanceHistory` boundary.
 */
interface BalanceHistoryRow {
  date: string | Date;
  amount: number;
  accountId: string;
}

/**
 * The account set a balance read runs over. Every caller states it and there is no default,
 * because the two answer different questions and the wrong one is a wrong number rather than
 * an error.
 *
 * - `'accessible'` — the caller's own accounts plus those shared with them. What the balance
 *   surfaces report, since the account list and the transaction list already show them.
 * - `'owned'` — the caller's own accounts only. What the net-worth surfaces measure: a shared
 *   account is someone else's asset, and the portfolio, vehicle and venture components of net
 *   worth are owner-scoped regardless, so mixing the two would put two scopes on one chart.
 */
export type AccountScope = 'accessible' | 'owned';

interface AccountSelection {
  /** Narrows the `owned` scope to these accounts. */
  accountIds?: string[];
  /** Keeps accounts flagged `excludeFromStats`, for reads about specific accounts rather than totals. */
  ignoreExcludeFromStats?: boolean;
}

async function buildAccountWhere({
  userId,
  accountScope,
  categoryFilter,
  accountIds,
  ignoreExcludeFromStats = false,
}: {
  userId: number;
  accountScope: AccountScope;
  categoryFilter?: AccountCategoryFilter;
} & AccountSelection): Promise<WhereOptions> {
  const where: Record<string, unknown> =
    accountScope === 'accessible'
      ? { id: { [Op.in]: await getAccessibleAccountIdsForUser({ userId }) } }
      : { userId, ...(accountIds && { id: { [Op.in]: accountIds } }) };
  if (!ignoreExcludeFromStats) where.excludeFromStats = false;
  if (categoryFilter?.only?.length) {
    where.accountCategory = { [Op.in]: categoryFilter.only };
  } else if (categoryFilter?.exclude?.length) {
    where.accountCategory = { [Op.notIn]: categoryFilter.exclude };
  }
  return where;
}

/**
 * Day key of every balance series here. A 'yyyy-MM-dd' string parses as UTC midnight, so under a
 * negative-offset server timezone the key is the previous calendar day; look days up through it.
 */
export function toBalanceDateKey(date: string | Date): string {
  return format(new Date(date), 'yyyy-MM-dd');
}

/**
 * Fetches the balance rows for the accounts named by `accountScope` within a specified date
 * range.
 * An account with no row dated on "from" also gets its latest earlier balance as a row
 * dated "from". An account with no row in the range and none before "from" gets its
 * earliest balance after "to" instead, dated "from" (or "to" when "from" is absent).
 */
const getBalanceHistoryRows = async ({
  userId,
  accountScope,
  from,
  to,
  categoryFilter,
  accountIds,
  ignoreExcludeFromStats,
}: {
  userId: number;
  accountScope: AccountScope;
  from?: string;
  to?: string;
  categoryFilter?: AccountCategoryFilter;
} & AccountSelection): Promise<BalanceHistoryRow[]> => {
  const dataAttributes = ['date', 'amount', 'accountId'];
  const accountWhere = await buildAccountWhere({
    userId,
    accountScope,
    categoryFilter,
    accountIds,
    ignoreExcludeFromStats,
  });

  const [allUserAccounts, balancesInRange] = await Promise.all([
    Accounts.default.findAll({
      where: accountWhere,
      attributes: ['id'],
    }),
    Balances.default.findAll({
      where: getWhereConditionForTime({ from, to, columnName: 'date' }),
      // `accountId` as secondary sort to make ties deterministic across query
      // plans. Without it, Postgres returns same-date rows in whatever order
      // the chosen access path produces (heap order under a seq scan, index
      // order under the `(accountId, date)` unique index), which differs
      // between environments and across schema changes.
      order: [
        ['date', 'ASC'],
        ['accountId', 'ASC'],
      ],
      include: [
        {
          model: Accounts.default,
          where: accountWhere,
          attributes: [],
        },
      ],
      attributes: dataAttributes,
      raw: true,
    }) as unknown as Promise<BalanceHistoryRow[]>,
  ]);

  let data = balancesInRange;
  const allAccountIds = allUserAccounts.map((acc) => acc.id);

  const accountIdsWithRecordsInRange = new Set(balancesInRange.map((b) => b.accountId));
  const accountIdsWithNoRecords = allAccountIds.filter((id) => !accountIdsWithRecordsInRange.has(id));

  // Balances rows are sparse, so an account without a row on `from` is seeded there with its
  // latest pre-range balance; unseeded, its first in-range value would back-fill earlier days.
  // `toBalanceDateKey(from)` is the day the range query's lower bound resolves to.
  if ((from && allAccountIds.length) || (accountIdsWithNoRecords.length && to)) {
    const [latestBalancesBeforeFrom, balancesAfterTo] = await Promise.all([
      from && allAccountIds.length
        ? (connection.sequelize.query(
            `
            SELECT DISTINCT ON (b."accountId") b."accountId", b."amount"
              FROM "Balances" b
             WHERE b."accountId" IN (:accountIds)
               AND b."date" < :from
               AND NOT EXISTS (
                 SELECT 1 FROM "Balances" on_from
                  WHERE on_from."accountId" = b."accountId" AND on_from."date" = :from
               )
             ORDER BY b."accountId", b."date" DESC
            `,
            { type: QueryTypes.SELECT, replacements: { accountIds: allAccountIds, from: toBalanceDateKey(from) } },
          ) as Promise<Pick<BalanceHistoryRow, 'accountId' | 'amount'>[]>)
        : Promise.resolve<Pick<BalanceHistoryRow, 'accountId' | 'amount'>[]>([]),
      to && accountIdsWithNoRecords.length
        ? (Balances.default.findAll({
            where: {
              accountId: { [Op.in]: accountIdsWithNoRecords },
              date: { [Op.gt]: new Date(to) },
            },
            attributes: dataAttributes,
            raw: true,
          }) as unknown as Promise<BalanceHistoryRow[]>)
        : Promise.resolve<BalanceHistoryRow[]>([]),
    ]);

    const afterByAccount = new Map<string, BalanceHistoryRow[]>();
    for (const b of balancesAfterTo) {
      const items = afterByAccount.get(b.accountId);
      if (items) {
        items.push(b);
      } else {
        afterByAccount.set(b.accountId, [b]);
      }
    }

    for (const items of afterByAccount.values()) {
      items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    const overrideDate = new Date(from ?? to ?? new Date());
    const latestBalances: BalanceHistoryRow[] = latestBalancesBeforeFrom.map((b) => ({ ...b, date: overrideDate }));
    const seededAccountIds = new Set(latestBalancesBeforeFrom.map((b) => b.accountId));

    // Accounts with no in-range and no pre-range row take their earliest post-range balance.
    for (const accountId of accountIdsWithNoRecords) {
      if (seededAccountIds.has(accountId)) continue;

      const afterBalances = afterByAccount.get(accountId);
      if (afterBalances && afterBalances.length > 0) {
        const b = afterBalances[0]!;
        latestBalances.push({
          accountId: b.accountId,
          amount: b.amount,
          date: overrideDate,
        });
      }
    }

    // Combine results — same `(date, accountId)` order as the main query so
    // the merged stream stays deterministic.
    data = [...data, ...latestBalances].toSorted((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.accountId.localeCompare(b.accountId);
    });
  }

  return data;
};

/**
 * Retrieves the balances for all the accounts for a user within a specified date range.
 * Accounts without a record on "from" are seeded there — see `getBalanceHistoryRows`.
 *
 * @param {Object} params - The parameters for fetching balances.
 * @param {number} params.userId - The ID of the user for whom balances are to be fetched.
 * @param {AccountScope} params.accountScope - Account set the read runs over — see `AccountScope`.
 * @param {string} [params.from] - The start date (inclusive) of the date range in 'yyyy-mm-dd' format.
 * @param {string} [params.to] - The end date (inclusive) of the date range in 'yyyy-mm-dd' format.
 * @returns {Promise<Balances.default[]>} - A promise that resolves to an array of balance records.
 * @throws {Error} - Throws an error if the database query fails.
 *
 * @example
 * const balances = await getBalanceHistory({ userId: 1, accountScope: 'accessible', from: '2023-01-01', to: '2023-12-31' });
 */
export const getBalanceHistory = async ({
  userId,
  accountScope,
  from,
  to,
  categoryFilter,
}: {
  userId: number;
  accountScope: AccountScope;
  from?: string;
  to?: string;
  categoryFilter?: AccountCategoryFilter;
}): Promise<Balances.default[]> => {
  const rows = await getBalanceHistoryRows({ userId, accountScope, from, to, categoryFilter });

  // Plain objects (not Sequelize instances) with Money amounts — consumers
  // (stats serializer, getTotalBalance) only read `date`, `amount`, `accountId`.
  return rows.map(
    (row) =>
      ({
        date: row.date,
        amount: Money.fromCents(row.amount),
        accountId: row.accountId,
      }) as unknown as Balances.default,
  );
};

interface AggregatedBalanceHistoryItem {
  date: string;
  amount: number;
}

interface BalanceFillIndex {
  /** Accounts that carry at least one row, so they get a value on every date. */
  accountIds: Set<string>;
  /** Every date in the requested range, ascending. */
  allDates: string[];
  /** "accountId_date" -> cents, for O(1) lookup of a known value. */
  centsByAccountAndDate: Map<string, number>;
  /** accountId -> earliest row's (date, cents), used for back-fill. */
  earliestRowByAccount: Map<string, { dateStr: string; cents: number }>;
}

/**
 * Builds the shared lookup structures both fills iterate over: the ascending
 * date range and, in a single pass over the rows, an "accountId_date -> cents"
 * map plus each account's earliest row for back-filling prior dates.
 */
function buildBalanceFillIndex({
  data,
  from,
  to,
}: {
  data: BalanceHistoryRow[];
  from?: string;
  to?: string;
}): BalanceFillIndex {
  // Extract unique account IDs and dates from the data.
  const accountIds = new Set(data.map((item) => item.accountId));
  const datesList = new Set(data.map((item) => toBalanceDateKey(item.date)));

  // Determine the earliest and latest dates in the dataset.
  const sortedDates = Array.from(datesList).toSorted();

  // Use requested from/to dates if provided, otherwise use data range
  const firstDate = from ? new Date(from) : new Date(sortedDates[0]!);
  const lastDate = to ? new Date(to) : new Date(sortedDates[sortedDates.length - 1]!);

  // Generate a list of all dates from the earliest to the latest.
  const allDates: string[] = [];
  // oxlint-disable-next-line no-unmodified-loop-condition -- dt is mutated via setDate()
  for (let dt = new Date(firstDate); dt <= lastDate; dt.setDate(dt.getDate() + 1)) {
    allDates.push(toBalanceDateKey(dt));
  }

  const centsByAccountAndDate = new Map<string, number>();
  const earliestRowByAccount = new Map<string, { dateStr: string; cents: number }>();
  for (const item of data) {
    const dateStr = toBalanceDateKey(item.date);
    centsByAccountAndDate.set(`${item.accountId}_${dateStr}`, item.amount);

    const earliest = earliestRowByAccount.get(item.accountId);
    if (!earliest || dateStr < earliest.dateStr) {
      earliestRowByAccount.set(item.accountId, { dateStr, cents: item.amount });
    }
  }

  return { accountIds, allDates, centsByAccountAndDate, earliestRowByAccount };
}

/**
 * The cents an account carries on `date` while forward-filling: the row on that
 * date if present, otherwise the opening/earliest value for dates before the
 * account's first record, otherwise the previous day's carried value.
 *
 * `openingCents` back-fills the dates STRICTLY BEFORE the account's earliest
 * record. Loans pass their `initialBalance` here (the outstanding as-of the
 * anchor date) so a payoff dated on the anchor day — which folds the anchor-day
 * row toward zero — can't retroactively rewrite the outstanding shown on earlier
 * days. `initialBalance` never changes on payment, so pre-anchor days stay
 * stable. The earliest record's own date always keeps its real value.
 */
function carryForwardCents({
  date,
  previousCents,
  earliest,
  actualCents,
  openingCents,
}: {
  date: string;
  previousCents: number;
  earliest: { dateStr: string; cents: number };
  actualCents: number | undefined;
  openingCents: number | undefined;
}): number {
  if (actualCents !== undefined) {
    return actualCents;
  }
  if (date < earliest.dateStr) {
    return openingCents !== undefined ? openingCents : earliest.cents;
  }
  if (date === earliest.dateStr) {
    return earliest.cents;
  }
  // Dates after the earliest record with no row keep the previous day's value.
  return previousCents;
}

/**
 * Gap-fill raw balance rows into a per-account daily series over the range:
 * each account's earliest value back-fills prior dates (or `openingCentsByAccount`
 * when provided), and known values carry forward across dates with no rows.
 * Keyed `accountId → yyyy-MM-dd → cents`. Every account present carries a value
 * for every date in the range.
 */
function fillPerAccountBalanceSeries({
  data,
  from,
  to,
  openingCentsByAccount,
}: {
  data: BalanceHistoryRow[];
  from?: string;
  to?: string;
  openingCentsByAccount?: Map<string, number>;
}): Record<string, Record<string, number>> {
  if (!data || data.length === 0) {
    return {};
  }

  const { accountIds, allDates, centsByAccountAndDate, earliestRowByAccount } = buildBalanceFillIndex({
    data,
    from,
    to,
  });

  const seriesByAccount: Record<string, Record<string, number>> = {};

  for (const accountId of accountIds) {
    const earliest = earliestRowByAccount.get(accountId);
    if (!earliest) continue;

    const openingCents = openingCentsByAccount?.get(accountId);
    let currentCents = 0;
    const series: Record<string, number> = {};

    for (const date of allDates) {
      currentCents = carryForwardCents({
        date,
        previousCents: currentCents,
        earliest,
        actualCents: centsByAccountAndDate.get(`${accountId}_${date}`),
        openingCents,
      });
      series[date] = currentCents;
    }

    seriesByAccount[accountId] = series;
  }

  return seriesByAccount;
}

/**
 * Aggregates balance trend data by filling gaps and summing all accounts per date.
 * Sums each account's forward-filled value straight into a single per-date total,
 * so no per-account day map is ever materialized.
 */
function aggregateBalanceTrendData({
  data,
  from,
  to,
  openingCentsByAccount,
}: {
  data: BalanceHistoryRow[];
  from?: string;
  to?: string;
  openingCentsByAccount?: Map<string, number>;
}): AggregatedBalanceHistoryItem[] {
  if (!data || data.length === 0) {
    return [];
  }

  const { accountIds, allDates, centsByAccountAndDate, earliestRowByAccount } = buildBalanceFillIndex({
    data,
    from,
    to,
  });

  const totalCentsByDate = new Map<string, number>();

  for (const accountId of accountIds) {
    const earliest = earliestRowByAccount.get(accountId);
    if (!earliest) continue;

    const openingCents = openingCentsByAccount?.get(accountId);
    let currentCents = 0;

    for (const date of allDates) {
      currentCents = carryForwardCents({
        date,
        previousCents: currentCents,
        earliest,
        actualCents: centsByAccountAndDate.get(`${accountId}_${date}`),
        openingCents,
      });
      totalCentsByDate.set(date, (totalCentsByDate.get(date) ?? 0) + currentCents);
    }
  }

  // `allDates` is already ascending, so the result is sorted by date.
  return allDates.map((date) => ({
    date,
    amount: totalCentsByDate.get(date) ?? 0,
  }));
}

/**
 * Retrieves aggregated balance history for all user's accounts within a specified date range.
 * This version aggregates all accounts by date and fills gaps, providing the data ready for frontend consumption.
 *
 * @param {Object} params - The parameters for fetching aggregated balances.
 * @param {number} params.userId - The ID of the user for whom balances are to be fetched.
 * @param {AccountScope} params.accountScope - Account set the read runs over — see `AccountScope`.
 * @param {string} [params.from] - The start date (inclusive) of the date range in 'yyyy-mm-dd' format.
 * @param {string} [params.to] - The end date (inclusive) of the date range in 'yyyy-mm-dd' format.
 * @returns {Promise<AggregatedBalanceHistoryItem[]>} - A promise that resolves to an array of aggregated balance records.
 */
export const getAggregatedBalanceHistory = async ({
  userId,
  accountScope,
  from,
  to,
  categoryFilter,
  openingCentsByAccount,
}: {
  userId: number;
  accountScope: AccountScope;
  from: string;
  to: string;
  categoryFilter?: AccountCategoryFilter;
  /**
   * Per-account opening balance (cents) used to back-fill dates before an
   * account's earliest record. Supplied for the loan partition so same-day
   * payoffs can't retroactively move earlier days (see aggregateBalanceTrendData).
   */
  openingCentsByAccount?: Map<string, number>;
}): Promise<AggregatedBalanceHistoryItem[]> => {
  const rawBalanceHistory = await getBalanceHistoryRows({ userId, accountScope, from, to, categoryFilter });

  return aggregateBalanceTrendData({ data: rawBalanceHistory, from, to, openingCentsByAccount });
};

/**
 * Per-account daily balance series over the range, gap-filled with the same
 * carry-forward/back-fill rules as `getAggregatedBalanceHistory` but WITHOUT the
 * cross-account summation. For callers that classify each account individually
 * (e.g. the net-worth history splits credit cards by balance sign per account).
 * Keyed `accountId → yyyy-MM-dd → cents`; empty object when no balance data.
 */
export const getPerAccountBalanceHistory = async ({
  userId,
  accountScope,
  from,
  to,
  categoryFilter,
  openingCentsByAccount,
  accountIds,
  ignoreExcludeFromStats,
}: {
  userId: number;
  accountScope: AccountScope;
  from: string;
  to: string;
  categoryFilter?: AccountCategoryFilter;
  openingCentsByAccount?: Map<string, number>;
} & AccountSelection): Promise<Record<string, Record<string, number>>> => {
  const rawBalanceHistory = await getBalanceHistoryRows({
    userId,
    accountScope,
    from,
    to,
    categoryFilter,
    accountIds,
    ignoreExcludeFromStats,
  });

  return fillPerAccountBalanceSeries({ data: rawBalanceHistory, from, to, openingCentsByAccount });
};
