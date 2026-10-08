<script lang="ts" setup>
import type { DashboardWidgetConfig } from '@/api/user-settings';
import CategoryCircle from '@/components/common/category-circle.vue';
import SlidingPanels from '@/components/common/sliding-panels.vue';
import { buttonVariants, Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { Separator } from '@/components/lib/ui/separator';
import { useNotificationCenter } from '@/components/notification-center';
import IncludePlannedMenuItem from '@/components/widgets/components/include-planned-menu-item.vue';
import { useIncludePlannedConfig } from '@/components/widgets/use-include-planned-config';
import { useFormatCurrency } from '@/composable/formatters';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCategoriesStore } from '@/stores/categories/categories';
import { format } from 'date-fns';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  SaveIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import type { Ref } from 'vue';
import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { VueDraggable } from 'vue-draggable-plus';

import WidgetWrapper from '../components/widget-wrapper.vue';
import CategoryPickerDialog from './category-picker-dialog.vue';
import {
  CATEGORY_SORT_LABELS,
  CATEGORY_SORT_OPTIONS,
  type CategorySort,
  readCategorySort,
  sortCategoryRows,
} from './sort-category-rows';
import { useCategorySpendingData } from './use-category-spending-data';

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();

const props = defineProps<{
  selectedPeriod: { from: Date; to: Date };
}>();

const router = useRouter();
const { formatBaseCurrency } = useFormatCurrency();
const { categories, categoriesMap } = storeToRefs(useCategoriesStore());

