<template>
  <div>
    <ScrollArea with-horizontal-scrollbar viewport-class="max-h-[70vh]" class="border-border bg-card rounded-lg border">
      <table class="w-max min-w-full border-collapse text-sm" @mouseleave="hoveredColKey = null">
        <thead>
          <tr>
            <th
              class="border-border bg-card sticky top-0 left-0 z-30 border-r border-b px-3 py-2 text-left font-medium"
            >
              <span class="flex items-center gap-1.5">
                <span>{{ rowHeaderLabel }}</span>

                <DesktopOnlyTooltip
                  v-if="hasParents"
                  :content="allCollapsed ? $t('pivotReport.table.expandAll') : $t('pivotReport.table.collapseAll')"
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    :aria-label="allCollapsed ? $t('pivotReport.table.expandAll') : $t('pivotReport.table.collapseAll')"
                    @click="toggleCollapseAll"
                  >
                    <component :is="allCollapsed ? ChevronsUpDownIcon : ChevronsDownUpIcon" class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </span>
            </th>
            <th
              v-for="col in columns"
              :key="col.key"
              tabindex="0"
              role="button"
              :aria-sort="ariaSortFor(col.key)"
              :class="
                cn(
                  'border-border bg-card sticky top-0 z-20 cursor-pointer border-b px-3 py-2 text-right font-medium whitespace-nowrap select-none',
                  'focus-visible:outline-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2',
                  hoveredColKey === col.key && 'bg-muted',
                )
              "
              @click="toggleSort(col.key)"
              @keydown="onSortKeydown({ event: $event, columnKey: col.key })"
              @mouseenter="hoveredColKey = col.key"
            >
              <span class="inline-flex items-center gap-1">
                {{ col.label }}
                <component :is="sortIcon(col.key)" v-if="sortIcon(col.key)" class="size-3.5 opacity-70" />
              </span>
            </th>
            <th
              tabindex="0"
              role="button"
              :aria-sort="ariaSortFor(TOTAL_COLUMN_KEY)"
              :class="
                cn(
                  'border-border bg-card sticky top-0 right-0 z-30 cursor-pointer border-b border-l px-3 py-2 text-right font-semibold whitespace-nowrap select-none',
                  'focus-visible:outline-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2',
                  hoveredColKey === TOTAL_COLUMN_KEY && 'bg-muted',
                )
              "
              @click="toggleSort(TOTAL_COLUMN_KEY)"
              @keydown="onSortKeydown({ event: $event, columnKey: TOTAL_COLUMN_KEY })"
              @mouseenter="hoveredColKey = TOTAL_COLUMN_KEY"
            >
              <span class="inline-flex items-center gap-1">
                {{ $t('pivotReport.table.total') }}
                <component
                  :is="sortIcon(TOTAL_COLUMN_KEY)"
                  v-if="sortIcon(TOTAL_COLUMN_KEY)"
                  class="size-3.5 opacity-70"
                />
              </span>
            </th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="row in visibleRows" :key="row.id" class="group/row hover:bg-muted/30">
            <!-- Row label (sticky first column) -->
            <th
              scope="row"
              :class="
                cn(
                  'border-border bg-card group-hover/row:bg-accent sticky left-0 z-10 border-r border-b px-3 py-1.5 text-left font-normal',
                  row.kind === 'child' && 'pl-8',
                )
              "
            >
              <span class="flex items-center gap-1.5">
                <DesktopOnlyTooltip
                  v-if="row.kind === 'parent'"
                  :content="
                    collapsed.has(row.id) ? $t('pivotReport.table.expandRow') : $t('pivotReport.table.collapseRow')
                  "
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    class="text-muted-foreground hover:text-foreground -ml-1 size-6 shrink-0"
                    :aria-label="
                      collapsed.has(row.id) ? $t('pivotReport.table.expandRow') : $t('pivotReport.table.collapseRow')
                    "
                    @click="toggleCollapse(row.id)"
                  >
                    <ChevronRightIcon
                      :class="cn('size-4 transition-transform', !collapsed.has(row.id) && 'rotate-90')"
                    />
                  </Button>
                </DesktopOnlyTooltip>
                <BrandLogo
                  v-if="rowDimension === 'payee'"
                  :domain="row.logoDomain ?? null"
                  :initials="row.logoInitials ?? null"
                  :color="row.logoColor ?? null"
                  :name="row.label"
                  class="size-4 shrink-0"
                />
                <span
                  v-else-if="row.color"
                  class="size-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: row.color }"
                />
                <span class="truncate">{{ row.label }}</span>
              </span>
            </th>

            <!-- Value cells -->
            <td
              v-for="(col, index) in columns"
              :key="col.key"
              :class="cn('border-border border-b px-3 py-1.5 text-right tabular-nums')"
              :style="cellStyle({ value: getRowValue({ row, columnKey: col.key }), columnKey: col.key })"
              @mouseenter="hoveredColKey = col.key"
            >
              <template v-if="getRowValue({ row, columnKey: col.key }) !== 0">
                <div>{{ formatMoney(getRowValue({ row, columnKey: col.key })) }}</div>
                <div v-if="deltaLabel({ row, index })" :class="cn('text-[11px]', deltaClass({ row, index }))">
                  {{ deltaLabel({ row, index }) }}
                </div>
              </template>
              <span v-else class="text-muted-foreground/50">—</span>
            </td>

            <!-- Row total -->
            <td
              :class="
                cn(
                  'border-border bg-card group-hover/row:bg-accent sticky right-0 z-10 border-b border-l px-3 py-1.5 text-right font-semibold tabular-nums',
                  hoveredColKey === TOTAL_COLUMN_KEY && 'bg-muted',
                )
              "
              @mouseenter="hoveredColKey = TOTAL_COLUMN_KEY"
            >
              {{ formatMoney(row.total) }}
            </td>
          </tr>
        </tbody>

        <tfoot>
          <tr class="bg-muted/40 font-semibold">
            <th class="border-border bg-muted sticky bottom-0 left-0 z-10 border-t border-r px-3 py-2 text-left">
              {{ $t('pivotReport.table.total') }}
            </th>
            <td
              v-for="col in columns"
              :key="col.key"
              :class="
                cn(
                  'border-border bg-muted/40 border-t px-3 py-2 text-right tabular-nums',
                  hoveredColKey === col.key && 'bg-foreground/10',
                )
              "
              @mouseenter="hoveredColKey = col.key"
            >
              {{ formatMoney(data.columnTotals[col.key] ?? 0) }}
            </td>
            <td
              class="border-border bg-muted sticky right-0 bottom-0 z-10 border-t border-l px-3 py-2 text-right tabular-nums"
            >
              {{ formatMoney(data.grandTotal) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import type { GetPivotReportResponse, PivotMeasure, PivotRowDimension, PivotRow } from '@bt/shared/types';
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ChevronsDownUpIcon, ChevronsUpDownIcon } from '@lucide/vue';
import { type CSSProperties, type Component, computed, ref } from 'vue';

import {
  TOTAL_COLUMN_KEY,
  type PivotSortDirection,
  computeAllCollapsed,
  computeColumnMax,
  computeDelta,
  computeVisibleRows,
  getRowValue,
  heatmapAlpha,
  isDeltaGood,
  sortPivotRows,
} from '../composables/pivot-derivations';

const props = defineProps<{
  data: GetPivotReportResponse;
  measure: PivotMeasure;
  rowDimension: PivotRowDimension;
  heatmap: boolean;
  showDelta: boolean;
  rowHeaderLabel: string;
}>();

const { formatCompactAmount } = useFormatCurrency();

const sort = ref<{ columnKey: string; direction: PivotSortDirection } | null>(null);
const collapsed = ref<Set<string>>(new Set());
const hoveredColKey = ref<string | null>(null);

const columns = computed(() => props.data.columns);
// `Intl` throws a RangeError on an empty currency code, so collapse a blank code
// (backend sends '' when the report has no resolvable base currency) to a default.
const currencyCode = computed(() => props.data.currencyCode || 'USD');

const parentRowIds = computed(() => props.data.rows.filter((row) => row.kind === 'parent').map((row) => row.id));
const hasParents = computed(() => parentRowIds.value.length > 0);
const allCollapsed = computed(() => computeAllCollapsed({ rows: props.data.rows, collapsed: collapsed.value }));

const orderedRows = computed(() => {
  if (!sort.value) return props.data.rows;
  return sortPivotRows({ rows: props.data.rows, columnKey: sort.value.columnKey, direction: sort.value.direction });
});

const visibleRows = computed(() => computeVisibleRows({ rows: orderedRows.value, collapsed: collapsed.value }));

const columnMaxByKey = computed(() => {
  const map = new Map<string, number>();
  for (const col of columns.value) {
    map.set(col.key, computeColumnMax({ rows: props.data.rows, columnKey: col.key }));
  }
  map.set(TOTAL_COLUMN_KEY, computeColumnMax({ rows: props.data.rows, columnKey: TOTAL_COLUMN_KEY }));
  return map;
});

const toggleSort = (columnKey: string) => {
  if (sort.value?.columnKey !== columnKey) {
    sort.value = { columnKey, direction: 'desc' };
    return;
  }
  sort.value = sort.value.direction === 'desc' ? { columnKey, direction: 'asc' } : null;
};

const sortIcon = (columnKey: string): Component | null => {
  if (sort.value?.columnKey !== columnKey) return null;
  return sort.value.direction === 'desc' ? ChevronDownIcon : ChevronUpIcon;
};

const ariaSortFor = (columnKey: string): 'ascending' | 'descending' | 'none' => {
  if (sort.value?.columnKey !== columnKey) return 'none';
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
};

const onSortKeydown = ({ event, columnKey }: { event: KeyboardEvent; columnKey: string }) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleSort(columnKey);
};

