import {
  type PivotColumn,
  type PivotGranularity,
  type PivotMeasure,
  type PivotRowDimension,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { getBaseCurrency } from '@models/users-currencies.model';
import { createRootCategoryResolver, expandCategoryIdsWithDescendants } from '@services/categories/category-hierarchy';
import {
  AccessibleCategoryInfo,
  getAccessibleCategoryMap,
} from '@services/categories/get-accessible-category-map.service';
import { statsTransactions } from '@services/stats/stats-transactions';
import { format } from 'date-fns';
import { Op } from 'sequelize';

import { findBucketIndex } from '../utils';
import { generatePivotBuckets, getBucketKey, getBucketLabel } from './buckets';
import { getPivotStrategy } from './dimensions';
import type { PivotReportResultCents, PivotReportRowCents } from './rows';

export type { PivotReportResultCents } from './rows';

interface GetPivotReportParams {
  userId: number;
  from: string;
  to: string;
  granularity: PivotGranularity;
  rowDimension: PivotRowDimension;
  measure: PivotMeasure;
  accountIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
}

/**
 * Cross-tabs a row dimension (category / subcategory / payee / tag) against a time dimension,
 * summing `refAmount` (base currency) into integer cents. Split transactions are distributed and
 * refunds are netted (cash-basis, in the bucket the money returned in) across every dimension —
 * a refunded amount never counts as spend regardless of how the report is grouped. Netting is
 * skipped for `measure === 'income'` (an income report's "refund" leg is itself the income).
 *
 * Per-dimension aggregation, assembly and hydration live behind a `PivotDimensionStrategy`
 * (see `./dimensions`); this orchestrator only owns the shared query, bucketing and totals.
 */
export const getPivotReport = async ({
  userId,
  from,
  to,
  granularity,
  rowDimension,
  measure,
  accountIds,
  categoryIds,
  payeeIds,
}: GetPivotReportParams): Promise<PivotReportResultCents> => {
  const buckets = generatePivotBuckets({ from, to, granularity });
  const columnKeys = buckets.map((bucket) => getBucketKey({ periodStart: bucket.periodStart, granularity }));

  const { categories: allCategories, byId } = await getAccessibleCategoryMap({ userId });
  // Row keys are plain strings (category ids + synthetic buckets like 'uncategorized'), so look
  // categories up by string. The underlying keys are still branded RecordIds.
  const categoryMap: Map<string, AccessibleCategoryInfo> = byId;
  const getRootCategoryId = createRootCategoryResolver({ byId: categoryMap });

  // Expand a categoryIds filter to include every descendant, so selecting a parent category also
  // matches transactions filed directly under its subcategories.
  let expandedCategoryIds: string[] | undefined;
  if (categoryIds && categoryIds.length > 0) {
    expandedCategoryIds = expandCategoryIdsWithDescendants({
      categoryIds,
      categories: allCategories,
      byId: categoryMap,
    });
  }

  const strategy = getPivotStrategy({ rowDimension });

  // The report is money that moved, so planned rows are out with no way to opt back in.
  // Refunds are netted per dimension by the strategies, not by the read model.
  const { rows: transactions } = await statsTransactions({
    access: { accessibleTo: userId },
    planned: 'exclude',
    refunds: 'ignore',
    window: { from, to },
    where: {
      transactionType: measure === 'income' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
      ...(accountIds && accountIds.length > 0 ? { accountId: { [Op.in]: accountIds } } : {}),
      ...(payeeIds && payeeIds.length > 0 ? { payeeId: { [Op.in]: payeeIds } } : {}),
      ...(expandedCategoryIds && expandedCategoryIds.length > 0
        ? { categoryId: { [Op.in]: expandedCategoryIds } }
        : {}),
    },
    include: strategy.buildInclude(),
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'payeeId', 'accountId', 'refundLinked'],
  });

  // rowKey -> (columnKey -> cents). Filled by the dimension strategy.
  const cellData = new Map<string, Map<string, number>>();
  const addCell = ({ rowKey, columnKey, cents }: { rowKey: string; columnKey: string; cents: number }): void => {
    let columns = cellData.get(rowKey);
    if (!columns) {
      columns = new Map<string, number>();
      cellData.set(rowKey, columns);
    }
    columns.set(columnKey, (columns.get(columnKey) ?? 0) + cents);
  };

  const bucketIndexForTime = (time: Date): number => findBucketIndex({ transactionTime: time, buckets });

  await strategy.aggregate({
    transactions,
    columnKeys,
    bucketIndexForTime,
    categoryMap,
    getRootCategoryId,
    measure,
    cellData,
    addCell,
  });

  const rows: PivotReportRowCents[] = strategy.assembleRows({ cellData, categoryMap, getRootCategoryId });

  // Column totals sum only top-level rows (parents already roll up their children) to avoid
  // double counting.
  const columnTotals: Record<string, number> = {};
  for (const columnKey of columnKeys) columnTotals[columnKey] = 0;
  for (const row of rows) {
    if (row.kind === 'child') continue;
    for (const [columnKey, cents] of Object.entries(row.values)) {
      columnTotals[columnKey] = (columnTotals[columnKey] ?? 0) + cents;
    }
  }
  let grandTotal = 0;
  for (const columnKey of columnKeys) grandTotal += columnTotals[columnKey]!;

  const columns: PivotColumn[] = buckets.map((bucket, index) => ({
    key: columnKeys[index]!,
    periodStart: format(bucket.periodStart, 'yyyy-MM-dd'),
    periodEnd: format(bucket.periodEnd, 'yyyy-MM-dd'),
    label: getBucketLabel({ periodStart: bucket.periodStart, granularity }),
  }));

  // Every user has a base currency, so this normally resolves; the empty-string fallback is a
  // defensive last resort the client already guards against (it never invents a wrong currency).
  const baseCurrency = (await getBaseCurrency({ userId }))?.currencyCode ?? '';

  if (strategy.hydrate) await strategy.hydrate({ userId, rows });

  return { columns, rows, columnTotals, grandTotal, currencyCode: baseCurrency };
};
