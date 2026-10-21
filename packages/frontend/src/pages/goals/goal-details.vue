<script setup lang="ts">
import BackLink from '@/components/common/back-link.vue';
import PageWrapper from '@/components/common/page-wrapper.vue';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import Card from '@/components/lib/ui/card/Card.vue';
import PillTabs from '@/components/lib/ui/pill-tabs/pill-tabs.vue';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { useFormatCurrency } from '@/composable';
import { useGoal, useUpdateGoal } from '@/composable/data-queries/goals';
import { useDateLocale } from '@/composable/use-date-locale';
import { isResourceMissingError } from '@/js/errors';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore } from '@/stores';
import { etaDate } from '@bt/shared/goals/goal-math';
import type { RecordId } from '@bt/shared/types';
import { ArchiveIcon, ArchiveRestoreIcon, PencilIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import DetailAccountsRow from './components/detail-accounts-row.vue';
import DetailAccountsTab from './components/detail-accounts-tab.vue';
import {
  type DetailAccountRow,
  getAccountBreakdown,
  getGoalNeed,
  getPaceValueClass,
} from './components/detail-helpers';
import DetailProgressTab from './components/detail-progress-tab.vue';
import GoalDetailSkeleton from './components/goal-detail-skeleton.vue';
import GoalFormDialog from './components/goal-form-dialog.vue';
import GoalLogo from './components/goal-logo.vue';
import GoalProgressBar from './components/goal-progress-bar.vue';
import GoalRowMenu from './components/goal-row-menu.vue';
import GoalWhatIfTab from './components/goal-what-if-tab.vue';
import { useGoalStatusText } from './composables/use-goal-status-text';
import type { GoalWhatIfApplyValues } from './composables/use-goal-what-if';
import { useGoalsAccess } from './composables/use-goals-access';
import { GOAL_DISPLAY_TONES, getGoalDisplayKind, getGoalProgress, toGoalCurrency } from './helpers';

type TabValue = 'progress' | 'accounts' | 'whatIf';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount } = useFormatCurrency();
const { statusText: getStatusText, targetDateText } = useGoalStatusText();
const { accountsRecord, isAccountsFetched } = storeToRefs(useAccountsStore());
const { canWrite } = useGoalsAccess();
const update = useUpdateGoal();

const goalId = computed(() => route.params.goalId as RecordId);
const { data: goal, isError, error, refetch } = useGoal({ goalId });

const isNotFound = computed(() => isError.value && isResourceMissingError(error.value));

const formatAmount = (amount: number) =>
  formatWholeOrCompactAmount({ amount, currencyCode: goal.value?.currencyCode ?? '' });
const formatMonth = (date: Date) => format(date, 'MMM yyyy');

const kind = computed(() => (goal.value ? getGoalDisplayKind({ goal: goal.value }) : null));
const tone = computed(() => (kind.value ? GOAL_DISPLAY_TONES[kind.value] : null));
const progress = computed(() => (goal.value ? getGoalProgress({ goal: goal.value }) : null));
const isArchived = computed(() => goal.value?.status === 'archived');
const isReached = computed(() => kind.value === 'reached');

const statusText = computed(() => (goal.value ? getStatusText({ goal: goal.value }) : ''));

const accountRows = computed<DetailAccountRow[]>(() => {
  if (!goal.value) return [];
  return getAccountBreakdown({ accounts: goal.value.accounts, insights: goal.value.insights }).map((row) => ({
    ...row,
    account: accountsRecord.value[row.accountId] ?? null,
  }));
});

const caption = computed(() => {
  if (!goal.value) return '';
  const target = formatAmount(goal.value.targetAmount);
  const timing = goal.value.targetDate ? targetDateText(goal.value) : null;
  const accounts = t('goals.details.accounts.count', { count: goal.value.accounts.length }, goal.value.accounts.length);
  return [timing ? `${target} ${timing}` : target, accounts].join(' · ');
});

interface StripCell {
  key: string;
  label: string;
  value: string;
  hint?: string | null;
  valueClass?: string;
  showBar?: boolean;
}

