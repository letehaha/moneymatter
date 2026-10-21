<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { useGoals } from '@/composable/data-queries/goals';
import { cn } from '@/lib/utils';
import type { GoalModel } from '@bt/shared/types';
import { FlagIcon, PlusIcon, SearchIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { GOAL_SECTION_ORDER, type GoalSection, isGoalBehind, splitGoalSections } from '../helpers';
import GoalRow from './goal-row.vue';
import { GOAL_ROW_GRID } from './goal-row-grid';

const SKELETON_SECTIONS = [3, 2];

const SECTION_LABEL_KEYS: Record<GoalSection, string> = {
  active: 'goals.list.sections.active',
  ended: 'goals.list.sections.ended',
  archived: 'goals.list.sections.archived',
};

defineProps<{ canWrite: boolean }>();
const emit = defineEmits<{ create: []; edit: [goal: GoalModel] }>();

const { data, isPending, isError, refetch } = useGoals();

const goals = computed(() => data.value ?? []);

const search = ref('');
const showBehindOnly = ref(false);
const showArchived = ref(false);

const counts = computed(() => ({
  behind: goals.value.filter((goal) => isGoalBehind({ goal })).length,
  archived: goals.value.filter((goal) => goal.status === 'archived').length,
}));

const sections = computed(() => {
  const query = search.value.trim().toLowerCase();
  const matching = goals.value.filter(
    (goal) => (!query || goal.name.toLowerCase().includes(query)) && (!showBehindOnly.value || isGoalBehind({ goal })),
  );
  const bySection = splitGoalSections({ goals: matching });

  return GOAL_SECTION_ORDER.filter((key) => bySection[key].length).map((key) => ({
    key,
    items: bySection[key],
    visible: key === 'archived' && !showArchived.value ? [] : bySection[key],
  }));
});

const isFiltering = computed(() => !!search.value.trim() || showBehindOnly.value);
const hasVisibleRows = computed(() => sections.value.some((section) => section.visible.length > 0));
const hasArchivedMatches = computed(() => sections.value.some((section) => section.key === 'archived'));

const formatCount = (count: number) => (count ? ` · ${count}` : '');

const chipClass = ({ active }: { active: boolean }) =>
  cn(
    'h-7 rounded-full px-3 text-sm font-medium shadow-none',
    active && 'bg-foreground text-background hover:bg-foreground/90',
  );
</script>

<template>
  <Card class="@container/goals overflow-hidden rounded-xl">
    <div class="divide-border divide-y">
      <div class="flex flex-wrap items-center gap-2 px-3 py-2.5 @2xl/goals:px-4">
        <div class="min-w-40 flex-1">
          <InputField
            v-model="search"
            type="search"
            :placeholder="$t('goals.list.searchPlaceholder')"
            :aria-label="$t('goals.list.searchPlaceholder')"
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
            :class="chipClass({ active: !showBehindOnly })"
            :aria-pressed="!showBehindOnly"
            @click="showBehindOnly = false"
          >
            {{ $t('goals.list.filters.all') }}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            :class="chipClass({ active: showBehindOnly })"
            :aria-pressed="showBehindOnly"
            @click="showBehindOnly = true"
          >
            {{ $t('goals.list.filters.behind') }}{{ formatCount(counts.behind) }}
          </Button>
          <Button
            v-if="isPending || counts.archived"
            variant="secondary"
            size="sm"
            :class="chipClass({ active: showArchived })"
            :aria-pressed="showArchived"
            @click="showArchived = !showArchived"
          >
            {{ $t('goals.list.filters.archived') }}{{ formatCount(counts.archived) }}
          </Button>
        </div>
      </div>

      <template v-if="isPending">
        <template v-for="(rowCount, sectionIndex) in SKELETON_SECTIONS" :key="sectionIndex">
          <div class="bg-muted/40 px-4 py-2.5">
            <div class="bg-muted h-3 w-20 animate-pulse rounded" />
          </div>
          <div v-for="row in rowCount" :key="row" :class="cn(GOAL_ROW_GRID, 'animate-pulse')" aria-hidden="true">
            <div class="bg-muted size-8 rounded-lg" />
            <div class="grid gap-1.5">
              <div class="bg-muted h-4 w-2/5 rounded" />
              <div class="bg-muted h-3 w-1/4 rounded" />
            </div>
            <div class="bg-muted hidden h-1.5 rounded-full @2xl/goals:block" />
            <div class="bg-muted hidden h-4.5 w-16 rounded-full @2xl/goals:block" />
            <div class="grid justify-items-end gap-1.5">
              <div class="bg-muted h-4 w-14 rounded" />
              <div class="bg-muted h-3 w-10 rounded" />
            </div>
            <div class="bg-muted mx-auto size-4 rounded" />
          </div>
        </template>
      </template>

      <ErrorState v-else-if="isError" :message="$t('goals.list.loadError')" @retry="refetch()" />

      <div v-else-if="!hasVisibleRows && !isFiltering" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
        <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
          <FlagIcon class="size-5" />
        </div>
        <p class="text-sm font-semibold">{{ $t('goals.list.emptyState.title') }}</p>
        <p class="text-muted-foreground max-w-[42ch] text-sm leading-relaxed">
          {{ $t('goals.list.emptyState.description') }}
        </p>
        <Button v-if="canWrite" size="sm" class="mt-1.5" @click="emit('create')">
          <PlusIcon class="size-4" />
          {{ $t('goals.newGoal') }}
        </Button>
      </div>

      <div v-else-if="!hasVisibleRows" class="grid justify-items-center gap-1.5 px-4 py-7 text-center">
        <div class="bg-muted text-muted-foreground mb-1 grid size-11 place-items-center rounded-full">
          <SearchIcon class="size-5" />
        </div>
        <p class="text-sm font-semibold">
          {{
            search.trim()
              ? $t('goals.list.noMatch.title', { query: search.trim() })
              : $t('goals.list.noMatch.titleNoQuery')
          }}
        </p>
        <p class="text-muted-foreground max-w-[36ch] text-sm leading-relaxed">
          {{ $t('goals.list.noMatch.description') }}
        </p>
        <Button
          v-if="!showArchived && hasArchivedMatches"
          variant="outline"
          size="sm"
          class="mt-1.5"
          @click="showArchived = true"
        >
          {{ $t('goals.list.noMatch.includeArchived') }}
        </Button>
      </div>

      <template v-else>
        <template v-for="section in sections" :key="section.key">
          <Button
            v-if="section.key === 'archived'"
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
            {{ $t(SECTION_LABEL_KEYS.archived) }}
            <span class="font-medium tracking-normal normal-case">
              · {{ section.items.length }} ·
              {{ showArchived ? $t('goals.list.sections.hide') : $t('goals.list.sections.show') }}
            </span>
          </Button>
          <div
            v-else
            class="bg-muted/40 text-muted-foreground flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-[0.08em] uppercase"
          >
            {{ $t(SECTION_LABEL_KEYS[section.key]) }}
            <span class="font-medium tracking-normal normal-case">· {{ section.items.length }}</span>
          </div>

          <GoalRow
            v-for="goal in section.visible"
            :key="goal.id"
            :goal="goal"
            :can-write="canWrite"
            @edit="emit('edit', goal)"
          />
        </template>
      </template>
    </div>
  </Card>
</template>
