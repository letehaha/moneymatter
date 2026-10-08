import type { PivotMeasure, PivotRowDimension } from '@bt/shared/types';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import Transactions from '@models/transactions.model';
import { AccessibleCategoryInfo } from '@services/categories/get-accessible-category-map.service';
import { Includeable, Op } from 'sequelize';

import { computeCategoryAllocations } from '../category-allocation';
import { resolveWholeTxRefunds } from './refunds';
import {
  PivotReportRowCents,
  UNASSIGNED_ID,
  UNASSIGNED_LABEL,
  UNKNOWN_PAYEE_LABEL,
  UNCATEGORIZED_ID,
  UNTAGGED_ID,
  UNTAGGED_LABEL,
  assembleFlatRows,
  assembleSubcategoryRows,
  resolveCategoryMeta,
} from './rows';

/** Everything a dimension needs to fold the loaded transactions into cells. */
interface PivotAggregateContext {
  transactions: Transactions[];
  columnKeys: string[];
  bucketIndexForTime: (time: Date) => number;
  categoryMap: Map<string, AccessibleCategoryInfo>;
  getRootCategoryId: (categoryId: string) => string;
  measure: PivotMeasure;
  cellData: Map<string, Map<string, number>>;
  addCell: (args: { rowKey: string; columnKey: string; cents: number }) => void;
}

interface PivotAssembleContext {
  cellData: Map<string, Map<string, number>>;
  categoryMap: Map<string, AccessibleCategoryInfo>;
  getRootCategoryId: (categoryId: string) => string;
}

/**
 * A pivot row dimension. `aggregate` fills `cellData` (base spend, then any refund netting);
 * `assembleRows` turns those cells into rows; `hydrate` optionally patches rows post-assembly
 * (payee names/logos). `buildInclude` adds any dimension-specific eager loads to the tx query.
 */
interface PivotDimensionStrategy {
  buildInclude(): Includeable[];
  aggregate(ctx: PivotAggregateContext): Promise<void>;
  assembleRows(ctx: PivotAssembleContext): PivotReportRowCents[];
  hydrate?(ctx: { userId: number; rows: PivotReportRowCents[] }): Promise<void>;
}

/**
 * Category / subcategory: split-aware, refund-netting spend routed through the shared
 * category-allocation engine. `category` rolls each leg up to its root; `subcategory` keeps the
 * exact category and builds a 2-level parent/child tree at assembly time.
 */
const createCategoryStrategy = ({
  rowDimension,
}: {
  rowDimension: 'category' | 'subcategory';
}): PivotDimensionStrategy => ({
  buildInclude: () => [],
  aggregate: async (ctx) => {
    const resolveRowKey = (categoryId: string | null): string => {
      if (!categoryId) return UNCATEGORIZED_ID;
      return rowDimension === 'category' ? ctx.getRootCategoryId(categoryId) : categoryId;
    };

    const allocations = await computeCategoryAllocations({
      transactions: ctx.transactions,
      applyRefunds: ctx.measure === 'expense',
    });

    for (const leg of allocations.base) {
      const bucketIndex = ctx.bucketIndexForTime(leg.time);
      if (bucketIndex === -1) continue;
      ctx.addCell({ rowKey: resolveRowKey(leg.categoryId), columnKey: ctx.columnKeys[bucketIndex]!, cents: leg.cents });
    }

    // Refunds net only where the (grouped) category already received spend in range, so a refund
    // whose original expense fell outside the window/filter never spawns a phantom negative row.
    for (const leg of allocations.refunds) {
      const rowKey = resolveRowKey(leg.categoryId);
      if (!ctx.cellData.has(rowKey)) continue;
      const bucketIndex = ctx.bucketIndexForTime(leg.time);
      if (bucketIndex === -1) continue;
      ctx.addCell({ rowKey, columnKey: ctx.columnKeys[bucketIndex]!, cents: leg.cents });
    }
  },
  assembleRows: (ctx) => {
    if (rowDimension === 'subcategory') {
      return assembleSubcategoryRows({
        cellData: ctx.cellData,
        categoryMap: ctx.categoryMap,
        getRootCategoryId: ctx.getRootCategoryId,
      });
    }
    return assembleFlatRows({
      cellData: ctx.cellData,
      resolveMeta: (rowKey) => resolveCategoryMeta({ categoryId: rowKey, categoryMap: ctx.categoryMap }),
    });
  },
});

/**
 * Payee: one row per payee (null payee → Unassigned). Refunds net against the original expense's
 * payee. Names/logos are hydrated in bulk after assembly (they live on the Payees table).
 */
