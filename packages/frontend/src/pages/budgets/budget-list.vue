<script setup lang="ts">
import { loadBudgetStats, loadSystemBudgets } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { cn } from '@/lib/utils';
import { BUDGET_TYPES, type BudgetModel } from '@bt/shared/types';
import { PlusIcon, SearchIcon, TargetIcon } from '@lucide/vue';
import { useQueries, useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';

import ArchivePromptDialog from './components/archive-prompt-dialog.vue';
import TrackerRow from './components/tracker-row.vue';
import { TRACKER_ROW_GRID } from './components/tracker-row-grid';
import { TRACKER_GROUP_ORDER, type TrackerGroup, getTrackerGroup, parseTrackerDate } from './tracker-time-status';

const VISIBLE_ENDED_ROWS = 3;
const SKELETON_GROUPS = [2, 3];

const GROUP_LABEL_KEYS: Record<TrackerGroup, string> = {
  active: 'budgets.list.groups.active',
  upcoming: 'budgets.list.groups.upcoming',
  noDates: 'budgets.list.groups.noDates',
  ended: 'budgets.list.groups.ended',
  archived: 'budgets.list.groups.archived',
};

const emit = defineEmits<{ create: [] }>();

const {
  data: budgetsList,
  isPending,
  isError,
  refetch,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetsList, 'active,archived'],
  queryFn: () => loadSystemBudgets({ status: 'active,archived' }),
  staleTime: Infinity,
});

const budgets = computed(() => budgetsList.value ?? []);

const search = ref('');
const typeFilter = ref<'all' | BUDGET_TYPES>('all');
const showArchived = ref(false);
const showAllEnded = ref(false);

const groupedAll = computed(() => budgets.value.map((budget) => ({ budget, group: getTrackerGroup({ budget }) })));

const counts = computed(() => {
  const live = groupedAll.value.filter(({ group }) => group !== 'archived');
  return {
    manual: live.filter(({ budget }) => budget.type === BUDGET_TYPES.manual).length,
    category: live.filter(({ budget }) => budget.type === BUDGET_TYPES.category).length,
    archived: groupedAll.value.length - live.length,
  };
});

const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  const byGroup = new Map<TrackerGroup, BudgetModel[]>();
  for (const { budget, group } of groupedAll.value) {
    if (typeFilter.value !== 'all' && budget.type !== typeFilter.value) continue;
    if (query && !budget.name.toLowerCase().includes(query)) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), budget]);
  }
  const endTime = (budget: BudgetModel) => parseTrackerDate(budget.endDate)?.getTime() ?? 0;
  byGroup.get('ended')?.sort((a, b) => endTime(b) - endTime(a));

  return TRACKER_GROUP_ORDER.flatMap((key) => {
    const items = byGroup.get(key) ?? [];
    if (!items.length) return [];
    let visible = items;
    if (key === 'archived' && !showArchived.value) visible = [];
    if (key === 'ended' && !showAllEnded.value) visible = items.slice(0, VISIBLE_ENDED_ROWS);
    return [{ key, items, visible, hiddenCount: key === 'ended' ? items.length - visible.length : 0 }];
  });
});

const visibleBudgets = computed(() => groups.value.flatMap((group) => group.visible));

const statsQueries = useQueries({
  queries: computed(() =>
    visibleBudgets.value.map((budget) => ({
      queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, budget.id],
      queryFn: () => loadBudgetStats({ budgetId: budget.id }),
      staleTime: Infinity,
    })),
  ),
});

const statsById = computed(
  () => new Map(visibleBudgets.value.map((budget, index) => [budget.id, statsQueries.value[index]] as const)),
);

const hasVisibleRows = computed(() => groups.value.some((group) => group.visible.length > 0));
const hasArchivedMatches = computed(() => groups.value.some((group) => group.key === 'archived'));

const formatCount = (count: number) => (count ? ` · ${count}` : '');

const archivePromptBudget = ref<BudgetModel | null>(null);
const isArchivePromptOpen = ref(false);
const openArchivePrompt = ({ budget }: { budget: BudgetModel }) => {
  archivePromptBudget.value = budget;
  isArchivePromptOpen.value = true;
};

const chipClass = ({ active }: { active: boolean }) =>
  cn(
    'h-6 rounded-full px-2.5 text-[11px] font-semibold shadow-none',
    active && 'bg-foreground text-background hover:bg-foreground/90',
  );
</script>

