<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { MIN_HISTORY_MONTHS, etaDate } from '@bt/shared/goals/goal-math';
import type { GoalModel } from '@bt/shared/types';
import { CircleOffIcon, InfoIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { compact } from 'lodash-es';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { MARKET_CATEGORIES, getScheduleOffset, toGoalCurrency } from '../helpers';
import {
  type DetailAccountRow,
  type GoalNeed,
  getGoalHistory,
  getGoalNeed,
  getHistorySummary,
  getPaceValueClass,
  getProjection,
} from './detail-helpers';
import DetailNoAccounts from './detail-no-accounts.vue';
import DetailTimelineChart from './detail-timeline-chart.vue';

const props = defineProps<{ goal: GoalModel; rows: DetailAccountRow[] }>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount, formatSignedWholeOrCompactAmount } = useFormatCurrency();

const formatAmount = (amount: number) => formatWholeOrCompactAmount({ amount, currencyCode: props.goal.currencyCode });
const formatSigned = (amount: number) =>
  formatSignedWholeOrCompactAmount({ amount, currencyCode: props.goal.currencyCode });
const formatMonth = (date: Date) => format(date, 'MMM yyyy');

const isReached = computed(() => props.goal.insights?.status === 'reached');
const history = computed(() => (props.goal.insights ? getGoalHistory({ insights: props.goal.insights }) : []));
const projection = computed(() => (props.goal.insights ? getProjection({ insights: props.goal.insights }) : []));
const summary = computed(() => getHistorySummary({ history: history.value }));

interface KpiCell {
  key: string;
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
  valueClass?: string;
}

const needText = ({ need }: { need: GoalNeed | null }) => {
  if (!need) return undefined;
  const amount = formatAmount(need.amount);
  if (need.kind === 'overdue') return t('goals.details.progress.kpi.leftOverdue', { amount });
  if (need.kind === 'dueSoon') {
    return t('goals.details.progress.kpi.leftDueInDays', { amount, count: need.days }, need.days);
  }
  return t('goals.details.progress.kpi.needs', { amount });
};

const kpis = computed<KpiCell[]>(() => {
  const insights = props.goal.insights;
  if (!insights) return [];

  const pace = toGoalCurrency({ amount: insights.pace, insights });
  const need = getGoalNeed({ insights });
  const eta =
    insights.etaMonths === null
      ? null
      : parseISO(etaDate({ today: insights.input.today, etaMonths: insights.etaMonths }));
  const schedule = getScheduleOffset({ progress: insights });
  const year = summary.value;

  let scheduleText: string | undefined;
  if (schedule) {
    scheduleText =
      schedule.kind === 'onTime'
        ? t('goals.details.progress.kpi.onTime')
        : t(`goals.details.progress.kpi.${schedule.kind}`, { count: schedule.months }, schedule.months);
  }

  return [
    {
      key: 'pace',
      label: t('goals.details.progress.kpi.monthlyPace'),
      value: pace === null ? '—' : formatAmount(pace),
      suffix: pace === null ? undefined : t('goals.details.perMonth'),
      sub: needText({ need }),
      valueClass: getPaceValueClass({ pace, need }),
    },
    {
      key: 'finish',
      label: t('goals.details.progress.kpi.projectedFinish'),
      value: eta ? formatMonth(eta) : '—',
      suffix: scheduleText,
      sub: props.goal.targetDate
        ? t('goals.details.progress.kpi.targetDate', { date: formatMonth(parseISO(props.goal.targetDate)) })
        : t('goals.list.row.noDate'),
      valueClass: schedule?.kind === 'late' ? 'text-warning-text' : undefined,
    },
    {
      key: 'gain',
      label: t('goals.details.progress.kpi.savedIn', { count: history.value.length - 1 }, history.value.length - 1),
      value: year ? formatSigned(year.gain) : '—',
      suffix:
        year?.gainPercent == null ? undefined : `${year.gainPercent > 0 ? '+' : ''}${Math.round(year.gainPercent)}%`,
      sub: year ? `${formatMonth(year.from)} – ${formatMonth(year.to)}` : undefined,
      valueClass: year && year.gain < 0 ? 'text-destructive-text' : undefined,
    },
    {
      key: 'best',
      label: t('goals.details.progress.kpi.bestMonth'),
      value: year?.best?.change ? formatAmount(year.best.change) : '—',
      suffix: year?.best ? formatMonth(year.best.date) : undefined,
      sub:
        year?.bestShareOfGain == null
          ? undefined
          : t('goals.details.progress.kpi.shareOfGrowth', { percent: Math.round(year.bestShareOfGain) }),
    },
  ];
});

