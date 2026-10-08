import type { PivotColumn, PivotRow } from '@bt/shared/types';
import { AccessibleCategoryInfo } from '@services/categories/get-accessible-category-map.service';

// Synthetic residual-row ids/labels (rows for transactions without the grouping dimension).
export const UNCATEGORIZED_ID = 'uncategorized';
const UNCATEGORIZED_LABEL = 'Uncategorized';
export const UNASSIGNED_ID = 'unassigned';
export const UNASSIGNED_LABEL = 'Unassigned';
export const UNTAGGED_ID = 'untagged';
export const UNTAGGED_LABEL = 'Untagged';
// Shown for a payee row whose payee no longer resolves to a name (deleted, or a foreign payee
// outside the user's set). Backend emits the literal; the frontend renders it verbatim.
export const UNKNOWN_PAYEE_LABEL = 'Unknown payee';
// Fallback color for the uncategorized bucket / a category that fell out of the accessible map.
const FALLBACK_COLOR = '#000000';

type PivotRowKind = PivotRow['kind'];

/**
 * A single pivot row, still in integer cents. The serializer converts every amount to an API
 * decimal. `values` only contains columns with a non-zero net amount (frontend defaults
 * missing columns to 0).
 */
export interface PivotReportRowCents {
  id: string;
  label: string;
  color: string | null;
  // Only populated for the payee dimension (via hydratePayeeLabels); null = payee has no logo.
  logoDomain?: string | null;
  // Monogram letters + '#rrggbb' background, same payee-only population as logoDomain.
  logoInitials?: string | null;
  logoColor?: string | null;
  parentId: string | null;
  kind: PivotRowKind;
  values: Record<string, number>;
  total: number;
}

/**
 * Cents-domain result of `getPivotReport`. Structurally mirrors `GetPivotReportResponse` but
 * every monetary field is integer cents.
 */
export interface PivotReportResultCents {
  columns: PivotColumn[];
  rows: PivotReportRowCents[];
  columnTotals: Record<string, number>;
  grandTotal: number;
  currencyCode: string;
}

/** Label + color for a row, derived per dimension. */
interface RowMeta {
  label: string;
  color: string | null;
}

// Collapse a column map into an emit-only-nonzero values object plus the full (including-zero)
// row total. Missing columns are treated as 0 by the client.
const finalizePivotValues = (columns: Map<string, number>): { values: Record<string, number>; total: number } => {
  const values: Record<string, number> = {};
  let total = 0;
  for (const [columnKey, cents] of columns) {
    total += cents;
    if (cents !== 0) values[columnKey] = cents;
  }
  return { values, total };
};

const mergeColumns = ({ target, source }: { target: Map<string, number>; source: Map<string, number> }): void => {
  for (const [columnKey, cents] of source) target.set(columnKey, (target.get(columnKey) ?? 0) + cents);
};

/** Label + color for a category row key (a root/exact category id, or the uncategorized bucket). */
export const resolveCategoryMeta = ({
  categoryId,
  categoryMap,
}: {
  categoryId: string;
  categoryMap: Map<string, AccessibleCategoryInfo>;
}): RowMeta => {
  if (categoryId === UNCATEGORIZED_ID) return { label: UNCATEGORIZED_LABEL, color: FALLBACK_COLOR };
  const cat = categoryMap.get(categoryId);
  return { label: cat?.name ?? UNCATEGORIZED_LABEL, color: cat?.color ?? FALLBACK_COLOR };
};

/**
 * One row per key: drops keys that net to nothing, resolves each row's label/color via the
 * dimension-supplied `resolveMeta`, and sorts by total descending.
 */
