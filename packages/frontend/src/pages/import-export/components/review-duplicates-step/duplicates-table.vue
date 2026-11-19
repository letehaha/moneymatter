<!--
  Duplicate-review table shared by the CSV and Wallet import wizards. Lists every detected duplicate
  pair (an imported CSV row matched to an existing transaction) and lets the user
  re-include any pair by checking its box ("import anyway").

  Two layouts, chosen by the table's OWN width (ResizeObserver via useElementSize —
  the app sidebar makes viewport breakpoints unreliable for content-area width):
    - wide   → a real <table> with a sticky header and column-aligned cells, so the
               two transactions sit side by side for scanning.
    - narrow → stacked cards, each holding a field | CSV | Existing comparison table,
               which stays readable where side-by-side columns would be too cramped.

  Both layouts virtualize their rows with @tanstack/vue-virtual (padding-row
  technique) so a multi-thousand-row import stays responsive. A single virtualizer
  drives whichever layout is mounted; flipping layouts resets its measurement cache
  because a card is several times taller than a table row.
-->
<template>
  <div ref="wrapperRef">
    <ScrollArea
      ref="scrollAreaRef"
      class="border-warning/20 bg-muted/50 rounded-lg border"
      viewport-class="max-h-[28rem]"
      type="auto"
    >
      <!-- WIDE: real table, sticky header, virtualized body -->
      <table v-if="!isNarrow" class="w-full table-fixed border-separate border-spacing-0 text-sm">
        <colgroup>
          <col style="width: 40px" />
          <col style="width: 56px" />
          <col style="width: 132px" />
          <col />
          <col />
        </colgroup>
        <thead class="sticky top-0 z-2">
          <tr class="text-muted-foreground text-xs font-medium">
            <th class="bg-muted border-border border-b px-3 py-2.5" />
            <th class="bg-muted border-border border-b px-3 py-2.5 text-left">
              {{ $t('importShared.duplicatesTable.columnHeaders.row') }}
            </th>
            <th class="bg-muted border-border border-b px-3 py-2.5 text-left">
              {{ $t('importShared.duplicatesTable.columnHeaders.match') }}
            </th>
            <th class="bg-muted border-border border-b px-3 py-2.5 text-left">
              {{ $t('importShared.duplicatesTable.columnHeaders.csvTransaction') }}
            </th>
            <th class="bg-muted border-border border-b px-3 py-2.5 text-left">
              {{ $t('importShared.duplicatesTable.columnHeaders.existingTransaction') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="paddingTop > 0" aria-hidden="true">
            <td colspan="5" :style="{ height: `${paddingTop}px` }" class="p-0" />
          </tr>
          <tr
            v-for="{ index, item } in visibleRows"
            :key="item.rowIndex"
            :ref="measureRow"
            :data-index="index"
            :class="
              cn(
                'hover:bg-hover cursor-pointer align-top select-none',
                unmarkedIndices.has(item.rowIndex) ? 'bg-warning/5' : '',
              )
            "
            @click="!isLocked(item) && emit('toggle', item.rowIndex)"
          >
            <td class="border-border border-b px-3 py-2.5">
              <!-- Stop propagation so a direct checkbox click toggles once (via its own
                   @update:model-value) rather than also firing the row's @click. -->
              <span class="inline-flex" @click.stop>
                <Checkbox
                  :model-value="unmarkedIndices.has(item.rowIndex)"
                  :disabled="isLocked(item)"
                  :aria-label="$t('importShared.duplicatesTable.importAnywayAriaLabel', { row: item.rowIndex })"
                  @update:model-value="emit('toggle', item.rowIndex)"
                />
              </span>
            </td>
            <td class="border-border text-muted-foreground border-b px-3 py-2.5 font-mono text-xs">
              #{{ item.rowIndex }}
            </td>
            <td class="border-border border-b px-3 py-2.5">
              <span :class="matchPillClass(item.matchType)">
                {{ matchTypeLabel(item.matchType) }}
                <span class="ml-1 opacity-60">{{ item.confidence }}%</span>
              </span>
            </td>
            <td class="border-border border-b px-3 py-2.5">
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-xs">
                <template v-for="field in sideComparisonFields(item, 'csv')" :key="field.key">
                  <dt class="text-muted-foreground/70">{{ fieldLabel(field.key) }}</dt>
                  <dd :class="cn('truncate', field.emphasis ? 'font-medium tabular-nums' : 'text-muted-foreground')">
                    {{ field.csv }}
                  </dd>
                </template>
              </dl>
            </td>
            <td class="border-border border-b px-3 py-2.5">
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-xs">
                <template v-for="field in sideComparisonFields(item, 'existing')" :key="field.key">
                  <dt class="text-muted-foreground/70">{{ fieldLabel(field.key) }}</dt>
                  <dd :class="cn('truncate', field.emphasis ? 'font-medium tabular-nums' : 'text-muted-foreground')">
                    {{ field.existing }}
                  </dd>
                </template>
              </dl>
            </td>
          </tr>
          <tr v-if="paddingBottom > 0" aria-hidden="true">
            <td colspan="5" :style="{ height: `${paddingBottom}px` }" class="p-0" />
          </tr>
        </tbody>
      </table>

      <!-- NARROW: stacked comparison cards, virtualized -->
      <div v-else class="p-1">
        <div v-if="paddingTop > 0" aria-hidden="true" :style="{ height: `${paddingTop}px` }" />
        <!-- Wrapper carries the inter-card gap (pb-3) so the virtualizer measures it as part of the row. -->
        <div
          v-for="{ index, item } in visibleRows"
          :key="item.rowIndex"
          :ref="measureRow"
          :data-index="index"
          class="pb-3"
        >
          <div
            :class="
              cn(
                'border-border bg-card hover:bg-hover cursor-pointer rounded-lg border p-3 select-none',
                unmarkedIndices.has(item.rowIndex) ? 'bg-warning/5' : '',
              )
            "
            @click="!isLocked(item) && emit('toggle', item.rowIndex)"
          >
            <!-- Header: checkbox + row number on the left, match pill pinned right -->
            <div class="mb-3 flex items-center gap-2">
              <!-- Stop propagation so a direct checkbox click toggles once (via its own
                   @update:model-value) rather than also firing the card's @click. -->
              <span class="inline-flex" @click.stop>
                <Checkbox
                  :model-value="unmarkedIndices.has(item.rowIndex)"
                  :disabled="isLocked(item)"
                  :aria-label="$t('importShared.duplicatesTable.importAnywayAriaLabel', { row: item.rowIndex })"
                  @update:model-value="emit('toggle', item.rowIndex)"
                />
              </span>
              <span class="text-muted-foreground font-mono text-xs">#{{ item.rowIndex }}</span>
              <span :class="cn('ml-auto', matchPillClass(item.matchType))">
                {{ matchTypeLabel(item.matchType) }}
                <span class="ml-1 opacity-60">{{ item.confidence }}%</span>
              </span>
            </div>

            <!-- field | CSV | Existing comparison -->
            <table class="w-full table-fixed text-xs">
              <colgroup>
                <col style="width: 5.5rem" />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr class="text-muted-foreground/70 text-left">
                  <th class="pb-1 font-normal" />
                  <th class="pb-1 font-normal">
                    {{ $t('importShared.duplicatesTable.columnHeaders.csvShort') }}
                  </th>
                  <th class="pb-1 font-normal">
                    {{ $t('importShared.duplicatesTable.columnHeaders.existingShort') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in buildComparisonRows(item)" :key="row.key" class="align-top">
                  <td class="text-muted-foreground/70 py-0.5 pr-2">{{ fieldLabel(row.key) }}</td>
                  <td
                    :class="
                      cn(
                        'py-0.5 pr-2 wrap-break-word',
                        row.emphasis && 'font-medium tabular-nums',
                        row.csv === null && 'text-muted-foreground/50',
                      )
                    "
                  >
                    {{ row.csv ?? DUPLICATE_PLACEHOLDER }}
                  </td>
                  <td
                    :class="
                      cn(
                        'py-0.5 wrap-break-word',
                        row.emphasis && 'font-medium tabular-nums',
                        row.existing === null && 'text-muted-foreground/50',
                      )
                    "
                  >
                    {{ row.existing ?? DUPLICATE_PLACEHOLDER }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="paddingBottom > 0" aria-hidden="true" :style="{ height: `${paddingBottom}px` }" />
      </div>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { DuplicateMatch } from '@bt/shared/types';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { useElementSize } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type ComparisonFieldKey,
  DUPLICATE_PLACEHOLDER,
  buildComparisonRows,
  sideComparisonFields,
} from './duplicate-comparison';

const props = defineProps<{
  duplicates: DuplicateMatch[];
  /** Row indices the user re-included ("import anyway"); their checkbox is checked. */
  unmarkedIndices: Set<number>;
}>();

const emit = defineEmits<{
  toggle: [rowIndex: number];
}>();

const { t } = useI18n();

// --- Responsive layout (table ↔ cards), driven by the table's own width ---
const wrapperRef = ref<HTMLElement | null>(null);
const { width: wrapperWidth } = useElementSize(wrapperRef);
/** Below this the grid can't hold both transactions side by side, so cards take over. */
const NARROW_THRESHOLD_PX = 576;
const isNarrow = computed(() => wrapperWidth.value > 0 && wrapperWidth.value < NARROW_THRESHOLD_PX);

// --- Match-type pill ---

const matchTypeLabel = (type: DuplicateMatch['matchType']): string => {
  switch (type) {
    case 'exact':
      return t('importShared.duplicatesTable.matchTypeLabels.exact');
    case 'originalId':
      return t('importShared.duplicatesTable.matchTypeLabels.idMatch');
    case 'fuzzy':
      return t('importShared.duplicatesTable.matchTypeLabels.fuzzy');
    default:
      return type;
  }
};

/** A stable-ID match is enforced by a unique index server-side, so "import anyway" cannot apply. */
const isLocked = (item: DuplicateMatch): boolean => item.matchType === 'originalId';

/** exact + originalId are high-confidence (green pill); fuzzy is a soft match (amber pill). */
const isStrongMatch = (type: DuplicateMatch['matchType']): boolean => type === 'exact' || type === 'originalId';

const matchPillClass = (type: DuplicateMatch['matchType']): string =>
  cn(
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
    isStrongMatch(type) ? 'bg-success/10 text-success-text' : 'bg-warning/10 text-warning-text',
  );

// --- Field comparison (pure logic + formatting lives in ./duplicate-comparison) ---

/** Maps a comparison field key to its i18n label key. */
const FIELD_LABEL_KEYS: Record<ComparisonFieldKey, string> = {
  amount: 'importShared.duplicatesTable.fieldLabels.amount',
  date: 'importShared.duplicatesTable.fieldLabels.date',
  note: 'importShared.duplicatesTable.fieldLabels.note',
  category: 'importShared.duplicatesTable.fieldLabels.category',
};

const fieldLabel = (key: ComparisonFieldKey): string => t(FIELD_LABEL_KEYS[key]);

// --- Virtualization (single virtualizer; padding-row technique for both layouts) ---

const ROW_ESTIMATE_WIDE_PX = 80;
const ROW_ESTIMATE_NARROW_PX = 200;

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const getScrollElement = (): HTMLElement | null => scrollAreaRef.value?.viewportRef?.viewportElement ?? null;

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.duplicates.length,
    getScrollElement,
    estimateSize: () => (isNarrow.value ? ROW_ESTIMATE_NARROW_PX : ROW_ESTIMATE_WIDE_PX),
    overscan: 6,
    getItemKey: (index: number) => props.duplicates[index]?.rowIndex ?? index,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
const paddingTop = computed(() => virtualRows.value[0]?.start ?? 0);
const paddingBottom = computed(() => {
  const last = virtualRows.value[virtualRows.value.length - 1];
  return last ? totalSize.value - last.end : 0;
});

/** Resolve each virtual row to its duplicate once, so the template stays index-noise free. */
const visibleRows = computed(() =>
  virtualRows.value.map((virtualRow) => ({ index: virtualRow.index, item: props.duplicates[virtualRow.index]! })),
);

// A layout flip changes row heights several-fold; drop the stale measurement cache
// so the virtualizer re-measures the freshly mounted rows instead of reusing old sizes.
watch(isNarrow, () => virtualizer.value.measure());

/**
 * TanStack measures each rendered row by its data-index. Forward both element and
 * null (unmount) so its ResizeObserver bookkeeping stays balanced — skipping null
 * leaks observers, which shows up as growing CPU on long scrolls.
 */
const measureRow = (el: unknown) => {
  if (el === null || el instanceof Element) {
    virtualizer.value.measureElement(el as Element | null);
  }
};
</script>
