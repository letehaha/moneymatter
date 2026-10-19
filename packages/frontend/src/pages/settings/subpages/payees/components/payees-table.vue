<template>
  <div ref="wrapperRef" class="@container/payees-table">
    <div class="rounded-md border">
      <PayeesBulkActions class="hidden @3xl/payees-table:flex" :selected-ids="selectedIds" @clear="clearSelection" />

      <!-- Compact-only toolbar: select mode + sort (column headers handle sorting on wide layouts) -->
      <!-- Sticks below the app header plus the settings BackLink (py-2 + text-sm line = 2.25rem) -->
      <div
        class="bg-card sticky top-[calc(var(--header-height)+2.25rem)] z-(--z-navbar) flex min-h-11 items-center justify-between gap-2 rounded-t-md border-b px-3 py-1.5 text-xs @3xl/payees-table:hidden"
      >
        <template v-if="selecting">
          <label class="flex cursor-pointer items-center gap-3">
            <Checkbox
              :model-value="selectAllState"
              :aria-label="$t('payees.bulk.selectAll')"
              @update:model-value="toggleAll"
            />
            <span class="text-sm select-none">{{
              $t('payees.bulk.selectedCount', { count: selectedIds.length })
            }}</span>
          </label>
          <UiButton variant="ghost" size="sm" class="h-8 px-2" @click="clearSelection">
            {{ $t('common.actions.cancel') }}
          </UiButton>
        </template>
        <template v-else>
          <UiButton
            variant="ghost-primary"
            size="sm"
            class="h-8 px-2"
            :disabled="list.length === 0"
            @click="selecting = true"
          >
            {{ $t('payees.bulk.select') }}
          </UiButton>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <UiButton variant="ghost" size="sm" class="h-8 gap-1 px-2">
                {{ currentSortLabel }}
                <component :is="sortDir === 'asc' ? ArrowUpIcon : ArrowDownIcon" class="size-3.5" />
              </UiButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-for="opt in sortOptions" :key="opt.key" @click="setSort(opt.key)">
                {{ opt.label }}
                <component
                  v-if="sortBy === opt.key"
                  :is="sortDir === 'asc' ? ArrowUpIcon : ArrowDownIcon"
                  class="ml-auto size-3.5"
                />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </div>

      <!-- Wide column header row -->
      <div
        class="bg-muted text-muted-foreground hidden items-center rounded-t-md border-b text-xs font-medium tracking-wider uppercase @3xl/payees-table:flex"
      >
        <div class="flex w-7 shrink-0 items-center justify-end">
          <Checkbox
            v-if="list.length > 0"
            :model-value="selectAllState"
            :aria-label="$t('payees.bulk.selectAll')"
            @update:model-value="toggleAll"
          />
        </div>
        <div :class="['grid flex-1 gap-3 px-3 py-2', DESKTOP_GRID]">
          <SortHeaderButton
            :label="$t('payees.columns.name')"
            :active="sortBy === 'name'"
            :dir="sortDir"
            @click="setSort('name')"
          />
          <SortHeaderButton
            :label="$t('payees.columns.transactionCount')"
            align="right"
            :active="sortBy === 'transactionCount'"
            :dir="sortDir"
            @click="setSort('transactionCount')"
          />
          <SortHeaderButton
            :label="$t('payees.columns.netFlow')"
            align="right"
            :active="sortBy === 'netFlow'"
            :dir="sortDir"
            @click="setSort('netFlow')"
          />
          <span class="flex items-center gap-1">
            <span>{{ $t('payees.columns.category') }}</span>
            <ResponsiveTooltip :delay-duration="100" :content="$t('payees.columns.categoryHint')">
              <InfoIcon class="size-3 cursor-help" @click.prevent.stop />
            </ResponsiveTooltip>
          </span>
          <SortHeaderButton
            :label="$t('payees.columns.defaultTags')"
            :active="sortBy === 'defaultTagsCount'"
            :dir="sortDir"
            @click="setSort('defaultTagsCount')"
          />
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="isLoading && list.length === 0" class="grid gap-1 p-2">
        <PayeeRowSkeleton v-for="i in SKELETON_ROW_COUNT" :key="i" />
      </div>

      <!-- Empty state -->
      <div v-else-if="list.length === 0" class="py-12 text-center">
        <div class="bg-muted mx-auto mb-3 flex size-12 items-center justify-center rounded-full">
          <PackageOpenIcon class="text-muted-foreground size-6" />
        </div>
        <p class="text-foreground mb-1 text-sm font-medium">{{ $t('payees.emptyState.title') }}</p>
        <p class="text-muted-foreground text-xs">{{ $t('payees.emptyState.description') }}</p>
      </div>

      <!-- Virtualized rows -->
      <div v-else ref="listRef">
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <div
            v-for="virtualRow in virtualRows"
            :key="getRowKey(virtualRow.index)"
            :data-index="virtualRow.index"
            :ref="(el) => measureRow(el as Element | null)"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }"
          >
            <div
              v-if="list[virtualRow.index]"
              :class="
                cn(
                  'hover:bg-muted/40 flex border-b transition-colors',
                  selected.has(list[virtualRow.index]!.id) && 'bg-muted/40',
                  isRowSelectable && 'cursor-pointer select-none',
                )
              "
              @click="isRowSelectable && toggleRowSelection(virtualRow.index)"
            >
              <div
                :class="cn('flex w-7 shrink-0 items-center justify-end', !selecting && 'hidden @3xl/payees-table:flex')"
                @click.stop
              >
                <Checkbox
                  :model-value="selected.has(list[virtualRow.index]!.id)"
                  :aria-label="$t('payees.bulk.selectRow', { name: list[virtualRow.index]!.name })"
                  @update:model-value="(value) => toggleRow({ value: value === true, index: virtualRow.index })"
                />
              </div>
              <component
                :is="isRowSelectable ? 'div' : RouterLink"
                :to="
                  isRowSelectable
                    ? undefined
                    : { name: ROUTES_NAMES.settingsPayeeDetail, params: { id: list[virtualRow.index]!.id } }
                "
                class="focus-visible:bg-muted/40 focus-visible:ring-ring block min-w-0 flex-1 px-3 py-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                <!-- Compact (two-line row) -->
                <div class="flex items-center gap-2.5 @3xl/payees-table:hidden">
                  <BrandLogo
                    v-bind="toEntityLogoDisplayProps(list[virtualRow.index]!)"
                    :name="list[virtualRow.index]!.name"
                    class="size-7 shrink-0"
                  />
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div class="flex items-center gap-2">
                      <span class="text-foreground truncate text-sm font-medium">
                        {{ list[virtualRow.index]!.name }}
                      </span>
                      <span class="ml-auto flex shrink-0 flex-col items-end leading-tight">
                        <span
                          class="text-base font-medium tabular-nums"
                          :class="netFlowClass(list[virtualRow.index]!.stats?.netFlowRef ?? 0)"
                        >
                          {{ formatNetFlow(list[virtualRow.index]!.stats?.netFlowRef ?? 0) }}
                        </span>
                        <span class="text-muted-foreground text-xs tabular-nums">
                          {{ $t('payees.txCount', { count: list[virtualRow.index]!.stats?.transactionCount ?? 0 }) }}
                        </span>
                      </span>
                    </div>
                    <div class="flex min-w-0 items-center gap-2">
                      <CategoryDisplay
                        :category-id="
                          list[virtualRow.index]!.defaultCategoryId ??
                          list[virtualRow.index]!.stats?.topCategoryId ??
                          null
                        "
                      />
                      <TagsIndicator :tags="payeeTags({ ids: list[virtualRow.index]!.defaultTagIds })" />
                    </div>
                  </div>
                </div>

                <!-- Wide (grid row) -->
                <div :class="['hidden items-center gap-3 text-sm @3xl/payees-table:grid', DESKTOP_GRID]">
                  <div class="flex min-w-0 items-center gap-2">
                    <BrandLogo
                      v-bind="toEntityLogoDisplayProps(list[virtualRow.index]!)"
                      :name="list[virtualRow.index]!.name"
                      class="size-7 shrink-0"
                    />
                    <span class="truncate font-medium">{{ list[virtualRow.index]!.name }}</span>
                  </div>
                  <span class="text-right tabular-nums">
                    {{ list[virtualRow.index]!.stats?.transactionCount ?? 0 }}
                  </span>
                  <span
                    class="text-right tabular-nums"
                    :class="netFlowClass(list[virtualRow.index]!.stats?.netFlowRef ?? 0)"
                  >
                    {{ formatNetFlow(list[virtualRow.index]!.stats?.netFlowRef ?? 0) }}
                  </span>
                  <CategoryDisplay
                    :category-id="
                      list[virtualRow.index]!.defaultCategoryId ?? list[virtualRow.index]!.stats?.topCategoryId ?? null
                    "
                  />
                  <span class="flex min-w-0 items-center">
                    <TagsIndicator :tags="payeeTags({ ids: list[virtualRow.index]!.defaultTagIds })" />
                    <span
                      v-if="list[virtualRow.index]!.defaultTagIds.length === 0"
                      class="text-muted-foreground text-sm"
                      >—</span
                    >
                  </span>
                </div>
              </component>
            </div>
            <div v-else class="text-muted-foreground border-b px-3 py-3 text-center text-xs">
              {{ $t('payees.loadingMore') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <PayeesBulkActions
      v-if="selecting"
      variant="bottom"
      class="@3xl/payees-table:hidden"
      :selected-ids="selectedIds"
      @clear="clearSelection"
    />
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { useBaseCurrency } from '@/composable/data-queries/currencies';
import { useInfinitePayees } from '@/composable/data-queries/payees';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useScrollAreaContainer } from '@/composable/scroll-area-container';
import { useVirtualizerScrollMemory } from '@/composable/use-virtualizer-scroll-memory';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { ROUTES_NAMES } from '@/routes/constants';
import type { PayeeSortBy, PayeeSortDir } from '@/api/payees';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { cn } from '@/lib/utils';
import { useTagsStore } from '@/stores';
import type { RecordId } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, InfoIcon, PackageOpenIcon } from '@lucide/vue';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref, shallowReactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import CategoryDisplay from './category-display.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import TagsIndicator from '@/components/common/tags-indicator.vue';
import PayeeRowSkeleton from './payee-row-skeleton.vue';
import PayeesBulkActions from './payees-bulk-actions.vue';
import SortHeaderButton from './sort-header-button.vue';

