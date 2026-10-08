import type { PivotRow, PivotMeasure, SavedPivotViewConfig } from '@bt/shared/types';

/**
 * Pure derivation helpers for the Pivot Report grid. Kept free of Vue/reactivity
 * so they can be unit-tested in isolation (see `pivot-derivations.spec.ts`).
 *
 * NOTES:
 * - Heatmap intensity, column maxima and sort magnitude use `Math.abs`, so the
 *   grid renders identically whether the backend expresses an expense measure as
 *   a positive magnitude or a signed negative. Displayed cell text keeps the raw
 *   signed value so a category that nets negative after refunds still reads so.
 * - Delta is a magnitude ratio (change in absolute size vs the previous column),
 *   which makes "good/bad" coloring independent of the amount sign convention.
 */

export type PivotSortDirection = 'asc' | 'desc';

/** A grid column is addressed by its time-bucket key, or the synthetic 'total' column. */
export const TOTAL_COLUMN_KEY = 'total';

// Neutral heatmap: the cell background is `--foreground` (the theme's text color)
// at a low opacity, so intensity reads as a monochrome light/dark wash that never
// competes with the numbers. A neutral tone saturates visually much faster than a
// hue, so the ceiling stays well below 1 — the heaviest cell tops out at ~0.28.
export const HEATMAP_MIN_ALPHA = 0.03;
export const HEATMAP_ALPHA_RANGE = 0.25;

/** Amount in a given column for a row; the synthetic 'total' column reads `row.total`. */
export const getRowValue = ({ row, columnKey }: { row: PivotRow; columnKey: string }): number => {
  if (columnKey === TOTAL_COLUMN_KEY) return row.total;
  return row.values[columnKey] ?? 0;
};

/** Largest absolute amount in a column across top-level rows (children excluded to
 * avoid a child out-shading its parent). Used to normalise heatmap intensity. */
export const computeColumnMax = ({ rows, columnKey }: { rows: PivotRow[]; columnKey: string }): number => {
  let max = 0;
  for (const row of rows) {
    if (row.kind === 'child') continue;
    const magnitude = Math.abs(getRowValue({ row, columnKey }));
    if (magnitude > max) max = magnitude;
  }
  return max;
};

/** Heatmap alpha in [0, HEATMAP_MIN_ALPHA + HEATMAP_ALPHA_RANGE]. Returns 0 for
 * empty cells / empty columns so they stay fully transparent. */
export const heatmapAlpha = ({ value, columnMax }: { value: number; columnMax: number }): number => {
  if (columnMax <= 0) return 0;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return 0;
  return HEATMAP_MIN_ALPHA + HEATMAP_ALPHA_RANGE * Math.min(magnitude / columnMax, 1);
};

/** Magnitude change vs the previous column as a ratio; `null` when there is no
 * comparable previous value (first column, or previous magnitude is 0). */
export const computeDelta = ({
  current,
  previous,
}: {
  current: number;
  previous: number | undefined;
}): number | null => {
  if (previous === undefined) return null;
  const prevMagnitude = Math.abs(previous);
  if (prevMagnitude === 0) return null;
  return (Math.abs(current) - prevMagnitude) / prevMagnitude;
};

/** A "good" delta shrinks spending (expense measure) or grows income. */
export const isDeltaGood = ({ delta, measure }: { delta: number; measure: PivotMeasure }): boolean => {
  if (delta === 0) return false;
  return measure === 'expense' ? delta < 0 : delta > 0;
};

/** Sort rows by a column's magnitude while keeping subcategory children grouped
 * directly under their (sorted) parent. */
export const sortPivotRows = ({
  rows,
  columnKey,
  direction,
}: {
  rows: PivotRow[];
  columnKey: string;
  direction: PivotSortDirection;
}): PivotRow[] => {
  const compare = (a: PivotRow, b: PivotRow): number => {
    const av = Math.abs(getRowValue({ row: a, columnKey }));
    const bv = Math.abs(getRowValue({ row: b, columnKey }));
    return direction === 'asc' ? av - bv : bv - av;
  };

  const topLevel = rows.filter((row) => row.kind !== 'child');
  const childrenByParent = new Map<string, PivotRow[]>();
  for (const row of rows) {
    if (row.kind === 'child' && row.parentId) {
      const list = childrenByParent.get(row.parentId) ?? [];
      list.push(row);
      childrenByParent.set(row.parentId, list);
    }
  }

  const result: PivotRow[] = [];
  for (const parent of [...topLevel].sort(compare)) {
    result.push(parent);
    const children = childrenByParent.get(parent.id);
    if (children) result.push(...[...children].sort(compare));
  }
  return result;
};

/** Rows minus the children whose parent is collapsed; collapsed parents stay
 * visible, their subcategory children are hidden until the parent is expanded. */
export const computeVisibleRows = ({ rows, collapsed }: { rows: PivotRow[]; collapsed: Set<string> }): PivotRow[] =>
  rows.filter((row) => !(row.kind === 'child' && row.parentId && collapsed.has(row.parentId)));

/** True when there is at least one parent row and every parent is collapsed —
 * drives the collapse-all / expand-all toggle state. */
export const computeAllCollapsed = ({ rows, collapsed }: { rows: PivotRow[]; collapsed: Set<string> }): boolean => {
  const parentIds = rows.filter((row) => row.kind === 'parent').map((row) => row.id);
  return parentIds.length > 0 && parentIds.every((id) => collapsed.has(id));
};

const sameStringSet = ({ a, b }: { a?: string[]; b?: string[] }): boolean => {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

/** Deep-equality for two saved-view configs (order-insensitive on the id arrays). */
export const arePivotConfigsEqual = ({ a, b }: { a: SavedPivotViewConfig; b: SavedPivotViewConfig }): boolean =>
  a.rowDimension === b.rowDimension &&
  a.granularity === b.granularity &&
  a.measure === b.measure &&
  a.from === b.from &&
  a.to === b.to &&
  a.heatmap === b.heatmap &&
  a.showDelta === b.showDelta &&
  sameStringSet({ a: a.accountIds, b: b.accountIds }) &&
  sameStringSet({ a: a.categoryIds, b: b.categoryIds }) &&
  sameStringSet({ a: a.payeeIds, b: b.payeeIds });

/** Id of the first saved view whose config matches the current one, else `null`
 * (drives the "Custom view" label when the live config diverges). */
export const findMatchingViewId = ({
  config,
  views,
}: {
  config: SavedPivotViewConfig;
  views: { id: string; config: SavedPivotViewConfig }[];
}): string | null => views.find((view) => arePivotConfigsEqual({ a: view.config, b: config }))?.id ?? null;
