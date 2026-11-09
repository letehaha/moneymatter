<template>
  <div class="@container/scope flex items-center gap-1">
    <DesktopOnlyTooltip v-if="scopeCategory" :content="t('analytics.trends.scope.up')">
      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0 @md/scope:hidden"
        :aria-label="t('analytics.trends.scope.up')"
        @click="selectOnly({ categoryId: scopeCategory.parentId })"
      >
        <ChevronLeftIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>

    <nav class="flex min-w-0 flex-1 items-center gap-1 text-sm" :aria-label="t('analytics.trends.scope.label')">
      <template v-if="hasSelection">
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hidden h-8 px-2 @md/scope:inline-flex"
          @click="selectOnly({ categoryId: null })"
        >
          {{ t('analytics.trends.scope.all') }}
        </Button>
        <ChevronRightIcon class="text-muted-foreground hidden size-4 shrink-0 @md/scope:block" />

        <template v-for="ancestor in ancestors" :key="ancestor.id">
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground hidden h-8 max-w-40 px-2 @md/scope:inline-flex"
            @click="selectOnly({ categoryId: ancestor.id })"
          >
            <span class="truncate">{{ ancestor.name }}</span>
          </Button>
          <ChevronRightIcon class="text-muted-foreground hidden size-4 shrink-0 @md/scope:block" />
        </template>
      </template>

      <div class="min-w-0">
        <ComboboxCategories
          scope-picker
          :category-ids="filters.categories.ids"
          :mode="filters.categories.mode"
          :placeholder="t('analytics.trends.scope.all')"
          :selected-text="selectionLabel"
          trigger-class="h-8 md:h-8 border-transparent bg-transparent px-2 font-semibold"
          @update:category-ids="(ids) => patchCategories({ ids })"
        >
          <template #header>
            <div class="flex justify-end px-2 pt-2">
              <PillTabs
                size="sm"
                :items="modeItems"
                :model-value="filters.categories.mode"
                @update:model-value="(mode) => patchCategories({ mode: mode as FilterGroup['mode'] })"
              />
            </div>
          </template>
        </ComboboxCategories>
      </div>

      <template v-if="hasSelection">
        <Separator orientation="vertical" class="h-5" />
        <Button
          variant="ghost-destructive"
          size="sm"
          class="h-8 shrink-0 px-2"
          :aria-label="t('analytics.trends.scope.clear')"
          @click="selectOnly({ categoryId: null })"
        >
          <XIcon class="size-4" />
          <span class="hidden @md/scope:inline">{{ t('analytics.trends.scope.clear') }}</span>
        </Button>
      </template>
    </nav>

    <Button variant="ghost-primary" size="sm" class="h-8 shrink-0 px-2" as-child>
      <RouterLink :to="transactionsLink">
        {{ t('analytics.trends.scope.transactions') }}
        <ArrowRightIcon class="size-4" />
      </RouterLink>
    </Button>
  </div>
</template>

<script setup lang="ts">
import { type MetricType } from '@/common/utils/analytics-metric';
import { getAncestors } from '@/common/utils/category-tree';
import ComboboxCategories from '@/components/common/combobox-categories.vue';
import { Button } from '@/components/lib/ui/button';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { Separator } from '@/components/lib/ui/separator';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ROUTES_NAMES } from '@/routes';
import { useCategoriesStore } from '@/stores';
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { type RouteLocationRaw, RouterLink } from 'vue-router';

import {
  type FilterGroup,
  type TrendsFilters,
  getScopeCategoryId,
  scopeTo,
  toTransactionFilterParams,
} from '../trends-filters';

const props = defineProps<{
  filters: TrendsFilters;
  from: Date;
  to: Date;
  metric: MetricType;
}>();

const emit = defineEmits<{
  'update:filters': [value: TrendsFilters];
}>();

const { t } = useI18n();
const { categories, categoriesMap } = storeToRefs(useCategoriesStore());

const hasSelection = computed(() => props.filters.categories.ids.length > 0);

const scopeCategory = computed(() => {
  const id = getScopeCategoryId({ filters: props.filters });
  return id ? categoriesMap.value[id] : undefined;
});

const ancestors = computed(() =>
  scopeCategory.value ? getAncestors({ id: scopeCategory.value.id, categoriesMap: categoriesMap.value }) : [],
);

const selectionLabel = computed(() => {
  const { mode, ids } = props.filters.categories;
  const names = ids.map((id) => categoriesMap.value[id]?.name).filter((name): name is string => !!name);

  let list: string;
  if (names.length > 3) list = t('analytics.trends.scope.count', names.length, { named: { count: names.length } });
  else if (names.length === 3)
    list = `${names.slice(0, 2).join(', ')} ${t('analytics.trends.scope.more', { count: 1 })}`;
  else list = names.join(', ');

  return mode === 'exclude' ? t('analytics.trends.scope.allExcept', { list }) : list;
});

const modeItems = computed<PillTabItem[]>(() => [
  { value: 'include', label: t('analytics.trends.filters.include') },
  { value: 'exclude', label: t('analytics.trends.filters.exclude') },
]);

const patchCategories = (changes: Partial<FilterGroup>) =>
  emit('update:filters', { ...props.filters, categories: { ...props.filters.categories, ...changes } });

const selectOnly = ({ categoryId }: { categoryId: string | null }) =>
  emit('update:filters', scopeTo({ filters: props.filters, categoryIds: categoryId ? [categoryId] : [] }));

const transactionsLink = computed<RouteLocationRaw>(() => ({
  name: ROUTES_NAMES.transactions,
  query: {
    start: props.from.toISOString(),
    end: props.to.toISOString(),
    ...toTransactionFilterParams({ filters: props.filters, categories: categories.value, metric: props.metric }),
  },
}));
</script>