const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
const saveWidgetConfig =
  inject<(params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>>(
    'dashboard-save-widget-config',
  );

const selectedCategoryIds = computed<string[]>(() => {
  const ids = widgetConfigRef?.value?.config?.selectedCategoryIds;
  return Array.isArray(ids) ? (ids as string[]) : [];
});

const MAX_CATEGORIES = 30;

const visibleSlots = computed(() => ((widgetConfigRef?.value?.rowSpan ?? 1) >= 2 ? 16 : 7));

const { includePlanned } = useIncludePlannedConfig();

const { spendingByCategory, isFetching, hasData } = useCategorySpendingData({
  selectedPeriod: () => props.selectedPeriod,
  categoryIds: selectedCategoryIds,
  includePlanned,
});

const categoryRows = computed(() =>
  selectedCategoryIds.value.map((catId) => {
    const data = spendingByCategory.value[catId];
    const category = categoriesMap.value[catId];

    return {
      id: catId,
      name: category?.name ?? data?.name ?? t('common.labels.unknown'),
      color: category?.color ?? data?.color ?? '#000000',
      netAmount: data?.netAmount ?? 0,
    };
  }),
);

const sortBy = computed(() => readCategorySort({ config: widgetConfigRef?.value?.config }));
const displayRows = computed(() => sortCategoryRows({ rows: categoryRows.value, sortBy: sortBy.value }));

// Mutable copy for drag-and-drop reordering
const draggableRows = ref<typeof categoryRows.value>([]);

const syncDraggableRows = () => {
  draggableRows.value = [...displayRows.value];
};

const isCustomizing = ref(false);
const hasReordered = ref(false);

// Sync adds/removes to draggable list without overriding drag order
watch(categoryRows, (rows) => {
  if (!isCustomizing.value) return;

  const currentIds = new Set<string>(draggableRows.value.map((r) => r.id));
  const newIds = new Set<string>(rows.map((r) => r.id));

  // Add newly appeared rows at the end
  for (const row of rows) {
    if (!currentIds.has(row.id)) {
      draggableRows.value.push(row);
    }
  }

  // Remove rows that no longer exist
  draggableRows.value = draggableRows.value.filter((r) => newIds.has(r.id));
});

const canAddCategory = computed(() => categoryRows.value.length < MAX_CATEGORIES);
// Past the visible slots a trailing "Add" row keeps adding discoverable; an exactly full widget stays clean.
const ghostSlotCount = computed(() => {
  const count = categoryRows.value.length;
  if (count < visibleSlots.value) return visibleSlots.value - count;
  return count > visibleSlots.value && canAddCategory.value ? 1 : 0;
});
const isInitialLoading = computed(() => isFetching.value && !hasData.value && selectedCategoryIds.value.length > 0);

const pickerOpen = ref(false);
// Category ID being replaced, or null for "add new"
const replacingCategoryId = ref<string | null>(null);

const disabledCategoryIds = computed(() => {
  if (replacingCategoryId.value !== null) {
    // When replacing, disable all except the one being replaced
    return selectedCategoryIds.value.filter((id) => id !== replacingCategoryId.value);
  }
  return selectedCategoryIds.value;
});

const openPickerForAdd = () => {
  replacingCategoryId.value = null;
  pickerOpen.value = true;
};

const isSettingsOpen = ref(false);
const settingsView = ref<'main' | 'sort'>('main');

watch(isSettingsOpen, (open) => {
  if (open) settingsView.value = 'main';
});

const addCategoryFromSettings = () => {
  isSettingsOpen.value = false;
  openPickerForAdd();
};

const openPickerForReplace = ({ categoryId }: { categoryId: string }) => {
  replacingCategoryId.value = categoryId;
  pickerOpen.value = true;
};

const saveConfig = async ({ config }: { config: Record<string, unknown> }) => {
  if (!saveWidgetConfig || !widgetConfigRef?.value) return;

  try {
    await saveWidgetConfig({ widgetId: widgetConfigRef.value.widgetId, config });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
    addErrorNotification(t('errors.api.unexpectedError'));
  }
};

const persistCategories = ({ categoryIds }: { categoryIds: string[] }) =>
  saveConfig({ config: { selectedCategoryIds: categoryIds } });

const setSortBy = ({ value }: { value: CategorySort }) => {
  saveConfig({ config: { sortBy: value } });
  settingsView.value = 'main';
};

const handleCategorySelected = ({ categoryId }: { categoryId: string }) => {
  const ids = [...selectedCategoryIds.value];

  if (replacingCategoryId.value !== null) {
    const idx = ids.indexOf(replacingCategoryId.value);
    if (idx >= 0) ids[idx] = categoryId;
  } else {
    ids.push(categoryId);
  }

  persistCategories({ categoryIds: ids });
};

const removeCategory = ({ categoryId }: { categoryId: string }) => {
  const ids = selectedCategoryIds.value.filter((id) => id !== categoryId);
  persistCategories({ categoryIds: ids });

  // Update draggable list immediately
  draggableRows.value = draggableRows.value.filter((r) => r.id !== categoryId);

  if (ids.length === 0) {
    isCustomizing.value = false;
  }
};

const enterCustomize = () => {
  syncDraggableRows();
  hasReordered.value = false;
  isCustomizing.value = true;
};

const onDragEnd = ({ oldIndex, newIndex }: { oldIndex?: number; newIndex?: number }) => {
  if (oldIndex !== newIndex) hasReordered.value = true;
};

const exitCustomize = () => {
  // A drag is the user defining their own order, so it replaces any amount sort.
  if (hasReordered.value) {
    saveConfig({
      config: { selectedCategoryIds: draggableRows.value.map((row) => row.id), sortBy: 'custom' },
    });
  }

  isCustomizing.value = false;
};

const getAmountClass = ({ netAmount }: { netAmount: number }) => {
  if (netAmount > 0) return 'text-app-income-color';
  if (netAmount < 0) return 'text-app-expense-color';
  return 'text-muted-foreground';
};

const formatAmount = ({ netAmount }: { netAmount: number }) => {
  if (netAmount > 0) return formatBaseCurrency(netAmount);
  if (netAmount < 0) return `-${formatBaseCurrency(Math.abs(netAmount))}`;
  return formatBaseCurrency(0);
};

const getDescendantIds = ({ categoryId }: { categoryId: string }): string[] => {
  const childrenMap = new Map<string, string[]>();
  for (const cat of categories.value) {
    if (cat.parentId !== null) {
      const children = childrenMap.get(cat.parentId) ?? [];
      children.push(cat.id);
      childrenMap.set(cat.parentId, children);
    }
  }

  const result: string[] = [];
  const queue = [categoryId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    queue.push(...(childrenMap.get(current) ?? []));
  }
  return result;
};

const navigateToTransactions = ({ categoryId }: { categoryId: string }) => {
  if (isCustomizing.value) return;

  const allIds = getDescendantIds({ categoryId });

  router.push({
    name: ROUTES_NAMES.transactions,
    query: {
      categoryIds: allIds.map(String),
      start: format(props.selectedPeriod.from, 'yyyy-MM-dd'),
      end: format(props.selectedPeriod.to, 'yyyy-MM-dd'),
    },
  });
};
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isFetching" data-testid="widget-category-spending-tracker">
    <template #title>{{ t('dashboard.widgets.categoryTracker.title') }}</template>
    <template #action>
      <button
        v-if="categoryRows.length > 0"
        data-testid="cst-customize-toggle"
        :class="
          buttonVariants({
            variant: isCustomizing ? 'default' : 'ghost',
            size: 'icon-sm',
            class: isCustomizing ? '' : 'text-muted-foreground',
          })
        "
        @click="isCustomizing ? exitCustomize() : enterCustomize()"
      >
        <template v-if="isCustomizing">
          <SaveIcon class="size-4" />
        </template>
        <template v-else>
          <PencilIcon class="size-3.5" />
        </template>
      </button>

      <Popover v-if="widgetConfigRef" v-model:open="isSettingsOpen">
        <PopoverTrigger as-child>
          <Button size="icon-sm" variant="ghost" data-testid="cst-settings-btn">
            <SettingsIcon class="text-muted-foreground size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-72 overflow-hidden p-0" align="end">
          <SlidingPanels v-model="settingsView" :panels="['main', 'sort']">
            <template #main>
              <header class="border-b px-3 py-2 text-sm font-medium">{{ t('common.actions.settings') }}</header>
              <template v-if="canAddCategory">
                <div class="flex flex-col p-2">
                  <button
                    type="button"
                    data-testid="cst-settings-add-category"
                    class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors"
                    @click="addCategoryFromSettings"
                  >
                    <PlusIcon class="text-muted-foreground size-4" />
                    {{ t('dashboard.widgets.categoryTracker.addCategory') }}
                  </button>
                </div>
                <Separator />
              </template>
              <div class="flex flex-col p-2">
                <button
                  v-if="!isCustomizing"
                  type="button"
                  data-testid="cst-settings-sort"
                  class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                  @click="settingsView = 'sort'"
                >
                  <span class="flex flex-col">
                    <span class="text-sm font-medium">{{ t('dashboard.widgets.categoryTracker.sort.title') }}</span>
                    <span class="text-muted-foreground text-xs">{{ t(CATEGORY_SORT_LABELS[sortBy]) }}</span>
                  </span>
                  <ChevronRightIcon class="text-muted-foreground size-4" />
                </button>
                <IncludePlannedMenuItem test-id-prefix="cst" />
              </div>
            </template>

            <template #sort>
              <header class="flex items-center gap-2 border-b px-2 py-2">
                <DesktopOnlyTooltip :content="t('common.actions.back')">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    :aria-label="t('common.actions.back')"
                    @click="settingsView = 'main'"
                  >
                    <ArrowLeftIcon class="size-4" />
                  </Button>
                </DesktopOnlyTooltip>
                <span class="text-sm font-medium">{{ t('dashboard.widgets.categoryTracker.sort.title') }}</span>
              </header>
              <div class="flex flex-col p-2">
                <button
                  v-for="option in CATEGORY_SORT_OPTIONS"
                  :key="option"
                  type="button"
                  :data-testid="`cst-sort-${option}`"
                  class="hover:bg-accent flex items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors"
                  @click="setSortBy({ value: option })"
                >
                  <span class="text-sm">{{ t(CATEGORY_SORT_LABELS[option]) }}</span>
                  <CheckIcon v-if="sortBy === option" class="text-primary-text size-4" />
                </button>
              </div>
            </template>
          </SlidingPanels>
        </PopoverContent>
      </Popover>
    </template>

    <template v-if="isInitialLoading">
      <div class="-mx-2 flex flex-col gap-2">
        <div v-for="n in visibleSlots" :key="n" class="flex h-9 items-center gap-2 rounded-md px-3">
          <div class="bg-muted size-5 animate-pulse rounded-full" />
          <div class="bg-muted h-4 flex-1 animate-pulse rounded" :style="{ maxWidth: `${40 + ((n * 4) % 10)}%` }" />
          <div class="bg-muted ml-auto h-4 w-14 animate-pulse rounded" />
        </div>
      </div>
    </template>

    <template v-else>
      <ScrollArea class="-mx-2 min-h-0 flex-1">
        <div class="flex flex-col gap-2">
          <!-- Customize mode: draggable rows -->
          <VueDraggable
            v-if="isCustomizing"
            v-model="draggableRows"
            handle=".drag-handle"
            :animation="200"
            class="flex flex-col gap-2"
            @end="onDragEnd"
          >
            <div
              v-for="(item, index) in draggableRows"
              :key="item.id"
              class="hover:bg-muted/50 flex h-9 cursor-pointer items-center gap-1 rounded-md py-0.5 pr-3 pl-1 transition-colors"
              @click="openPickerForReplace({ categoryId: item.id })"
            >
              <div
                :class="
                  buttonVariants({
                    size: 'icon-sm',
                    variant: 'ghost',
                    class: 'drag-handle cursor-grab active:cursor-grabbing',
                  })
                "
                @click.stop
              >
                <GripVerticalIcon class="text-muted-foreground size-4" />
              </div>

              <CategoryCircle :category-id="item.id" />

              <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>

              <Button
                data-testid="cst-remove-category"
                size="icon-sm"
                variant="ghost-destructive"
                @click.stop="removeCategory({ categoryId: item.id })"
              >
                <Trash2Icon class="size-3.5" />
              </Button>
            </div>
          </VueDraggable>

          <!-- Normal mode: static rows -->
          <template v-else>
            <button
              v-for="item in displayRows"
              :key="item.id"
              class="hover:bg-muted/50 flex h-9 w-full items-center gap-2 rounded-md px-3 py-0.5 text-left transition-colors"
              @click="navigateToTransactions({ categoryId: item.id })"
            >
              <CategoryCircle :category-id="item.id" />

              <span class="min-w-0 flex-1 truncate text-sm">{{ item.name }}</span>

              <span class="text-amount shrink-0 text-sm" :class="getAmountClass({ netAmount: item.netAmount })">
                {{ formatAmount({ netAmount: item.netAmount }) }}
              </span>
            </button>
          </template>

          <!-- Ghost rows -->
          <button
            v-for="n in ghostSlotCount"
            :key="`ghost-${n}`"
            data-testid="cst-add-slot"
            class="border-muted-foreground/30 hover:bg-muted/50 text-muted-foreground mx-1 flex h-9 items-center gap-2 rounded-md border border-dashed px-2 py-0.5 transition-colors"
            @click="openPickerForAdd"
          >
            <PlusIcon class="size-3.5" />
            <span class="text-sm">{{ t('dashboard.widgets.categoryTracker.addCategory') }}</span>
          </button>
        </div>
      </ScrollArea>
    </template>

    <CategoryPickerDialog
      v-model:open="pickerOpen"
      :disabled-category-ids="disabledCategoryIds"
      @select="(id: string) => handleCategorySelected({ categoryId: id })"
    />
  </WidgetWrapper>
</template>