<template>
  <Card class="@container/trackers overflow-hidden rounded-xl">
    <div class="divide-border divide-y">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 @2xl/trackers:px-3.5">
        <div class="min-w-40 flex-1">
          <InputField
            v-model="search"
            type="search"
            :placeholder="$t('budgets.list.searchPlaceholder')"
            :aria-label="$t('budgets.list.searchPlaceholder')"
          >
            <template #iconLeading>
              <SearchIcon class="text-muted-foreground size-4" />
            </template>
          </InputField>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            :class="chipClass({ active: typeFilter === 'all' })"
            :aria-pressed="typeFilter === 'all'"
            @click="typeFilter = 'all'"
          >
            {{ $t('budgets.list.filters.all') }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :class="chipClass({ active: typeFilter === BUDGET_TYPES.manual })"
            :aria-pressed="typeFilter === BUDGET_TYPES.manual"
            @click="typeFilter = BUDGET_TYPES.manual"
          >
            {{ $t('budgets.list.filters.manual') }}{{ formatCount(counts.manual) }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :class="chipClass({ active: typeFilter === BUDGET_TYPES.category })"
            :aria-pressed="typeFilter === BUDGET_TYPES.category"
            @click="typeFilter = BUDGET_TYPES.category"
          >
            {{ $t('budgets.list.filters.category') }}{{ formatCount(counts.category) }}
          </Button>
          <Button
            v-if="isPending || counts.archived"
            variant="secondary"
            size="sm"
            :class="chipClass({ active: showArchived })"
            :aria-pressed="showArchived"
            @click="showArchived = !showArchived"
          >
            {{ $t('budgets.list.filters.archived') }}{{ formatCount(counts.archived) }}
          </Button>
        </div>
      </div>

      <template v-if="isPending">
        <template v-for="(rowCount, groupIndex) in SKELETON_GROUPS" :key="groupIndex">
          <div class="bg-muted/40 px-3.5 py-2.5">
            <div class="bg-muted h-2.5 w-20 animate-pulse rounded" />
          </div>
          <div v-for="row in rowCount" :key="row" :class="cn(TRACKER_ROW_GRID, 'animate-pulse')" aria-hidden="true">
            <div class="bg-muted size-7 rounded-[7px]" />
            <div class="grid gap-1.5">
              <div class="bg-muted h-3 w-2/5 rounded" />
              <div class="bg-muted h-2.5 w-1/4 rounded" />
            </div>
            <div class="bg-muted hidden h-1.5 rounded-full @2xl/trackers:block" />
            <div class="bg-muted hidden h-4.5 w-16 rounded-full @2xl/trackers:block" />
            <div class="bg-muted ml-auto h-3 w-14 rounded" />
            <div class="bg-muted mx-auto size-4 rounded" />
          </div>
        </template>
      </template>

      <ErrorState v-else-if="isError" :message="$t('budgets.list.loadError')" @retry="refetch()" />

      <div v-else-if="!budgets.length" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
        <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
          <TargetIcon class="size-5" />
        </div>
        <p class="text-sm font-semibold">{{ $t('budgets.list.emptyState.title') }}</p>
        <p class="text-muted-foreground max-w-[36ch] text-xs leading-relaxed">
          {{ $t('budgets.list.emptyState.description') }}
        </p>
        <Button size="sm" class="mt-1.5" @click="emit('create')">
          <PlusIcon class="size-4" />
          {{ $t('budgets.newBudget') }}
        </Button>
      </div>

      <div v-else-if="!hasVisibleRows" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
        <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
          <SearchIcon class="size-5" />
        </div>
        <p class="text-sm font-semibold">
          {{
            search.trim()
              ? $t('budgets.list.noMatch.title', { query: search.trim() })
              : $t('budgets.list.noMatch.titleNoQuery')
          }}
        </p>
        <p class="text-muted-foreground max-w-[36ch] text-xs leading-relaxed">
          {{ $t('budgets.list.noMatch.description') }}
        </p>
        <Button
          v-if="!showArchived && hasArchivedMatches"
          variant="outline"
          size="sm"
          class="mt-1.5"
          @click="showArchived = true"
        >
          {{ $t('budgets.list.noMatch.includeArchived') }}
        </Button>
      </div>

      <template v-else>
        <template v-for="group in groups" :key="group.key">
          <Button
            v-if="group.key === 'archived'"
            variant="ghost"
            :class="
              cn(
                'bg-muted/40 text-muted-foreground hover:bg-muted/60 h-auto w-full justify-start gap-2 rounded-none px-3.5 py-2 text-[11px] font-bold tracking-[0.08em] uppercase',
                !showArchived && 'opacity-60',
              )
            "
            :aria-expanded="showArchived"
            @click="showArchived = !showArchived"
          >
            {{ $t(GROUP_LABEL_KEYS.archived) }}
            <span class="font-medium tracking-normal normal-case">
              · {{ group.items.length }} ·
              {{ showArchived ? $t('budgets.list.groups.hide') : $t('budgets.list.groups.show') }}
            </span>
          </Button>
          <div
            v-else
            class="bg-muted/40 text-muted-foreground flex items-center gap-2 px-3.5 py-2 text-[11px] font-bold tracking-[0.08em] uppercase"
          >
            {{ $t(GROUP_LABEL_KEYS[group.key]) }}
            <span class="font-medium tracking-normal normal-case">· {{ group.items.length }}</span>
          </div>

          <TrackerRow
            v-for="budget in group.visible"
            :key="budget.id"
            :budget="budget"
            :stats="statsById.get(budget.id)?.data?.summary ?? null"
            :is-stats-loading="statsById.get(budget.id)?.isPending ?? true"
            :is-stats-error="statsById.get(budget.id)?.isError ?? false"
            @suggest-archive="openArchivePrompt({ budget })"
          />

          <div v-if="group.hiddenCount > 0" class="flex justify-center px-3.5 py-1.5">
            <Button variant="ghost" size="sm" class="text-muted-foreground" @click="showAllEnded = true">
              {{ $t('budgets.list.showMoreEnded', { count: group.hiddenCount }) }}
            </Button>
          </div>
        </template>
      </template>
    </div>

    <ArchivePromptDialog v-model:open="isArchivePromptOpen" :budget="archivePromptBudget" />
  </Card>
</template>