const SKELETON_ROW_COUNT = 6;
// Mirrors Tailwind's `@3xl` container-query breakpoint (48rem = 768px) so the
// virtualizer's row-height estimate switches in step with the CSS layout flip.
const COMPACT_BREAKPOINT_PX = 768;
const COMPACT_ROW_ESTIMATE_PX = 64;
const WIDE_ROW_ESTIMATE_PX = 48;
const DESKTOP_GRID = 'grid-cols-[2fr_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)]';
const NET_FLOW_FALLBACK_CURRENCY = 'USD';

const props = defineProps<{
  searchQuery?: string;
}>();

const { t, locale } = useI18n();

// The tags store isn't populated app-wide, so a direct visit to this page would
// render empty tag cells without this.
const tagsStore = useTagsStore();
const { tagsMap } = storeToRefs(tagsStore);
tagsStore.loadTags();

const payeeTags = ({ ids }: { ids: RecordId[] }) => ids.flatMap((id) => tagsMap.value[id] ?? []);

const sortBy = useLocalStorage<PayeeSortBy>('payees-table-sort-by', 'transactionCount');
const sortDir = useLocalStorage<PayeeSortDir>('payees-table-sort-dir', 'desc');

const sortOptions = computed<ReadonlyArray<{ key: PayeeSortBy; label: string }>>(() => [
  { key: 'transactionCount', label: t('payees.sort.transactionCount') },
  { key: 'netFlow', label: t('payees.sort.netFlow') },
  { key: 'name', label: t('payees.sort.name') },
  { key: 'lastSeen', label: t('payees.sort.lastSeen') },
  { key: 'defaultTagsCount', label: t('payees.sort.defaultTags') },
]);

