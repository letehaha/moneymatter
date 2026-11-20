<script setup lang="ts" generic="T">
/**
 * MappingTable — responsive "mapping" table that renders as a CSS-grid table on
 * wide containers and collapses to stacked cards on narrow ones. Built for the
 * CSV-import wizard, where the same row shape is shown across the Map Columns,
 * Resolve Values, and Review steps.
 *
 * Generic over the row item type `T`. Each column declares a `key`; cell content
 * is provided per column through a `cell:{key}` scoped slot, so the table stays
 * presentational and the consumer owns every cell's markup (selects, pills,
 * plain text, etc.). Columns with no matching slot render an empty cell.
 *
 * Responsiveness is container-query driven (NOT viewport): the root is a named
 * container `@container/mapping-table`, and the grid↔card switch happens at the
 * `GRID_BREAKPOINT` below. The content area is narrower than the screen (sidebar),
 * so this reacts to the table's own width, never the window.
 *
 * In card mode, columns flagged `cardHeader` collapse onto a single header line
 * (status icon + title) instead of each taking its own stacked block — keeps the
 * cards short. Remaining columns render beneath per their `cardValue`: stacked
 * label/value (default), inline label/value, or a control that stacks on a narrow
 * card and moves inline once the card is wide enough.
 *
 * Usage:
 *   <MappingTable
 *     :columns="[
 *       { key: 'status', label: '', width: '28px', hideLabelInCard: true, cardHeader: true },
 *       { key: 'field', label: 'System field', width: '150px', cardHeader: true },
 *       { key: 'column', label: 'CSV column', width: 'minmax(0,1fr)' },
 *       { key: 'example', label: 'Example data', width: '1fr', align: 'end' },
 *     ]"
 *     :items="rows"
 *     :row-key="(row) => row.id"
 *     :is-row-expanded="(row) => row.method === 'fromColumn'"
 *     :get-row-class="(row) => (row.needsAttention ? 'bg-warning/10' : '')"
 *   >
 *     <template #cell:status="{ item }"><StatusIndicator :status="item.status" /></template>
 *     <template #cell:field="{ item }">{{ item.label }}</template>
 *     <template #cell:column="{ item }"><SelectField ... /></template>
 *     <template #cell:example="{ item }">{{ item.example }}</template>
 *
 *     <!-- full-width block under an expanded row (e.g. transaction-type triple field) -->
 *     <template #expansion="{ item }">
 *       <div class="grid gap-3 @md/mapping-table:grid-cols-3">…</div>
 *     </template>
 *
 *     <template #empty>No columns to map.</template>
 *   </MappingTable>
 *
 * To change where the grid collapses to cards, edit GRID_BREAKPOINT (a single
 * Tailwind named-container variant prefix). See the constant for the table of
 * available widths.
 */
import { cn } from '@/lib/utils';
import { computed } from 'vue';

export interface MappingTableColumn {
  /** Stable identifier; also selects the `cell:{key}` slot for this column. */
  key: string;
  /** Header text (grid mode) and per-line label (card mode). Empty string ⇒ no label. */
  label: string;
  /**
   * CSS grid track for this column in grid mode, e.g. '1fr' | '150px' |
   * 'minmax(0,1fr)'. Defaults to '1fr'. Ignored in card mode.
   */
  width?: string;
  /** Horizontal alignment of header + cell content. Defaults to 'start'. */
  align?: 'start' | 'center' | 'end';
  /** Grid mode only: extra classes on this column's body cells (e.g. `self-end`). */
  cellClass?: string;
  /**
   * When true, the column's `label` is omitted in card mode and only the cell
   * content renders (e.g. a leading status icon or a title line).
   */
  hideLabelInCard?: boolean;
  /**
   * Card mode only: render this column inline in the card's header row instead
   * of as its own stacked label/value block. Header columns sit on one line
   * with no labels — meant for a leading status icon + the row's title, so the
   * card opens with `✓ Title` rather than burning a line on each. Ignored in
   * grid mode. Defaults to false.
   */
  cardHeader?: boolean;
  /**
   * Card mode only: how this column's label/value pair lays out in the card body.
   * - 'stack' (default): label above a full-width value. Long or rich content.
   * - 'inline': label and value on one line (label left, value right). Short scalars.
   * - 'control': value stacks under the label on a narrow card and moves inline once
   *   the card is wide enough (`@sm/mapping-card`). For wide controls like selects.
   * Ignored in grid mode and for `cardHeader` columns.
   */
  cardValue?: 'stack' | 'inline' | 'control';
}

