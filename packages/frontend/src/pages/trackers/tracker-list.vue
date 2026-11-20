<script setup lang="ts">
import { loadTrackerStats, loadTrackers } from '@/api/trackers';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { cn } from '@/lib/utils';
import type { TrackerModel } from '@bt/shared/types';
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
  data: trackersList,
  isPending,
  isError,
  refetch,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.trackersList, 'active,archived'],
  queryFn: () => loadTrackers({ status: 'active,archived' }),
  staleTime: Infinity,
});

const trackers = computed(() => trackersList.value ?? []);

const search = ref('');
const typeFilter = ref<'all' | 'autoAdd' | 'handPicked'>('all');
const matchesTypeFilter = ({ tracker }: { tracker: TrackerModel }) =>
  typeFilter.value === 'all' || tracker.rulesEnabled === (typeFilter.value === 'autoAdd');
const showArchived = ref(false);
const showAllEnded = ref(false);

const groupedAll = computed(() => trackers.value.map((tracker) => ({ tracker, group: getTrackerGroup({ tracker }) })));

const counts = computed(() => {
  const live = groupedAll.value.filter(({ group }) => group !== 'archived');
  return {
    autoAdd: live.filter(({ tracker }) => tracker.rulesEnabled).length,
    handPicked: live.filter(({ tracker }) => !tracker.rulesEnabled).length,
    archived: groupedAll.value.length - live.length,
  };
});

const groups = computed(() => {
  const query = search.value.trim().toLowerCase();
  const byGroup = new Map<TrackerGroup, TrackerModel[]>();
  for (const { tracker, group } of groupedAll.value) {
    if (!matchesTypeFilter({ tracker })) continue;
    if (query && !tracker.name.toLowerCase().includes(query)) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), tracker]);
  }
  const endTime = (tracker: TrackerModel) => parseTrackerDate(tracker.endDate)?.getTime() ?? 0;
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

const visibleTrackers = computed(() => groups.value.flatMap((group) => group.visible));

const statsQueries = useQueries({
  queries: computed(() =>
    visibleTrackers.value.map((tracker) => ({
      queryKey: [...VUE_QUERY_CACHE_KEYS.trackerStats, tracker.id],
      queryFn: () => loadTrackerStats({ trackerId: tracker.id }),
      staleTime: Infinity,
    })),
  ),
});

const statsById = computed(
  () => new Map(visibleTrackers.value.map((tracker, index) => [tracker.id, statsQueries.value[index]] as const)),
);

const hasVisibleRows = computed(() => groups.value.some((group) => group.visible.length > 0));
const hasArchivedMatches = computed(() => groups.value.some((group) => group.key === 'archived'));

const formatCount = (count: number) => (count ? ` · ${count}` : '');

const archivePromptTracker = ref<TrackerModel | null>(null);
const isArchivePromptOpen = ref(false);
const openArchivePrompt = ({ tracker }: { tracker: TrackerModel }) => {
  archivePromptTracker.value = tracker;
  isArchivePromptOpen.value = true;
};

const chipClass = ({ active }: { active: boolean }) =>
  cn(
    'h-7 rounded-full px-3 text-sm font-medium shadow-none',
    active && 'bg-foreground text-background hover:bg-foreground/90',
  );
</script>

<template>
  <Card class="@container/trackers overflow-hidden rounded-xl">
    <div class="divide-border divide-y">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 @2xl/trackers:px-4">
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
            :class="chipClass({ active: typeFilter === 'autoAdd' })"
            :aria-pressed="typeFilter === 'autoAdd'"
            @click="typeFilter = 'autoAdd'"
          >
            {{ $t('budgets.list.filters.autoAdd') }}{{ formatCount(counts.autoAdd) }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :class="chipClass({ active: typeFilter === 'handPicked' })"
            :aria-pressed="typeFilter === 'handPicked'"
            @click="typeFilter = 'handPicked'"
          >
            {{ $t('budgets.list.filters.handPicked') }}{{ formatCount(counts.handPicked) }}
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
          <div class="bg-muted/40 px-4 py-2.5">
            <div class="bg-muted h-3 w-20 animate-pulse rounded" />
          </div>
          <div v-for="row in rowCount" :key="row" :class="cn(TRACKER_ROW_GRID, 'animate-pulse')" aria-hidden="true">
            <div class="bg-muted size-8 rounded-lg" />
            <div class="grid gap-1.5">
              <div class="bg-muted h-4 w-2/5 rounded" />
              <div class="bg-muted h-3 w-1/4 rounded" />
            </div>
            <div class="bg-muted hidden h-1.5 rounded-full @2xl/trackers:block" />
            <div class="bg-muted hidden h-4.5 w-16 rounded-full @2xl/trackers:block" />
            <div class="bg-muted ml-auto h-4 w-14 rounded" />
            <div class="bg-muted mx-auto size-4 rounded" />
          </div>
        </template>
      </template>

      <ErrorState v-else-if="isError" :message="$t('budgets.list.loadError')" @retry="refetch()" />

      <div v-else-if="!trackers.length" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
        <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
          <TargetIcon class="size-5" />
        </div>
        <p class="text-sm font-semibold">{{ $t('budgets.list.emptyState.title') }}</p>
        <p class="text-muted-foreground max-w-[36ch] text-sm leading-relaxed">
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
        <p class="text-muted-foreground max-w-[36ch] text-sm leading-relaxed">
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
                'bg-muted/40 text-muted-foreground hover:bg-muted/60 h-auto w-full justify-start gap-2 rounded-none px-4 py-2 text-xs font-bold tracking-[0.08em] uppercase',
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
            class="bg-muted/40 text-muted-foreground flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-[0.08em] uppercase"
          >
            {{ $t(GROUP_LABEL_KEYS[group.key]) }}
            <span class="font-medium tracking-normal normal-case">· {{ group.items.length }}</span>
          </div>

          <TrackerRow
            v-for="tracker in group.visible"
            :key="tracker.id"
            :tracker="tracker"
            :stats="statsById.get(tracker.id)?.data?.summary ?? null"
            :is-stats-loading="statsById.get(tracker.id)?.isPending ?? true"
            :is-stats-error="statsById.get(tracker.id)?.isError ?? false"
            @suggest-archive="openArchivePrompt({ tracker })"
          />

          <div v-if="group.hiddenCount > 0" class="flex justify-center px-4 py-1.5">
            <Button variant="ghost" size="sm" class="text-muted-foreground" @click="showAllEnded = true">
              {{ $t('budgets.list.showMoreEnded', { count: group.hiddenCount }) }}
            </Button>
          </div>
        </template>
      </template>
    </div>

    <ArchivePromptDialog v-model:open="isArchivePromptOpen" :tracker="archivePromptTracker" />
  </Card>
</template>