const currentSortLabel = computed(
  () => sortOptions.value.find((o) => o.key === sortBy.value)?.label ?? sortOptions.value[0]!.label,
);

const setSort = (key: PayeeSortBy) => {
  if (sortBy.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = key;
    // Numbers default to descending (largest first) – that's the natural read.
    // Name defaults to ascending (A → Z).
    sortDir.value = key === 'name' ? 'asc' : 'desc';
  }
};

const debouncedQuery = computed(() => (props.searchQuery ?? '').trim() || undefined);

const { list, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfinitePayees({
  q: debouncedQuery,
  sortBy,
  sortDir,
});

const wrapperRef = ref<HTMLElement | null>(null);
const { width: wrapperWidth } = useElementSize(wrapperRef);
const isCompact = computed(() => wrapperWidth.value > 0 && wrapperWidth.value < COMPACT_BREAKPOINT_PX);

// The list scrolls with the page, so the virtualizer tracks the layout's scroll area and
// needs the list's offset inside it.
const scrollContainer = useScrollAreaContainer(SCROLL_AREA_IDS.dashboard);
const scrollElement = computed<HTMLElement | null>(() => scrollContainer.value?.viewportElement ?? null);
const listRef = ref<HTMLElement | null>(null);
const scrollMargin = ref(0);
watch(listRef, (el) => {
  const scrollEl = scrollElement.value;
  if (el && scrollEl) {
    scrollMargin.value = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
  }
});

const { virtualizer, virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: list,
  hasNextPage: computed(() => hasNextPage.value ?? false),
  fetchNextPage: () => fetchNextPage(),
  isFetchingNextPage: computed(() => isFetchingNextPage.value ?? false),
  parentRef: scrollElement,
  scrollMargin,
  estimateSize: () => (isCompact.value ? COMPACT_ROW_ESTIMATE_PX : WIDE_ROW_ESTIMATE_PX),
  overscan: 8,
  getItemKey: (index) => list.value[index]?.id ?? `idx-${index}`,
});

