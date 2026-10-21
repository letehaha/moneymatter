<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore } from '@/stores';
import { FULL_SHARE } from '@bt/shared/goals/goal-math';
import type { GoalModel } from '@bt/shared/types';
import { compact } from 'lodash-es';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useGoalStatusText } from '../composables/use-goal-status-text';
import { GOAL_DISPLAY_TONES, getGoalDisplayKind, getGoalProgress, toGoalCurrency } from '../helpers';
import GoalLogo from './goal-logo.vue';
import GoalProgressBar from './goal-progress-bar.vue';
import { GOAL_ROW_GRID } from './goal-row-grid';
import GoalRowMenu from './goal-row-menu.vue';

const props = defineProps<{ goal: GoalModel; canWrite: boolean }>();
const emit = defineEmits<{ edit: [] }>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount } = useFormatCurrency();
const { statusText: getStatusText, targetDateText } = useGoalStatusText();
const { accountsRecord } = storeToRefs(useAccountsStore());

const formatAmount = (amount: number) => formatWholeOrCompactAmount({ amount, currencyCode: props.goal.currencyCode });

const kind = computed(() => getGoalDisplayKind({ goal: props.goal }));
const tone = computed(() => GOAL_DISPLAY_TONES[kind.value]);
const progress = computed(() => getGoalProgress({ goal: props.goal }));
const isArchived = computed(() => props.goal.status === 'archived');

const statusText = computed(() => getStatusText({ goal: props.goal }));

const accountsText = computed(() => {
  const { accounts } = props.goal;
  const names = accounts.flatMap(({ accountId, sharePercent }) => {
    const name = accountsRecord.value[accountId]?.name;
    if (!name) return [];
    return [sharePercent < FULL_SHARE ? t('goals.list.row.accountShare', { name, share: sharePercent }) : name];
  });
  if (names.length === accounts.length) return names.join(' · ');
  return t('goals.details.accounts.count', { count: accounts.length }, accounts.length);
});

const timingText = computed(() =>
  props.goal.achievedAt
    ? t('goals.list.row.reachedOn', { date: format(new Date(props.goal.achievedAt), 'd MMM yyyy') })
    : targetDateText(props.goal),
);

const neededText = computed(() => {
  const insights = props.goal.insights;
  if (!insights?.neededMonthly || kind.value === 'reached' || isArchived.value) return null;
  return t('goals.list.row.neededMonthly', {
    amount: formatAmount(toGoalCurrency({ amount: insights.neededMonthly, insights })),
  });
});

const desktopCaption = computed(() => compact([accountsText.value, timingText.value, neededText.value]).join(' · '));

const phoneStatusText = computed(() => (kind.value === 'reached' ? timingText.value : statusText.value));

const showStatusPill = computed(() => kind.value !== 'reached' && !isArchived.value);
</script>

<template>
  <div
    :class="
      cn(
        GOAL_ROW_GRID,
        'hover:bg-foreground/5 has-[a:focus-visible]:bg-foreground/5 relative transition-colors',
        isArchived && 'opacity-60',
      )
    "
  >
    <GoalLogo :goal="goal" class="size-8 rounded-lg" />

    <div class="min-w-0">
      <RouterLink
        :to="{ name: ROUTES_NAMES.goalDetails, params: { goalId: goal.id } }"
        class="block truncate font-medium outline-none after:absolute after:inset-0"
      >
        {{ goal.name }}
      </RouterLink>
      <div class="text-muted-foreground mt-0.5 hidden truncate text-xs @2xl/goals:block">
        {{ desktopCaption }}
      </div>
      <div class="text-muted-foreground mt-0.5 truncate text-xs @2xl/goals:hidden">
        <span v-if="progress" :class="cn('font-medium', tone.textClass)">{{ progress.percent }}%</span>
        <template v-if="progress"> · </template>{{ phoneStatusText }}
      </div>
    </div>

    <div class="hidden min-w-0 @2xl/goals:block">
      <div v-if="progress" class="grid gap-1">
        <div class="text-muted-foreground flex justify-between text-sm">
          <span>{{ $t('goals.list.row.saved') }}</span>
          <span :class="cn('font-semibold tabular-nums', tone.textClass)">{{ progress.percent }}%</span>
        </div>
        <GoalProgressBar
          :percent="progress.percent"
          :bar-class="tone.barClass"
          :aria-label="$t('goals.list.row.saved')"
          class="h-1.25"
        />
      </div>
      <span v-else class="text-muted-foreground text-sm">—</span>
    </div>

    <div class="hidden @2xl/goals:block">
      <span
        v-if="showStatusPill"
        :class="cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone.pillClass)"
      >
        {{ statusText }}
      </span>
    </div>

    <div class="text-right whitespace-nowrap tabular-nums">
      <div class="text-sm font-medium">{{ progress ? formatAmount(progress.saved) : '—' }}</div>
      <div class="text-muted-foreground text-xs">
        {{ $t('goals.list.row.ofTarget', { amount: formatAmount(goal.targetAmount) }) }}
      </div>
    </div>

    <GoalRowMenu v-if="canWrite" :goal="goal" class="relative z-10" @edit="emit('edit')" />
    <div v-else />
  </div>
</template>
