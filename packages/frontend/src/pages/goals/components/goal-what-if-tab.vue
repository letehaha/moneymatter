<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Slider } from '@/components/lib/ui/slider';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import { FULL_SHARE, accountGoalValue, etaDate, roundShare } from '@bt/shared/goals/goal-math';
import type { GoalModel, GoalProgress, RecordId } from '@bt/shared/types';
import { parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useGoalStatusText } from '../composables/use-goal-status-text';
import {
  type GoalWhatIfApplyValues,
  type GoalWithInsights,
  getImpliedDeposits,
  useGoalWhatIf,
} from '../composables/use-goal-what-if';
import { useGoalsAccess } from '../composables/use-goals-access';
import { parseNumberOrNull, toDateKey } from '../form-helpers';
import { GOAL_DISPLAY_TONES, getGoalProgress, getScheduleOffset, toGoalCurrency } from '../helpers';

const COMPARE_GRID =
  'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-x-3 px-3 @sm/what-if:grid-cols-[minmax(0,1fr)_7rem_7rem]';

const props = defineProps<{ goal: GoalModel }>();
const emit = defineEmits<{ apply: [values: GoalWhatIfApplyValues] }>();

const { t, locale } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount, getCurrencySymbol } = useFormatCurrency();
const { accountsRecord } = storeToRefs(useAccountsStore());
const { canWrite } = useGoalsAccess();
const { statusText } = useGoalStatusText();

// The details page renders this tab only for goals with insights.
const goal = computed(() => props.goal as GoalWithInsights);
const insights = computed(() => goal.value.insights);

const { edits, whatIf, isDirty, reset, shareCapacity, isOverMax, hasShareError, setShare, sliderRange, applyValues } =
  useGoalWhatIf({ goal });

const formatAmount = (amount: number) => formatWholeOrCompactAmount({ amount, currencyCode: goal.value.currencyCode });
const accountName = (accountId: RecordId) =>
  accountsRecord.value[accountId]?.name ?? t('common.transactions.record.hiddenAccount');

const currencySymbol = computed(() => getCurrencySymbol(goal.value.currencyCode));
const today = computed(() => parseISO(insights.value.input.today));

const autoMonthly = computed(() => toGoalCurrency({ amount: whatIf.value.historicalPace, insights: insights.value }));
const autoHint = computed(() =>
  autoMonthly.value === null
    ? t('goals.whatIf.monthly.noAuto')
    : t('goals.whatIf.monthly.autoHint', {
        amount: formatAmount(autoMonthly.value),
        count: whatIf.value.historyMonths,
      }),
);

const targetDateValue = computed(() => (edits.value.targetDate ? parseISO(edits.value.targetDate) : undefined));

const shareRows = computed(() =>
  insights.value.input.accounts.map((account) => {
    const capacity = shareCapacity({ accountId: account.accountId });
    const share = Math.min(edits.value.shares[account.accountId] ?? 0, capacity?.max ?? FULL_SHARE);
    const countedBase = accountGoalValue({
      balance: account.currentBalance,
      creditLimit: account.creditLimit,
      sharePercent: share,
    });
    const counted = formatAmount(toGoalCurrency({ amount: countedBase, insights: insights.value }));
    let caption = t('goals.accountsDialog.counts', { amount: counted });
    if (share === FULL_SHARE) caption = t('goals.whatIf.shares.whole', { amount: counted });
    else if (capacity) {
      caption = t('goals.whatIf.shares.free', { free: Math.max(0, roundShare(capacity.max - share)), amount: counted });
    }
    return {
      accountId: account.accountId,
      account: accountsRecord.value[account.accountId],
      name: accountName(account.accountId),
      balance: toGoalCurrency({ amount: account.currentBalance, insights: insights.value }),
      max: capacity?.max ?? null,
      error:
        capacity && isOverMax({ accountId: account.accountId })
          ? t('goals.accountsDialog.errors.overMax', { max: capacity.max })
          : undefined,
      caption,
    };
  }),
);
const isCapacityPending = computed(() => shareRows.value.some((row) => row.max === null));

const countedTotal = computed(() => {
  const progress = getGoalProgress({
    goal: { targetAmount: goal.value.targetAmount, insights: { ...insights.value, ...whatIf.value } },
  })!;
  return t('goals.whatIf.shares.counted', { amount: formatAmount(progress.saved), percent: progress.percent });
});

type CompareCell = { text: string; class?: string; isAuto?: boolean };

