<script setup lang="ts">
import GoalProgressBar from '@/pages/goals/components/goal-progress-bar.vue';
import type { ChatGoalProgress, ChatGoalProgressChange } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatVisualValue } from '../visuals/format-visual-value';

const props = defineProps<{ change: ChatGoalProgressChange }>();

const { t } = useI18n();

/** Where the goal stands and where the call leaves it. A new goal has no "now", a deleted one no "after". */
const rows = computed(() => {
  const { before, after } = props.change;
  const both = before !== null && after !== null;

  return [
    ...(before
      ? [{ key: 'before', label: both ? t('chat.cards.goal.now') : t('chat.cards.goal.progress'), progress: before }]
      : []),
    ...(after
      ? [{ key: 'after', label: both ? t('chat.cards.goal.after') : t('chat.cards.goal.progress'), progress: after }]
      : []),
  ];
});

const amountText = ({ progress }: { progress: ChatGoalProgress }) => {
  const money = (value: number) => formatVisualValue({ value, kind: 'money', currencyCode: progress.currencyCode });
  const target = money(progress.targetAmount);

  return progress.currentValue === null
    ? target
    : t('chat.cards.goal.of', { value: money(progress.currentValue), target });
};

const summaryText = ({ progress }: { progress: ChatGoalProgress }) =>
  progress.percent === null ? amountText({ progress }) : `${amountText({ progress })} (${progress.percent}%)`;

const percentOf = ({ progress }: { progress: ChatGoalProgress }) => progress.percent ?? 0;
</script>

<template>
  <section class="bg-muted/40 flex flex-col gap-2 rounded-md px-3 py-2" data-testid="goal-progress">
    <div v-for="row in rows" :key="row.key" class="flex flex-col gap-1" :data-testid="`goal-progress-${row.key}`">
      <div class="flex items-baseline justify-between gap-3 text-xs">
        <span class="text-muted-foreground shrink-0 font-medium">{{ row.label }}</span>
        <span class="min-w-0 text-right text-sm wrap-anywhere" data-testid="goal-progress-amount">
          {{ summaryText({ progress: row.progress }) }}
        </span>
      </div>
      <GoalProgressBar :percent="percentOf({ progress: row.progress })" bar-class="bg-primary" />
      <p class="text-muted-foreground text-right text-xs" data-testid="goal-progress-status">
        {{ $t(`chat.cards.goal.status.${row.progress.status}`) }}
      </p>
    </div>
  </section>
</template>