const toggleCollapse = (rowId: string) => {
  const next = new Set(collapsed.value);
  if (next.has(rowId)) next.delete(rowId);
  else next.add(rowId);
  collapsed.value = next;
};

const toggleCollapseAll = () => {
  collapsed.value = allCollapsed.value ? new Set() : new Set(parentRowIds.value);
};

// Column-hover adds a faint neutral wash on top of any heatmap intensity. Both are
// drawn as the cell background (never an outline) so they clip cleanly under the
// sticky row-label and total columns when the grid is scrolled sideways — an
// outline would paint over those sticky columns instead of being covered by them.
const HOVER_COLUMN_ALPHA = 0.06;

const cellStyle = ({ value, columnKey }: { value: number; columnKey: string }): CSSProperties => {
  let alpha = 0;
  if (props.heatmap) {
    const columnMax = columnMaxByKey.value.get(columnKey) ?? 0;
    alpha = heatmapAlpha({ value, columnMax });
  }
  if (hoveredColKey.value === columnKey) alpha += HOVER_COLUMN_ALPHA;
  if (alpha <= 0) return {};
  const pct = Math.round(Math.min(alpha, 1) * 100);
  return { backgroundColor: `color-mix(in srgb, var(--foreground) ${pct}%, transparent)` };
};

const formatMoney = (value: number): string => formatCompactAmount(value, currencyCode.value);

const deltaValue = ({ row, index }: { row: PivotRow; index: number }): number | null => {
  if (!props.showDelta || index === 0) return null;
  const currentColumn = columns.value[index];
  const previousColumn = columns.value[index - 1];
  if (!currentColumn || !previousColumn) return null;
  const current = getRowValue({ row, columnKey: currentColumn.key });
  if (current === 0) return null;
  const previous = getRowValue({ row, columnKey: previousColumn.key });
  return computeDelta({ current, previous });
};

const deltaLabel = ({ row, index }: { row: PivotRow; index: number }): string | null => {
  const delta = deltaValue({ row, index });
  if (delta === null) return null;
  const pct = Math.round(delta * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
};

const deltaClass = ({ row, index }: { row: PivotRow; index: number }): string => {
  const delta = deltaValue({ row, index });
  if (delta === null || delta === 0) return 'text-muted-foreground';
  return isDeltaGood({ delta, measure: props.measure }) ? 'text-app-income-color' : 'text-app-expense-color';
};
</script>