const describeColumn = ({
  progress,
  monthly,
  todayKey,
}: {
  progress: GoalProgress;
  monthly: number | null;
  todayKey: string;
}) => {
  const toneClass = GOAL_DISPLAY_TONES[progress.status].textClass;
  const pace = monthly ?? toGoalCurrency({ amount: progress.historicalPace, insights: insights.value });
  const offset = getScheduleOffset({ progress });

  let reached = '—';
  if (progress.status === 'reached') reached = t('goals.whatIf.compare.reachedAlready');
  else if (progress.etaMonths !== null) {
    reached = format(parseISO(etaDate({ today: todayKey, etaMonths: progress.etaMonths })), 'MMM yyyy');
  }

  const needed = toGoalCurrency({ amount: progress.neededMonthly, insights: insights.value });

  return {
    monthly: { text: pace === null ? '—' : formatAmount(pace), isAuto: monthly === null && pace !== null },
    reached: { text: reached, class: toneClass },
    against: {
      text: offset
        ? t(`goals.whatIf.compare.offset.${offset.kind}`, { count: offset.months }, offset.months)
        : statusText({ progress, today: todayKey }),
      class: toneClass,
    },
    needed: { text: needed === null ? '—' : formatAmount(needed) },
  } satisfies Record<string, CompareCell>;
};

const compareRows = computed(() => {
  const todayKey = insights.value.input.today;
  const now = describeColumn({ progress: insights.value, monthly: goal.value.plannedMonthly, todayKey });
  const next = describeColumn({ progress: whatIf.value, monthly: edits.value.monthly, todayKey });
  return (
    [
      ['monthly', 'goals.whatIf.compare.monthly'],
      ['reached', 'goals.whatIf.compare.reached'],
      ['against', 'goals.whatIf.compare.against'],
      ['needed', 'goals.whatIf.compare.needed'],
    ] as const
  ).map(([key, labelKey]) => ({
    key,
    label: t(labelKey),
    now: now[key] as CompareCell,
    next: next[key] as CompareCell,
  }));
});

const depositText = computed(() => {
  const monthly = edits.value.monthly ?? autoMonthly.value;
  if (!monthly || monthly <= 0 || !applyValues.value.accounts.length) return null;

  const listFormat = new Intl.ListFormat(locale.value, { type: 'disjunction' });
  const deposits = getImpliedDeposits({ monthly, accounts: applyValues.value.accounts }).map(({ accountId, deposit }) =>
    t('goals.whatIf.deposit.item', { amount: formatAmount(deposit), account: accountName(accountId) }),
  );
  return t('goals.whatIf.deposit.sentence', { amount: formatAmount(monthly), deposits: listFormat.format(deposits) });
});
</script>