const props = defineProps<{
  columns: MappingTableColumn[];
  items: T[];
  /** Required — produces a stable key per row for `v-for`. */
  rowKey: (item: T, index: number) => string | number;
  /** When true for a row, the `expansion` slot renders full-width beneath it. */
  isRowExpanded?: (item: T, index: number) => boolean;
  /** Optional extra classes per row (e.g. attention tint `bg-warning/10`). */
  getRowClass?: (item: T, index: number) => string;
}>();

defineSlots<
  {
    /** Per-column cell content. Slot name is `cell:` + the column key. */
    [K in `cell:${string}`]: (props: { item: T; index: number }) => unknown;
  } & {
    /** Full-width content beneath an expanded row. */
    expansion?: (props: { item: T; index: number }) => unknown;
    /** Shown instead of rows when `items` is empty. */
    empty?: () => unknown;
  }
>();

/**
 * Container width at and above which the grid table renders; below it, rows
 * collapse to stacked cards. Tailwind named-container variant prefix bound to
 * the root's `@container/mapping-table`.
 *
 * Default `@xl/mapping-table` ≈ 36rem (576px). With the app sidebar a ~500px
 * content area falls below this ⇒ cards, which suits a 3–4 column table. Widen
 * the value (e.g. `@2xl/mapping-table` = 42rem) to keep cards longer, or narrow
 * it (`@lg/mapping-table` = 32rem) to switch to the grid sooner.
 *
 *   @md  = 28rem   @lg = 32rem   @xl = 36rem   @2xl = 42rem   @3xl = 48rem
 */
const GRID_BREAKPOINT = {
  /** Grid container is hidden below the breakpoint, shown (as grid) at/above it. */
  grid: 'hidden @xl/mapping-table:grid',
  /** Card stack is shown below the breakpoint, hidden at/above it. */
  cards: 'grid @xl/mapping-table:hidden',
} as const;

const alignClass: Record<NonNullable<MappingTableColumn['align']>, string> = {
  start: 'justify-start text-left',
  center: 'justify-center text-center',
  end: 'justify-end text-right',
};

/** Inline grid-template-columns — the only acceptable inline style (tracks are dynamic). */
const gridTemplateColumns = computed(() => props.columns.map((c) => c.width ?? '1fr').join(' '));

/** Hide the grid header row entirely when no column carries a label. */
const hasHeader = computed(() => props.columns.some((c) => c.label.length > 0));

/** Card mode: columns that render inline in the card's header row (status + title). */
const cardHeaderColumns = computed(() => props.columns.filter((c) => c.cardHeader));
/** Card mode: columns that render as label/value blocks beneath the header. */
const cardBodyColumns = computed(() => props.columns.filter((c) => !c.cardHeader));

/**
 * Card body layout per column, driven by `cardValue`. The `@sm/mapping-card` variants
 * react to the card's own width (each card is a named container), so "control" fields
 * stack on a narrow card and only move inline once the card has room for a label + select.
 */
const CARD_FIELD_LAYOUT = {
  stack: { row: 'flex flex-col gap-1', label: '', value: 'min-w-0' },
  inline: { row: 'flex items-center justify-between gap-3', label: 'shrink-0', value: 'min-w-0 text-right' },
  control: {
    row: 'flex flex-col gap-1 @sm/mapping-card:flex-row @sm/mapping-card:items-center @sm/mapping-card:justify-between @sm/mapping-card:gap-3',
    label: '@sm/mapping-card:shrink-0',
    value: 'min-w-0 @sm/mapping-card:flex-1',
  },
} as const;