const createPayeeStrategy = (): PivotDimensionStrategy => ({
  buildInclude: () => [],
  aggregate: async (ctx) => {
    for (const tx of ctx.transactions) {
      const bucketIndex = ctx.bucketIndexForTime(new Date(tx.time));
      if (bucketIndex === -1) continue;
      const rowKey = tx.payeeId ?? UNASSIGNED_ID;
      ctx.addCell({ rowKey, columnKey: ctx.columnKeys[bucketIndex]!, cents: tx.refAmount.toCents() });
    }

    if (ctx.measure !== 'expense') return;
    const refunds = await resolveWholeTxRefunds({ transactions: ctx.transactions, needTags: false });
    for (const refund of refunds) {
      const rowKey = refund.payeeId ?? UNASSIGNED_ID;
      if (!ctx.cellData.has(rowKey)) continue;
      const refundBucket = ctx.bucketIndexForTime(refund.refundTime);
      if (refundBucket === -1) continue;
      ctx.addCell({ rowKey, columnKey: ctx.columnKeys[refundBucket]!, cents: -refund.refundCents });
    }
  },
  assembleRows: (ctx) =>
    assembleFlatRows({
      cellData: ctx.cellData,
      // The real name is patched in by `hydrate`; until then a placeholder keeps a row from ever
      // surfacing the raw payee id if the lookup can't resolve it.
      resolveMeta: (rowKey) =>
        rowKey === UNASSIGNED_ID
          ? { label: UNASSIGNED_LABEL, color: null }
          : { label: UNKNOWN_PAYEE_LABEL, color: null },
    }),
  hydrate: async ({ userId, rows }) => {
    const payeeIds = rows.filter((row) => row.id !== UNASSIGNED_ID).map((row) => row.id);
    if (payeeIds.length === 0) return;

    const payees = await Payees.findAll({
      where: { userId, id: { [Op.in]: payeeIds } },
      attributes: ['id', 'name', 'logoDomain', 'logoInitials', 'logoColor'],
      raw: true,
    });
    const payeeById = new Map<string, (typeof payees)[number]>(payees.map((payee) => [payee.id, payee]));

    for (const row of rows) {
      if (row.id === UNASSIGNED_ID) continue;
      const payee = payeeById.get(row.id);
      // A payee id with no matching row means the payee was deleted or belongs to another user;
      // fall back to an explicit label rather than leaking the raw uuid to the client.
      row.label = payee?.name ?? UNKNOWN_PAYEE_LABEL;
      row.logoDomain = payee?.logoDomain ?? null;
      row.logoInitials = payee?.logoInitials ?? null;
      row.logoColor = payee?.logoColor ?? null;
    }
  },
});

/**
 * Tag: a transaction fans out into every one of its tags (double counting across tags is
 * expected); tagless transactions land in the Untagged bucket. Refunds fan the reduction out
 * across the original expense's tags the same way.
 */
const createTagStrategy = (): PivotDimensionStrategy => {
  // Name/color travel on the tag include; captured here for assembly.
  const tagMeta = new Map<string, { name: string; color: string }>();

  return {
    buildInclude: () => [
      { model: Tags, through: { attributes: [] }, attributes: ['id', 'name', 'color'], required: false },
    ],
    aggregate: async (ctx) => {
      for (const tx of ctx.transactions) {
        const bucketIndex = ctx.bucketIndexForTime(new Date(tx.time));
        if (bucketIndex === -1) continue;
        const columnKey = ctx.columnKeys[bucketIndex]!;
        const txTags = tx.tags ?? [];
        if (txTags.length === 0) {
          ctx.addCell({ rowKey: UNTAGGED_ID, columnKey, cents: tx.refAmount.toCents() });
        } else {
          for (const tag of txTags) {
            if (!tagMeta.has(tag.id)) tagMeta.set(tag.id, { name: tag.name, color: tag.color });
            ctx.addCell({ rowKey: tag.id, columnKey, cents: tx.refAmount.toCents() });
          }
        }
      }

      if (ctx.measure !== 'expense') return;
      const refunds = await resolveWholeTxRefunds({ transactions: ctx.transactions, needTags: true });
      for (const refund of refunds) {
        const refundBucket = ctx.bucketIndexForTime(refund.refundTime);
        if (refundBucket === -1) continue;
        const columnKey = ctx.columnKeys[refundBucket]!;
        const targets = refund.tagIds.length === 0 ? [UNTAGGED_ID] : refund.tagIds;
        for (const rowKey of targets) {
          if (!ctx.cellData.has(rowKey)) continue;
          ctx.addCell({ rowKey, columnKey, cents: -refund.refundCents });
        }
      }
    },
    assembleRows: (ctx) =>
      assembleFlatRows({
        cellData: ctx.cellData,
        resolveMeta: (rowKey) => {
          if (rowKey === UNTAGGED_ID) return { label: UNTAGGED_LABEL, color: null };
          const meta = tagMeta.get(rowKey);
          return { label: meta?.name ?? rowKey, color: meta?.color ?? null };
        },
      }),
  };
};

export const getPivotStrategy = ({ rowDimension }: { rowDimension: PivotRowDimension }): PivotDimensionStrategy => {
  switch (rowDimension) {
    case 'category':
    case 'subcategory':
      return createCategoryStrategy({ rowDimension });
    case 'payee':
      return createPayeeStrategy();
    case 'tag':
      return createTagStrategy();
  }
};