<template>
  <div class="border-border @container/what-if border-t tabular-nums">
    <div class="grid @2xl/what-if:grid-cols-2">
      <div class="grid min-w-0 content-start gap-4 p-4">
        <div class="grid gap-2">
          <InputField
            :model-value="edits.monthly"
            type="number"
            only-positive
            :label="$t('goals.whatIf.monthly.label')"
            :placeholder="$t('goals.whatIf.monthly.placeholder')"
            @update:model-value="edits.monthly = parseNumberOrNull($event)"
          >
            <template v-if="autoMonthly !== null" #label-right>
              <span>{{ $t('goals.whatIf.monthly.auto', { amount: formatAmount(autoMonthly) }) }}</span>
            </template>
            <template #iconLeading>
              <span class="text-muted-foreground text-sm">{{ currencySymbol }}</span>
            </template>
          </InputField>
          <Slider
            :model-value="Math.max(0, edits.monthly ?? autoMonthly ?? 0)"
            :max="sliderRange.max"
            :step="sliderRange.step"
            :aria-label="$t('goals.whatIf.monthly.label')"
            class="mt-1"
            @update:model-value="edits.monthly = $event"
          />
          <div class="text-muted-foreground flex items-baseline justify-between gap-2 text-xs">
            <span>{{ autoHint }}</span>
            <Button
              v-if="edits.monthly !== null && autoMonthly !== null"
              variant="link"
              size="sm"
              class="h-auto shrink-0 p-0"
              @click="edits.monthly = null"
            >
              {{ $t('goals.whatIf.monthly.useAuto') }}
            </Button>
          </div>
        </div>

        <div class="grid gap-1.5">
          <DateField
            :model-value="targetDateValue"
            mode="date"
            clearable
            :label="$t('goals.whatIf.targetDate.label')"
            :calendar-options="{ minDate: today }"
            @update:model-value="edits.targetDate = toDateKey($event)"
            @clear="edits.targetDate = null"
          />
          <p class="text-muted-foreground text-xs">{{ $t('goals.whatIf.targetDate.hint') }}</p>
        </div>

        <div v-if="shareRows.length" class="grid gap-2">
          <div class="text-muted-foreground flex justify-between gap-2 text-sm font-medium">
            <span>{{ $t('goals.whatIf.shares.label') }}</span>
            <span>{{ countedTotal }}</span>
          </div>
          <div class="border-input divide-border divide-y overflow-hidden rounded-md border">
            <div
              v-for="row in shareRows"
              :key="row.accountId"
              class="grid grid-cols-[2rem_minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1 px-3 py-2.5"
            >
              <AccountLogo v-if="row.account" :account="row.account" class="size-8" />
              <div v-else class="bg-muted size-8 rounded-lg" />
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">{{ row.name }}</div>
                <div class="text-muted-foreground text-xs">{{ formatAmount(row.balance) }}</div>
              </div>
              <InputField
                :model-value="edits.shares[row.accountId]"
                type="number"
                only-positive
                :max="row.max ?? undefined"
                :disabled="row.max === null"
                :error-message="row.error"
                :aria-label="$t('goals.whatIf.shares.inputLabel', { name: row.name })"
                :placeholder="$t('goals.whatIf.shares.placeholder')"
                trailing-icon-css-class="px-3"
                @update:model-value="setShare({ accountId: row.accountId, value: parseNumberOrNull($event) })"
              >
                <template #iconTrailing>
                  <span class="text-muted-foreground text-sm">%</span>
                </template>
              </InputField>
              <p class="text-muted-foreground col-span-2 col-start-2 text-xs">{{ row.caption }}</p>
            </div>
          </div>
          <p v-if="isCapacityPending" class="text-muted-foreground text-xs">
            {{ $t('goals.whatIf.shares.capacityPending') }}
          </p>
        </div>
      </div>

      <div
        class="border-border grid min-w-0 content-start gap-3 border-t p-4 @2xl/what-if:border-t-0 @2xl/what-if:border-l"
      >
        <h3 class="flex items-baseline gap-2 text-sm font-bold">
          {{ $t('goals.whatIf.compare.title') }}
          <span class="text-muted-foreground ml-auto font-medium">
            {{ $t('goals.whatIf.compare.from', { date: format(today, 'MMM yyyy') }) }}
          </span>
        </h3>
        <div class="border-border overflow-hidden rounded-md border text-sm">
          <div
            :class="cn(COMPARE_GRID, 'text-muted-foreground py-2 text-xs font-medium tracking-wider uppercase')"
            aria-hidden="true"
          >
            <span />
            <span class="text-right">{{ $t('goals.whatIf.compare.now') }}</span>
            <span class="text-right">{{ $t('goals.whatIf.compare.whatIf') }}</span>
          </div>
          <div v-for="row in compareRows" :key="row.key" :class="cn(COMPARE_GRID, 'border-border border-t py-2.5')">
            <span class="text-muted-foreground">{{ row.label }}</span>
            <span :class="cn('text-right', row.now.class)">
              {{ row.now.text }}
              <span v-if="row.now.isAuto" class="text-muted-foreground text-xs">{{ $t('goals.whatIf.autoTag') }}</span>
            </span>
            <span :class="cn('text-right font-semibold', row.next.class)">
              {{ row.next.text }}
              <span v-if="row.next.isAuto" class="text-muted-foreground text-xs font-normal">
                {{ $t('goals.whatIf.autoTag') }}
              </span>
            </span>
          </div>
        </div>
        <p v-if="depositText" class="text-muted-foreground text-sm">{{ depositText }}</p>
      </div>
    </div>

    <div
      class="bg-card/95 border-border sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t px-4 py-3 backdrop-blur"
    >
      <span class="text-muted-foreground basis-full text-sm @lg/what-if:basis-auto">
        {{ $t('goals.whatIf.sandboxHint') }}
      </span>
      <div class="ml-auto flex gap-2">
        <Button variant="outline" :disabled="!isDirty" @click="reset">{{ $t('goals.whatIf.reset') }}</Button>
        <Button v-if="canWrite" :disabled="!isDirty || hasShareError" @click="emit('apply', applyValues)">
          {{ $t('goals.whatIf.apply') }}
        </Button>
      </div>
    </div>
  </div>
</template>