export const assembleFlatRows = ({
  cellData,
  resolveMeta,
}: {
  cellData: Map<string, Map<string, number>>;
  resolveMeta: (rowKey: string) => RowMeta;
}): PivotReportRowCents[] => {
  const flatRows: PivotReportRowCents[] = [];
  for (const [rowKey, columns] of cellData) {
    const { values, total } = finalizePivotValues(columns);
    if (Object.keys(values).length === 0) continue;

    const { label, color } = resolveMeta(rowKey);
    flatRows.push({ id: rowKey, label, color, parentId: null, kind: 'flat', values, total });
  }
  flatRows.sort((a, b) => b.total - a.total);
  return flatRows;
};

/**
 * Builds the 2-level subcategory tree. Amounts are aggregated at the exact categoryId, then
 * grouped by root: a root with descendant data becomes a `parent` row (values rolled up over
 * its own direct amount + all descendants) followed by one `child` row per descendant; a root
 * with no descendant data collapses to a single `flat` row.
 */
export const assembleSubcategoryRows = ({
  cellData,
  categoryMap,
  getRootCategoryId,
}: {
  cellData: Map<string, Map<string, number>>;
  categoryMap: Map<string, AccessibleCategoryInfo>;
  getRootCategoryId: (categoryId: string) => string;
}): PivotReportRowCents[] => {
  interface RootGroup {
    own: Map<string, number>;
    children: { id: string; columns: Map<string, number> }[];
  }
  const rootGroups = new Map<string, RootGroup>();
  const getGroup = (rootId: string): RootGroup => {
    let group = rootGroups.get(rootId);
    if (!group) {
      group = { own: new Map<string, number>(), children: [] };
      rootGroups.set(rootId, group);
    }
    return group;
  };

  for (const [exactId, columns] of cellData) {
    if (exactId === UNCATEGORIZED_ID) {
      mergeColumns({ target: getGroup(UNCATEGORIZED_ID).own, source: columns });
      continue;
    }
    const rootId = getRootCategoryId(exactId);
    const group = getGroup(rootId);
    if (exactId === rootId) {
      mergeColumns({ target: group.own, source: columns });
    } else {
      group.children.push({ id: exactId, columns });
    }
  }

  interface AssembledGroup {
    parent: PivotReportRowCents;
    children: PivotReportRowCents[];
  }
  const assembled: AssembledGroup[] = [];

  for (const [rootId, group] of rootGroups) {
    const childRows = group.children
      .map((child): { row: PivotReportRowCents; hasData: boolean } => {
        const { values, total } = finalizePivotValues(child.columns);
        const { label, color } = resolveCategoryMeta({ categoryId: child.id, categoryMap });
        return {
          row: { id: child.id, label, color, parentId: rootId, kind: 'child', values, total },
          hasData: Object.keys(values).length > 0,
        };
      })
      .filter((entry) => entry.hasData)
      .map((entry) => entry.row);

    const rollup = new Map<string, number>();
    mergeColumns({ target: rollup, source: group.own });
    for (const child of group.children) mergeColumns({ target: rollup, source: child.columns });
    const rollupFinal = finalizePivotValues(rollup);

    if (Object.keys(rollupFinal.values).length === 0) continue; // fully empty (e.g. net-zero)

    const { label, color } = resolveCategoryMeta({ categoryId: rootId, categoryMap });

    if (childRows.length === 0) {
      assembled.push({
        parent: {
          id: rootId,
          label,
          color,
          parentId: null,
          kind: 'flat',
          values: rollupFinal.values,
          total: rollupFinal.total,
        },
        children: [],
      });
    } else {
      childRows.sort((a, b) => b.total - a.total);
      assembled.push({
        parent: {
          id: rootId,
          label,
          color,
          parentId: null,
          kind: 'parent',
          values: rollupFinal.values,
          total: rollupFinal.total,
        },
        children: childRows,
      });
    }
  }

  assembled.sort((a, b) => b.parent.total - a.parent.total);

  const rows: PivotReportRowCents[] = [];
  for (const group of assembled) {
    rows.push(group.parent);
    rows.push(...group.children);
  }
  return rows;
};