const cardLayout = (col: MappingTableColumn) => CARD_FIELD_LAYOUT[col.cardValue ?? 'stack'];

const isExpanded = (item: T, index: number): boolean => props.isRowExpanded?.(item, index) ?? false;
const rowClass = (item: T, index: number): string => {
  const callerClass = props.getRowClass?.(item, index);
  return callerClass ? `${callerClass} fields-plain` : '';
};
</script>

<template>
  <div class="@container/mapping-table">
    <!-- Empty state -->
    <div v-if="items.length === 0" class="text-muted-foreground p-6 text-center text-sm">
      <slot name="empty" />
    </div>

    <template v-else>
      <!-- WIDE: CSS-grid table -->
      <div
        :class="cn('border-border bg-card dark:bg-muted/50 overflow-hidden rounded-lg border', GRID_BREAKPOINT.grid)"
        role="table"
      >
        <!-- Header -->
        <div
          v-if="hasHeader"
          class="border-border text-muted-foreground grid items-center gap-3 border-b px-4 py-2.5 text-xs font-medium"
          :style="{ gridTemplateColumns }"
          role="row"
        >
          <div
            v-for="col in columns"
            :key="col.key"
            :class="cn('flex min-w-0 items-center', alignClass[col.align ?? 'start'])"
            role="columnheader"
          >
            {{ col.label }}
          </div>
        </div>

        <!-- Body -->
        <template v-for="(item, index) in items" :key="rowKey(item, index)">
          <div
            :class="
              cn(
                'grid items-center gap-3 px-4 py-2.5 text-sm',
                index > 0 || hasHeader ? 'border-border border-t' : '',
                rowClass(item, index),
              )
            "
            :style="{ gridTemplateColumns }"
            role="row"
          >
            <div
              v-for="col in columns"
              :key="col.key"
              :class="cn('flex min-w-0 items-center', alignClass[col.align ?? 'start'], col.cellClass)"
              role="cell"
            >
              <slot :name="`cell:${col.key}`" :item="item" :index="index" />
            </div>
          </div>

          <!-- Full-width expansion row -->
          <div
            v-if="isExpanded(item, index)"
            :class="cn('border-border border-t px-4 py-3', rowClass(item, index))"
            role="row"
          >
            <div role="cell">
              <slot name="expansion" :item="item" :index="index" />
            </div>
          </div>
        </template>
      </div>

      <!-- NARROW: stacked cards -->
      <div :class="cn('gap-3', GRID_BREAKPOINT.cards)" role="table">
        <div
          v-for="(item, index) in items"
          :key="rowKey(item, index)"
          :class="cn('border-border bg-card @container/mapping-card rounded-lg border p-3', rowClass(item, index))"
          role="row"
        >
          <!-- Header row: status + title inline, no labels (one line instead of one per column) -->
          <div v-if="cardHeaderColumns.length > 0" class="mb-3 flex items-center gap-2">
            <div
              v-for="(col, headerIndex) in cardHeaderColumns"
              :key="col.key"
              :class="cn('flex items-center', headerIndex === 0 ? 'shrink-0' : 'min-w-0 flex-1')"
              role="cell"
            >
              <slot :name="`cell:${col.key}`" :item="item" :index="index" />
            </div>
          </div>

          <!-- Body: remaining columns, laid out per their `cardValue` (stack / inline / control) -->
          <div class="space-y-2.5">
            <div v-for="col in cardBodyColumns" :key="col.key" :class="cardLayout(col).row" role="cell">
              <span
                v-if="!col.hideLabelInCard && col.label.length > 0"
                :class="cn('text-muted-foreground text-xs', cardLayout(col).label)"
              >
                {{ col.label }}
              </span>
              <div :class="cardLayout(col).value">
                <slot :name="`cell:${col.key}`" :item="item" :index="index" />
              </div>
            </div>
          </div>

          <!-- Expansion sits at the bottom of the card -->
          <div v-if="isExpanded(item, index)" class="border-border mt-3 border-t pt-3">
            <slot name="expansion" :item="item" :index="index" />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
