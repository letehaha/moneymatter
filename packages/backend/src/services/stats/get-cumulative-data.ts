import {
  type CumulativeMetric,
  type CumulativeMonthData,
  type CumulativePeriodData,
  type GetCumulativeResponse,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { expandCategoryIdsWithDescendants } from '@services/categories/category-hierarchy';
import { getAccessibleCategoryMap } from '@services/categories/get-accessible-category-map.service';
import { type StatsScopeFilters, buildStatsScopeWhere } from '@services/stats/stats-scope-filters';
import { statsTransactions } from '@services/stats/stats-transactions';
import {
  addMonths,
  differenceInMonths,
  endOfMonth,
  format,
  getMonth,
  getYear,
  isBefore,
  isEqual,
  parseISO,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { Op } from 'sequelize';

interface GetCumulativeDataParams extends StatsScopeFilters {
  userId: number;
  from: string;
  to: string;
  metric: CumulativeMetric;
  categoryIds?: string[];
  /** Expanded to descendants before the query, so hiding a parent hides its children. */
  excludedCategoryIds?: string[];
}

/** Both category id lists are already expanded to descendants. */
interface PeriodDataParams extends Omit<GetCumulativeDataParams, 'categoryIds' | 'excludedCategoryIds'> {
  includeCategoryIds?: string[];
  excludeCategoryIds?: string[];
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Fetches cumulative data for a date range, calculating running totals per month.
 * Returns data for both the requested period and the immediately preceding period for comparison.
 * (Period-over-Period comparison: e.g., Aug-Oct compared to May-Jul)
 */
export const getCumulativeData = async ({
  userId,
  from,
  to,
  metric,
  accountId,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
  categoryIds,
  excludedCategoryIds,
}: GetCumulativeDataParams): Promise<GetCumulativeResponse> => {
  // Use parseISO for consistent date parsing (treats dates as local time, not UTC)
  const fromDate = parseISO(from);
  const toDate = parseISO(to);

  // Calculate period length in months (add 1 because both ends are inclusive)
  const periodLengthMonths = differenceInMonths(startOfMonth(toDate), startOfMonth(fromDate)) + 1;

  // Calculate the immediately preceding period of the same length
  // e.g., if selected Aug-Oct (3 months), previous period is May-Jul (3 months before)
  const prevFromDate = subMonths(fromDate, periodLengthMonths);
  const prevToDate = subMonths(toDate, periodLengthMonths);
  const prevFrom = format(prevFromDate, 'yyyy-MM-dd');
  const prevTo = format(prevToDate, 'yyyy-MM-dd');

  let includeCategoryIds: string[] | undefined;
  let excludeCategoryIds: string[] | undefined;

  if (categoryIds?.length || excludedCategoryIds?.length) {
    const { categories, byId } = await getAccessibleCategoryMap({ userId });

    if (categoryIds?.length) {
      includeCategoryIds = expandCategoryIdsWithDescendants({ categoryIds, categories, byId });
    }
    if (excludedCategoryIds?.length) {
      excludeCategoryIds = expandCategoryIdsWithDescendants({ categoryIds: excludedCategoryIds, categories, byId });
    }
  }

  const scope = {
    accountId,
    accountIds,
    payeeIds,
    excludedPayeeIds,
    tagIds,
    excludedTagIds,
    includeCategoryIds,
    excludeCategoryIds,
  };

  const currentPeriodData = await getPeriodData({ userId, from, to, metric, ...scope });

  const previousPeriodData = await getPeriodData({ userId, from: prevFrom, to: prevTo, metric, ...scope });

  // Calculate period-over-period percent change
  let percentChange = 0;
  if (previousPeriodData.total !== 0) {
    percentChange = Math.round(
      ((currentPeriodData.total - previousPeriodData.total) / Math.abs(previousPeriodData.total)) * 100,
    );
  } else if (currentPeriodData.total > 0) {
    percentChange = 100;
  } else if (currentPeriodData.total < 0) {
    percentChange = -100;
  }

  return {
    currentPeriod: currentPeriodData,
    previousPeriod: previousPeriodData,
    percentChange,
  };
};

async function getPeriodData({
  userId,
  from,
  to,
  metric,
  accountId,
  accountIds,
  payeeIds,
  excludedPayeeIds,
  tagIds,
  excludedTagIds,
  includeCategoryIds,
  excludeCategoryIds,
}: PeriodDataParams): Promise<CumulativePeriodData> {
  // Use parseISO for consistent date parsing (treats dates as local time, not UTC)
  const fromDate = parseISO(from);
  const toDate = parseISO(to);
  const now = new Date();

  // Limit 'to' date to current month if it's in the future
  const effectiveToDate = toDate > now ? endOfMonth(now) : toDate;
  const effectiveTo = format(effectiveToDate, 'yyyy-MM-dd');

  // Both directions are always loaded, whatever the metric: a refund pairs an expense with an
  // income, and netting one side needs the other side in scope.
  const { rows: transactions, refundPairs } = await statsTransactions({
    access: { accessibleTo: userId },
    planned: 'exclude',
    refunds: 'net',
    window: { from, to: effectiveTo },
    // ponytail: query-level category filter ignores split legs; route through computeCategoryAllocations if totals must match cash-flow exactly
    where: {
      [Op.and]: [
        { transactionType: { [Op.in]: [TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense] } },
        ...(includeCategoryIds?.length ? [{ categoryId: { [Op.in]: includeCategoryIds } }] : []),
        ...(excludeCategoryIds?.length
          ? [{ [Op.or]: [{ categoryId: null }, { categoryId: { [Op.notIn]: excludeCategoryIds } }] }]
          : []),
        ...buildStatsScopeWhere({ accountId, accountIds, payeeIds, excludedPayeeIds, tagIds, excludedTagIds }),
      ],
    },
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'refundLinked'],
  });

  // Build a map of year-month to aggregate values
  const monthlyDataMap = new Map<string, { income: number; expenses: number }>();

  // Aggregate transactions into months
  for (const tx of transactions) {
    const txTime = new Date(tx.time);
    const monthKey = `${getYear(txTime)}-${getMonth(txTime)}`; // year-monthIndex (0-11)

    if (!monthlyDataMap.has(monthKey)) {
      monthlyDataMap.set(monthKey, { income: 0, expenses: 0 });
    }

    const monthEntry = monthlyDataMap.get(monthKey)!;

    if (tx.transactionType === TRANSACTION_TYPES.income) {
      monthEntry.income += tx.refAmount.toCents();
    } else if (tx.transactionType === TRANSACTION_TYPES.expense) {
      monthEntry.expenses += Math.abs(tx.refAmount.toCents());
    }
  }

  // Refunded money was neither spent nor earned: both halves leave in the month the money came
  // back, which keeps the savings metric (income - expenses) untouched. A pair with only one half
  // in scope stays gross — subtracting it alone would remove money the report never counted.
  for (const pair of refundPairs) {
    if (!pair.expenseInScope || !pair.incomeInScope) continue;

    const refundTime = new Date(pair.time);
    const monthEntry = monthlyDataMap.get(`${getYear(refundTime)}-${getMonth(refundTime)}`);
    if (!monthEntry) continue;

    monthEntry.income -= pair.cents;
    monthEntry.expenses -= pair.cents;
  }

  // Build cumulative data based on metric
  const data: CumulativeMonthData[] = [];
  let cumulativeValue = 0;

  // Iterate through each month in the range using date-fns for safe date iteration
  let currentMonth = startOfMonth(fromDate);
  const lastMonth = startOfMonth(effectiveToDate);
  const nowMonth = startOfMonth(now);
  let monthCounter = 1;

  while (isBefore(currentMonth, lastMonth) || isEqual(currentMonth, lastMonth)) {
    // Don't include months in the future
    if (isBefore(nowMonth, currentMonth)) {
      break;
    }

    const monthKey = `${getYear(currentMonth)}-${getMonth(currentMonth)}`;
    const monthData = monthlyDataMap.get(monthKey) || { income: 0, expenses: 0 };
    // getMonth() returns 0-11, which always maps to a valid MONTH_LABELS index
    const monthLabel = MONTH_LABELS[getMonth(currentMonth)]!;

    let periodValue = 0;

    switch (metric) {
      case 'income':
        periodValue = monthData.income;
        break;
      case 'expenses':
        periodValue = monthData.expenses;
        break;
      case 'savings':
        periodValue = monthData.income - monthData.expenses;
        break;
    }

    cumulativeValue += periodValue;

    data.push({
      month: monthCounter,
      monthLabel,
      value: cumulativeValue,
      periodValue,
    });

    // Move to next month using date-fns (safe, no mutation)
    currentMonth = addMonths(currentMonth, 1);
    monthCounter++;
  }

  // Use the year from the 'from' date as the period identifier
  return {
    year: getYear(fromDate),
    data,
    total: cumulativeValue,
  };
}