useVirtualizerScrollMemory({
  storageKey: 'payees-table-row-index',
  virtualizer,
  scrollElement,
  itemsCount: () => list.value.length,
});

// Selection survives search and sort changes, so payees picked across several
// searches can be deleted in one go.
const selected = shallowReactive(new Set<string>());
const selectedIds = computed(() => [...selected]);
// Compact layout hides row checkboxes until the user enters select mode.
const selecting = ref(false);
const clearSelection = () => {
  selected.clear();
  selecting.value = false;
};
const isRowSelectable = computed(() => selecting.value && isCompact.value);
const toggleRowSelection = (index: number) => toggleRow({ value: !selected.has(list.value[index]!.id), index });
const { handleSelection } = useShiftMultiSelect(selected);
const toggleRow = ({ value, index }: { value: boolean; index: number }) =>
  handleSelection(value, list.value[index]!.id, index, list.value, (payee) => payee.id);

const loadedSelectedCount = computed(() => list.value.filter((p) => selected.has(p.id)).length);
const selectAllState = computed(() => {
  if (loadedSelectedCount.value === 0) return false;
  return loadedSelectedCount.value === list.value.length ? true : 'indeterminate';
});
const toggleAll = () => {
  const selectAll = selectAllState.value !== true;
  for (const payee of list.value) {
    if (selectAll) selected.add(payee.id);
    else selected.delete(payee.id);
  }
};

const measureRow = (el: Element | null) => {
  if (el) virtualizer.value.measureElement(el as HTMLElement);
};

const getRowKey = (index: number) => list.value[index]?.id ?? `pending-${index}`;

const { data: baseCurrency } = useBaseCurrency();
const refCurrencyCode = computed(() => baseCurrency.value?.currencyCode ?? NET_FLOW_FALLBACK_CURRENCY);
const formatNetFlow = (val: number) =>
  new Intl.NumberFormat(locale.value, {
    style: 'currency',
    currency: refCurrencyCode.value,
    signDisplay: 'always',
    maximumFractionDigits: 0,
  }).format(val);

const netFlowClass = (val: number) => {
  if (val > 0) return 'text-app-income-color';
  if (val < 0) return 'text-app-expense-color';
  return '';
};
</script>