const stripCells = computed<StripCell[]>(() => {
  const current = goal.value;
  if (!current) return [];
  const insights = current.insights;
  const targetCell: StripCell = {
    key: 'target',
    label: t('goals.details.strip.target'),
    value: formatAmount(current.targetAmount),
    hint: current.targetDate ? targetDateText(current) : null,
  };
  const savedCell: StripCell = {
    key: 'saved',
    label: t('goals.details.strip.saved'),
    value: progress.value ? formatAmount(progress.value.saved) : '—',
    hint: progress.value ? `${progress.value.percent}%` : null,
    valueClass: tone.value?.textClass,
    showBar: !!progress.value,
  };

  if (isReached.value && progress.value) {
    const above = progress.value.saved - current.targetAmount;
    return [
      targetCell,
      {
        ...savedCell,
        hint: above > 0 ? t('goals.details.strip.aboveTarget', { amount: formatAmount(above) }) : null,
        showBar: false,
      },
      {
        key: 'reached',
        label: t('goals.details.strip.reached'),
        value: current.achievedAt ? format(new Date(current.achievedAt), 'd MMM yyyy') : '—',
      },
    ];
  }

  const left = toGoalCurrency({ amount: insights?.remaining ?? null, insights });
  const need = insights ? getGoalNeed({ insights }) : null;
  const pace = toGoalCurrency({ amount: insights?.pace ?? null, insights });
  const eta =
    insights && insights.etaMonths !== null
      ? parseISO(etaDate({ today: insights.input.today, etaMonths: insights.etaMonths }))
      : null;
  const perMonth = t('goals.details.perMonth');

  let needHint: string | null = null;
  if (need?.kind === 'monthly') needHint = perMonth;
  else if (need?.kind === 'dueSoon') needHint = t('goals.details.strip.dueInDays', { count: need.days }, need.days);
  else if (need?.kind === 'overdue') needHint = t('goals.details.strip.overdue');
  else if (insights && !current.targetDate) needHint = t('goals.list.row.noDate');

  let paceHint: string | null = null;
  if (pace !== null) {
    paceHint = eta ? `${perMonth} · ${t('goals.details.strip.around', { date: formatMonth(eta) })}` : perMonth;
  } else if (insights) {
    paceHint = t('goals.details.strip.notEnoughHistory');
  }

  return [
    targetCell,
    savedCell,
    { key: 'left', label: t('goals.details.strip.left'), value: left === null ? '—' : formatAmount(left) },
    {
      key: 'needs',
      label: t('goals.details.strip.needs'),
      value: need ? formatAmount(need.amount) : '—',
      hint: needHint,
    },
    {
      key: 'pace',
      label: t('goals.details.strip.pace'),
      value: pace === null ? '—' : formatAmount(pace),
      hint: paceHint,
      valueClass: getPaceValueClass({ pace, need }),
    },
  ];
});

const isOddStrip = computed(() => stripCells.value.length % 2 === 1);

const showWhatIf = computed(() => !!goal.value?.insights && !isReached.value && !isArchived.value);
const activeTab = ref<TabValue>('progress');

watch(showWhatIf, (shown) => {
  if (!shown && activeTab.value === 'whatIf') activeTab.value = 'progress';
});

const tabItems = computed(() => [
  { value: 'progress', label: t('goals.details.tabs.progress') },
  { value: 'accounts', label: t('goals.details.tabs.accounts'), count: goal.value?.accounts.length ?? 0 },
  ...(showWhatIf.value ? [{ value: 'whatIf', label: t('goals.details.tabs.whatIf') }] : []),
]);

const isEditOpen = ref(false);
const whatIfValues = ref<GoalWhatIfApplyValues | null>(null);

const openEditWithWhatIf = (values: GoalWhatIfApplyValues) => {
  whatIfValues.value = values;
  isEditOpen.value = true;
};
watch(isEditOpen, (open) => {
  if (!open) whatIfValues.value = null;
});

const unarchive = () => update.mutate({ goalId: goalId.value, payload: { status: 'active' } });

const handleDeleted = () => router.replace({ name: ROUTES_NAMES.goals });

const chipClass = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';
</script>