const timelineCaption = computed(() => {
  const first = history.value[0];
  const last = projection.value.at(-1) ?? history.value.at(-1);
  return first && last ? `${formatMonth(first.date)} – ${formatMonth(last.date)}` : '';
});

const isInsufficientHistory = computed(() => {
  const insights = props.goal.insights;
  return !!insights && !isReached.value && insights.pace === null;
});

const notes = computed(() => {
  const insights = props.goal.insights;
  if (!insights) return [];

  let basis: string | null = null;
  if (!isReached.value && !isInsufficientHistory.value) {
    basis =
      props.goal.plannedMonthly !== null
        ? t('goals.details.progress.notes.plannedPace', { amount: formatAmount(props.goal.plannedMonthly) })
        : t('goals.details.progress.notes.historyPace', { count: insights.historyMonths }, insights.historyMonths);
  }

  const hasFxDrift = props.rows.some((row) => row.account && row.account.currencyCode !== insights.baseCurrencyCode);
  const hasMarketAccounts = props.rows.some(
    (row) => row.account && MARKET_CATEGORIES.includes(row.account.accountCategory),
  );

  return compact([
    isReached.value && t('goals.details.progress.notes.staysReached'),
    basis,
    hasFxDrift && t('goals.details.progress.notes.fxDrift'),
    hasMarketAccounts && t('goals.details.progress.notes.marketMoves'),
  ]);
});
</script>

<template>
  <div v-if="!goal.insights" class="flex flex-col items-center px-4 py-12 text-center">
    <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
      <CircleOffIcon class="text-muted-foreground size-6" />
    </div>
    <h3 class="mb-2 text-lg font-semibold">{{ $t('goals.details.noRate.title') }}</h3>
    <p class="text-muted-foreground max-w-md text-sm">
      {{ $t('goals.details.noRate.description', { currency: goal.currencyCode }) }}
    </p>
  </div>

  <DetailNoAccounts v-else-if="goal.insights.status === 'no_accounts'" />

  <div v-else class="@container/stats overflow-hidden tabular-nums">
    <div v-if="!isReached" class="bg-border grid grid-cols-1 gap-px border-b @md/stats:grid-cols-4">
      <div
        v-for="kpi in kpis"
        :key="kpi.key"
        class="bg-card flex min-w-0 items-baseline justify-between gap-3 px-4 py-2.5 @md/stats:block @md/stats:py-3"
      >
        <div
          class="text-muted-foreground min-w-0 truncate text-xs font-medium @md/stats:text-sm @md/stats:tracking-wide @md/stats:uppercase"
        >
          {{ kpi.label }}
        </div>
        <div class="flex shrink-0 flex-wrap items-baseline justify-end gap-x-1.5 @md/stats:block">
          <div :class="cn('truncate text-base font-bold @md/stats:mt-0.5 @md/stats:text-xl', kpi.valueClass)">
            {{ kpi.value }}
            <small v-if="kpi.suffix" class="text-muted-foreground ml-1 text-sm font-medium">{{ kpi.suffix }}</small>
          </div>
          <div v-if="kpi.sub" class="text-muted-foreground hidden truncate text-sm @sm/stats:block @md/stats:mt-0.5">
            <span class="@md/stats:hidden">· </span>{{ kpi.sub }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="isInsufficientHistory" class="px-4 pt-4">
      <Callout variant="info" :title="$t('goals.details.progress.insufficient.title')">
        {{
          $t('goals.details.progress.insufficient.description', {
            count: goal.insights.historyMonths,
            min: MIN_HISTORY_MONTHS,
          })
        }}
      </Callout>
    </div>

    <section class="p-4">
      <h3 class="mb-2.5 flex items-baseline gap-2 text-sm font-bold">
        {{ $t('goals.details.progress.timeline') }}
        <span class="text-muted-foreground ml-auto truncate text-sm font-medium">{{ timelineCaption }}</span>
      </h3>
      <DetailTimelineChart
        v-if="history.length"
        :history="history"
        :projection="projection"
        :target="goal.targetAmount"
        :currency-code="goal.currencyCode"
      />
      <p v-else class="text-muted-foreground py-12 text-center text-sm">
        {{ $t('goals.details.progress.noHistory') }}
      </p>
    </section>

    <ul v-if="notes.length" class="text-muted-foreground grid gap-1.5 border-t px-4 py-3 text-sm">
      <li v-for="note in notes" :key="note" class="flex items-start gap-2">
        <InfoIcon class="mt-0.5 size-4 shrink-0" />
        <span>{{ note }}</span>
      </li>
    </ul>
  </div>
</template>
