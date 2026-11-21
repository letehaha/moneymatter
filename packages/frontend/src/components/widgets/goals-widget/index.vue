<script setup lang="ts">
import { Button, buttonVariants } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useGoals } from '@/composable/data-queries/goals';
import { cn } from '@/lib/utils';
import GoalLogo from '@/pages/goals/components/goal-logo.vue';
import GoalProgressBar from '@/pages/goals/components/goal-progress-bar.vue';
import { useGoalStatusText } from '@/pages/goals/composables/use-goal-status-text';
import { useGoalsAccess } from '@/pages/goals/composables/use-goals-access';
import { GOAL_DISPLAY_TONES, getGoalDisplayKind, getGoalProgress, splitGoalSections } from '@/pages/goals/helpers';
import { ROUTES_NAMES } from '@/routes/constants';
import type { GoalModel } from '@bt/shared/types';
import { ArrowUpRightIcon, CheckIcon, FlagIcon, LockIcon, SettingsIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import ErrorState from '../components/error-state.vue';
import WidgetWrapper from '../components/widget-wrapper.vue';
import { useWidgetConfigFlag } from '../use-include-planned-config';

defineOptions({ name: 'goals-widget' });

const SKELETON_ROWS = 3;

const { t } = useI18n();
const { formatWholeOrCompactAmount } = useFormatCurrency();
const { statusText, targetDateText } = useGoalStatusText();
const { isPlanGated: isGated } = useGoalsAccess();

const goalsRoute = { name: ROUTES_NAMES.goals };

const { data, isPending, isFetching, isError, refetch } = useGoals();

const {
  widgetConfigRef,
  isOn: showReached,
  setFlag: setShowReached,
} = useWidgetConfigFlag({
  key: 'showReached',
  saveErrorKey: 'errors.api.unexpectedError',
  defaultValue: false,
});

const toRow = ({ goal }: { goal: GoalModel }) => {
  const progress = getGoalProgress({ goal });
  const formatAmount = (amount: number) => formatWholeOrCompactAmount({ amount, currencyCode: goal.currencyCode });
  return {
    goal,
    progress,
    tone: GOAL_DISPLAY_TONES[getGoalDisplayKind({ goal })],
    status: statusText({ goal }),
    timing: targetDateText(goal),
    amounts: t('dashboard.widgets.registry.goals.savedOfTarget', {
      saved: progress ? formatAmount(progress.saved) : '—',
      target: formatAmount(goal.targetAmount),
    }),
  };
};

const groups = computed(() => {
  const { active, ended } = splitGoalSections({ goals: data.value ?? [] });
  return [
    { isEnded: false, rows: active.map((goal) => toRow({ goal })) },
    { isEnded: true, rows: showReached.value ? ended.map((goal) => toRow({ goal })) : [] },
  ].filter((group) => group.rows.length);
});
</script>

<template>
  <WidgetWrapper class="@container max-md:max-h-96" :is-fetching="isFetching" data-testid="widget-goals">
    <template #title>{{ $t('dashboard.widgets.registry.goals.name') }}</template>
    <template #action>
      <DesktopOnlyTooltip :content="$t('common.actions.viewAll')">
        <span class="inline-flex">
          <RouterLink
            :class="buttonVariants({ variant: 'ghost', size: 'icon-sm', class: 'text-muted-foreground' })"
            :to="goalsRoute"
            :aria-label="$t('common.actions.viewAll')"
          >
            <ArrowUpRightIcon class="size-4" />
          </RouterLink>
        </span>
      </DesktopOnlyTooltip>

      <Popover v-if="widgetConfigRef && !isGated">
        <PopoverTrigger as-child>
          <Button size="icon-sm" variant="ghost" :aria-label="$t('common.actions.settings')">
            <SettingsIcon class="text-muted-foreground size-4" />
          </Button>
        </PopoverTrigger>

        <PopoverContent class="w-72 overflow-hidden p-0" align="end">
          <header class="border-b px-3 py-2 text-sm font-medium">
            {{ $t('common.actions.settings') }}
          </header>
          <div class="flex flex-col p-2">
            <div class="flex items-center justify-between gap-2 rounded-md px-2 py-2">
              <span class="text-sm font-medium">{{ $t('dashboard.widgets.registry.goals.settings.showReached') }}</span>
              <Switch
                class="shrink-0"
                :model-value="showReached"
                data-testid="goals-widget-show-reached-switch"
                @update:model-value="(value: boolean) => setShowReached({ value })"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </template>

    <ErrorState v-if="isError" :message="$t('errors.api.unexpectedError')" @retry="refetch" />

    <div v-else-if="isPending" class="grid animate-pulse @xl:grid-cols-2 @xl:gap-x-6" aria-busy="true">
      <div v-for="row in SKELETON_ROWS" :key="row" class="grid gap-2 py-2">
        <div class="flex items-center justify-between gap-3">
          <div class="bg-muted h-4 w-32 rounded" />
          <div class="bg-muted h-4 w-10 rounded" />
        </div>
        <div class="bg-muted h-1.5 rounded-full" />
        <div class="flex items-center justify-between gap-3">
          <div class="bg-muted h-3 w-24 rounded" />
          <div class="bg-muted h-3 w-16 rounded" />
        </div>
      </div>
    </div>

    <div v-else-if="!groups.length" class="flex h-full flex-col items-center justify-center gap-2 text-center">
      <span class="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <LockIcon v-if="isGated" class="size-6" />
        <FlagIcon v-else class="size-6" />
      </span>
      <p class="font-bold">
        {{
          isGated
            ? $t('dashboard.widgets.registry.goals.locked.title')
            : $t('dashboard.widgets.registry.goals.empty.title')
        }}
      </p>
      <p class="text-muted-foreground max-w-64 text-sm">
        {{
          isGated
            ? $t('dashboard.widgets.registry.goals.locked.description')
            : $t('dashboard.widgets.registry.goals.empty.description')
        }}
      </p>
      <RouterLink :class="buttonVariants({ size: 'sm', class: 'mt-1' })" :to="goalsRoute">
        {{
          isGated
            ? $t('dashboard.widgets.registry.goals.locked.action')
            : $t('dashboard.widgets.registry.goals.empty.action')
        }}
      </RouterLink>
    </div>

    <ScrollArea v-else class="-mx-2 min-h-0 flex-1" viewport-class="px-2 md:overscroll-contain-if-scrollable">
      <div v-for="group in groups" :key="group.isEnded ? 'ended' : 'active'">
        <p
          v-if="group.isEnded"
          class="text-muted-foreground after:bg-border/60 mt-2 flex items-center gap-2 py-1 text-xs font-semibold tracking-wide uppercase after:h-px after:flex-1"
        >
          {{ $t('dashboard.widgets.registry.goals.reachedSection') }} · {{ group.rows.length }}
        </p>
        <div class="grid @xl:grid-cols-2 @xl:gap-x-6">
          <RouterLink
            v-for="row in group.rows"
            :key="row.goal.id"
            :to="{ name: ROUTES_NAMES.goalDetails, params: { goalId: row.goal.id } }"
            class="hover:bg-hover border-border/60 -mx-2 block rounded-md border-t px-2 py-2 transition-colors first:border-t-0 @xl:nth-2:border-t-0"
          >
            <span class="flex min-w-0 items-center justify-between gap-3">
              <span class="flex min-w-0 items-center gap-2">
                <GoalLogo :goal="row.goal" class="size-5 rounded-md" />
                <span :class="cn('min-w-0 truncate text-sm font-semibold', group.isEnded && 'text-muted-foreground')">
                  {{ row.goal.name }}
                </span>
                <span v-if="!group.isEnded" class="text-muted-foreground shrink-0 text-xs">{{ row.timing }}</span>
              </span>
              <span
                :class="cn('flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums', row.tone.textClass)"
              >
                <CheckIcon v-if="group.isEnded" class="size-3.5" />
                {{ row.progress ? `${row.progress.percent}%` : '—' }}
              </span>
            </span>

            <GoalProgressBar
              :percent="row.progress?.percent ?? 0"
              :bar-class="row.tone.barClass"
              :aria-label="$t('goals.list.row.saved')"
              class="mt-1.5"
            />

            <span class="text-muted-foreground mt-1 flex justify-between gap-3 text-xs leading-4 tabular-nums">
              <span class="min-w-0 truncate">{{ row.amounts }}</span>
              <span :class="cn('shrink-0 font-semibold', row.tone.textClass)">{{ row.status }}</span>
            </span>
          </RouterLink>
        </div>
      </div>
    </ScrollArea>
  </WidgetWrapper>
</template>