<template>
  <PageWrapper>
    <BackLink :to="{ name: ROUTES_NAMES.goals }">{{ $t('goals.details.backToList') }}</BackLink>

    <ResourceNotFound
      v-if="isNotFound"
      :title="$t('goals.details.notFound.title')"
      :description="$t('goals.details.notFound.description')"
      :link-label="$t('goals.details.backToList')"
      :link-to="{ name: ROUTES_NAMES.goals }"
    />

    <div v-else-if="goal && isAccountsFetched" :key="goal.id" class="max-w-5xl">
      <Callout v-if="isError" class="mb-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span>{{ $t('goals.details.staleData') }}</span>
          <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
        </div>
      </Callout>

      <Card class="divide-border @container/goal divide-y overflow-clip">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 @md/goal:px-4">
          <div class="flex min-w-0 items-center gap-3">
            <GoalLogo :goal="goal" class="size-9 rounded-lg" />
            <div class="min-w-0">
              <h1 class="truncate text-lg font-bold @md/goal:text-xl">{{ goal.name }}</h1>
              <p class="text-muted-foreground truncate text-xs">{{ caption }}</p>
            </div>
          </div>

          <span v-if="tone" :class="cn(chipClass, tone.pillClass)">
            <ArchiveIcon v-if="isArchived" class="size-3" />
            {{ statusText }}
          </span>

          <div v-if="canWrite" class="ml-auto flex items-center gap-2">
            <Button v-if="isArchived" variant="outline" size="sm" :disabled="update.isPending.value" @click="unarchive">
              <ArchiveRestoreIcon class="size-4" />
              {{ $t('goals.actions.unarchive') }}
            </Button>
            <Button v-else variant="outline" size="sm" @click="isEditOpen = true">
              <PencilIcon class="size-4" />
              {{ isReached ? $t('goals.details.actions.raiseTarget') : $t('goals.actions.edit') }}
            </Button>

            <GoalRowMenu :goal="goal" variant="header" @edit="isEditOpen = true" @deleted="handleDeleted" />
          </div>
        </div>

        <DetailAccountsRow :goal="goal" :rows="accountRows" :progress="progress" />

        <div class="overflow-hidden">
          <div
            :class="
              cn(
                '-mr-px -mb-px grid grid-cols-2 @md/goal:grid-cols-3',
                stripCells.length === 5 && '@2xl/goal:grid-cols-5',
              )
            "
          >
            <div
              v-for="(cell, index) in stripCells"
              :key="cell.key"
              :class="
                cn(
                  'border-border min-w-0 border-r border-b px-3 py-2 @md/goal:px-4 @md/goal:py-3',
                  isOddStrip && index === stripCells.length - 1 && 'col-span-2',
                  isOddStrip && index === stripCells.length - 1 && stripCells.length === 3 && '@md/goal:col-span-1',
                  isOddStrip && index === stripCells.length - 1 && stripCells.length === 5 && '@2xl/goal:col-span-1',
                )
              "
            >
              <div
                class="text-muted-foreground truncate text-xs font-medium @md/goal:text-sm @md/goal:tracking-wide @md/goal:uppercase"
              >
                {{ cell.label }}
              </div>
              <div class="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
                <span :class="cn('text-base font-bold @md/goal:text-lg', cell.valueClass)">{{ cell.value }}</span>
                <span v-if="cell.hint" class="text-muted-foreground truncate text-xs font-medium">{{ cell.hint }}</span>
              </div>
              <GoalProgressBar
                v-if="cell.showBar && progress && tone"
                :percent="progress.percent"
                :bar-class="tone.barClass"
                :aria-label="cell.label"
                class="mt-1.5"
              />
            </div>
          </div>
        </div>

        <div class="px-3 py-2 @md/goal:px-4">
          <PillTabs v-model="activeTab" :items="tabItems" />
        </div>

        <div>
          <DetailProgressTab v-if="activeTab === 'progress'" :goal="goal" :rows="accountRows" />
          <DetailAccountsTab v-else-if="activeTab === 'accounts'" :goal="goal" :rows="accountRows" />
          <GoalWhatIfTab v-else :goal="goal" @apply="openEditWithWhatIf" />
        </div>
      </Card>

      <GoalFormDialog v-model:open="isEditOpen" :goal="goal" :initial-values="whatIfValues" />
    </div>

    <div v-else-if="isError" class="max-w-5xl">
      <Card>
        <ErrorState :message="$t('goals.details.loadError')" @retry="refetch()" />
      </Card>
    </div>

    <GoalDetailSkeleton v-else />
  </PageWrapper>
</template>
