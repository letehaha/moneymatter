<script setup lang="ts">
import { setBudgetLineGoal } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { Switch } from '@/components/lib/ui/switch';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import {
  BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY,
  BUDGET_LINE_GOAL_REPEAT_MAX,
  BUDGET_LINE_GOAL_REPEAT_UNITS,
  type BudgetLineGoalBehavior,
  type BudgetLineGoalFrequency,
  type BudgetLineGoalRepeatUnit,
  type BudgetPlanPeriodViewLine,
} from '@bt/shared/types';
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  CalendarSyncIcon,
  InfinityIcon,
  RepeatIcon,
  TargetIcon,
} from '@lucide/vue';
import { parseISO, setDay } from 'date-fns';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useGoalText } from '../composables/use-goal-text';
import {
  GOAL_EDITOR_FREQUENCIES,
  type GoalEditorState,
  type GoalPeriodUnit,
  buildGoalPayload,
  goalEditorFields,
  goalEditorStateFrom,
  goalSummary,
  setGoalFrequency,
  validateGoalEditor,
} from '../helpers';
import DeleteGoalDialog from './delete-goal-dialog.vue';

const FREQUENCY_ICONS: Record<BudgetLineGoalFrequency, typeof TargetIcon> = {
  weekly: CalendarDaysIcon,
  biweekly: CalendarRangeIcon,
  every_period: RepeatIcon,
  yearly: CalendarSyncIcon,
  by_date: CalendarClockIcon,
  open_ended: InfinityIcon,
};
const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

const props = defineProps<{
  planId: string;
  periodId: string;
  unit: GoalPeriodUnit;
  line: BudgetPlanPeriodViewLine;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { format } = useDateLocale();
const { goalText } = useGoalText();

const state = ref<GoalEditorState>(goalEditorStateFrom({ goal: null }));
const showErrors = ref(false);
const isDeleteOpen = ref(false);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    state.value = goalEditorStateFrom({ goal: props.line.goal });
    showErrors.value = false;
  },
  { immediate: true },
);

const isEdit = computed(() => Boolean(props.line.goal));
const fields = computed(() => goalEditorFields({ state: state.value }));
const errors = computed(() => validateGoalEditor({ state: state.value }));
const hasErrors = computed(() => Object.values(errors.value).some(Boolean));
const summary = computed(() => goalSummary({ state: state.value, unit: props.unit }));
const errorFor = ({ key }: { key: keyof typeof errors.value }) =>
  showErrors.value && errors.value[key]
    ? t(errors.value[key], { max: BUDGET_LINE_GOAL_REPEAT_MAX[state.value.repeatUnit] })
    : undefined;

const patch = ({ changes }: { changes: Partial<GoalEditorState> }) => {
  state.value = { ...state.value, ...changes };
};

const frequencyLabel = ({ frequency }: { frequency: BudgetLineGoalFrequency }) =>
  frequency === 'every_period'
    ? t(`budgetPlans.goals.unit.${props.unit}.frequency`)
    : t(`budgetPlans.goals.frequency.${frequency}`);

const amountLabel = computed(() => {
  const { frequency, behavior } = state.value;
  if (behavior === 'reach_balance') return t('budgetPlans.goals.targetBalanceLabel');
  if (behavior === 'refill_up_to') return t('budgetPlans.goals.refillUpToLabel');
  if (frequency === 'by_date') return t('budgetPlans.goals.totalToBudgetLabel');
  if (frequency === 'weekly') return t('budgetPlans.goals.amountEachWeek');
  if (frequency === 'biweekly') return t('budgetPlans.goals.amountEachTwoWeeks');
  if (frequency === 'yearly') return t('budgetPlans.goals.amountEachYear');
  return t(`budgetPlans.goals.unit.${props.unit}.amountEach`);
});

const amountHint = computed(() => {
  const { frequency, behavior } = state.value;
  if (frequency === 'open_ended') return t('budgetPlans.goals.openEndedHint');
  if (behavior === 'refill_up_to') return t('budgetPlans.goals.refillUpToHint');
  if (frequency === 'by_date' && behavior === 'budget_another') return t('budgetPlans.goals.totalToBudgetHint');
  if (frequency === 'yearly') return t(`budgetPlans.goals.unit.${props.unit}.yearlyHint`);
  return null;
});

const anchorLabel = computed(() => {
  if (state.value.frequency === 'biweekly') return t('budgetPlans.goals.firstPaymentDateLabel');
  if (state.value.frequency === 'yearly') return t('budgetPlans.goals.firstDueDateLabel');
  return t('budgetPlans.goals.dueDateLabel');
});

const weekdayOptions = computed(() =>
  WEEKDAYS_MONDAY_FIRST.map((value) => ({ value, label: format(setDay(new Date(), value), 'EEEE') })),
);
const repeatUnitOptions = computed(() =>
  BUDGET_LINE_GOAL_REPEAT_UNITS.map((value) => ({ value, label: t(`budgetPlans.goals.repeatUnits.${value}`) })),
);

const startedLabel = computed(() =>
  props.line.goal ? format(parseISO(props.line.goal.startPeriodStart), 'LLLL yyyy') : '',
);

const setRepeatEvery = ({ value }: { value: string | number | null }) => {
  const parsed = value === null || value === '' ? null : Number(value);
  patch({ changes: { repeatEvery: parsed !== null && Number.isFinite(parsed) ? parsed : null } });
};

const { isPending, mutate } = useInvalidatingMutation({
  mutationFn: setBudgetLineGoal,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.goals.saved',
  errorKey: 'budgetPlans.goals.saveError',
  onSuccess: () => {
    isOpen.value = false;
  },
});

const requestDelete = () => {
  isOpen.value = false;
  isDeleteOpen.value = true;
};

const submit = () => {
  showErrors.value = true;
  if (hasErrors.value || isPending.value) return;
  mutate({
    planId: props.planId,
    lineId: props.line.lineId,
    payload: buildGoalPayload({ state: state.value, periodId: isEdit.value ? undefined : props.periodId }),
  });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-lg">
    <template #title>
      <span class="flex items-center gap-2">
        <TargetIcon class="text-primary-text size-5 shrink-0" />
        {{ isEdit ? $t('budgetPlans.goals.edit') : $t('budgetPlans.goals.create') }}
      </span>
    </template>
    <template #description>{{ line.name }}</template>

    <form id="goal-editor-form" class="grid gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label>{{ $t('budgetPlans.goals.frequencyLabel') }}</Label>
        <div class="grid grid-cols-3 gap-2">
          <Button
            v-for="frequency in GOAL_EDITOR_FREQUENCIES"
            :key="frequency"
            type="button"
            variant="outline"
            :aria-pressed="state.frequency === frequency"
            :class="
              cn(
                'h-auto flex-col gap-1.5 py-3 font-normal whitespace-normal',
                state.frequency === frequency && 'border-primary bg-primary/10 text-primary-text hover:bg-primary/10',
              )
            "
            @click="state = setGoalFrequency({ state, frequency })"
          >
            <component :is="FREQUENCY_ICONS[frequency]" class="size-4" />
            <span class="text-xs">{{ frequencyLabel({ frequency }) }}</span>
          </Button>
        </div>
      </div>

      <div class="grid gap-2">
        <div class="flex items-center justify-between gap-3">
          <Label>{{ $t('budgetPlans.goals.behaviorLabel') }}</Label>
          <DocsLink path="/budgeting/goals/" class="text-xs" />
        </div>
        <RadioGroup
          :model-value="state.behavior"
          @update:model-value="(value) => patch({ changes: { behavior: value as BudgetLineGoalBehavior } })"
        >
          <Label
            v-for="option in BUDGET_LINE_GOAL_BEHAVIORS_BY_FREQUENCY[state.frequency]"
            :key="option"
            :for="`goal-behavior-${option}`"
            :class="
              cn(
                'border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal',
                state.behavior === option && 'border-primary bg-primary/5',
              )
            "
          >
            <RadioGroupItem :id="`goal-behavior-${option}`" :value="option" class="mt-0.5" />
            <span class="grid gap-0.5">
              <span class="text-sm font-medium">{{ $t(`budgetPlans.goals.behavior.${option}`) }}</span>
              <span class="text-muted-foreground text-xs">
                {{ $t(`budgetPlans.goals.behaviorDescription.${option}`) }}
              </span>
            </span>
          </Label>
        </RadioGroup>
      </div>

      <div class="grid gap-1">
        <FormattedAmountField
          :model-value="state.amount"
          class="[&_input]:text-right"
          :label="amountLabel"
          :placeholder="$t('budgetPlans.goals.amountPlaceholder')"
          :error-message="errorFor({ key: 'amount' })"
          @update:model-value="(value) => patch({ changes: { amount: value } })"
        />
        <p v-if="amountHint" class="text-muted-foreground text-xs">{{ amountHint }}</p>
      </div>

      <SelectField
        v-if="fields.weekday"
        :model-value="weekdayOptions.find((option) => option.value === state.weekday) ?? null"
        :values="weekdayOptions"
        label-key="label"
        value-key="value"
        :label="$t('budgetPlans.goals.repeatsOnLabel')"
        :placeholder="$t('budgetPlans.goals.weekdayPlaceholder')"
        @update:model-value="(option) => option && patch({ changes: { weekday: option.value } })"
      />

      <div v-if="fields.anchorDate" class="grid gap-1">
        <DateField
          :model-value="state.anchorDate ?? undefined"
          mode="date"
          :label="anchorLabel"
          :error-message="errorFor({ key: 'anchorDate' })"
          @update:model-value="(value) => patch({ changes: { anchorDate: value } })"
        />
        <p v-if="state.frequency === 'yearly'" class="text-muted-foreground text-xs">
          {{ $t('budgetPlans.goals.firstDueDateHint') }}
        </p>
      </div>

      <div v-if="fields.repeat" class="grid gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-0.5">
            <Label for="goal-repeat">{{ $t('budgetPlans.goals.repeatLabel') }}</Label>
            <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.goals.repeatHint') }}</p>
          </div>
          <Switch
            id="goal-repeat"
            :model-value="state.repeats"
            @update:model-value="(value: boolean) => patch({ changes: { repeats: value } })"
          />
        </div>
        <div v-if="state.repeats" class="grid grid-cols-2 gap-3">
          <InputField
            type="number"
            :model-value="state.repeatEvery"
            :label="$t('budgetPlans.goals.repeatEveryLabel')"
            :placeholder="$t('budgetPlans.goals.repeatEveryPlaceholder')"
            :error-message="errorFor({ key: 'repeatEvery' })"
            @update:model-value="setRepeatEvery({ value: $event })"
          />
          <SelectField
            :model-value="repeatUnitOptions.find((option) => option.value === state.repeatUnit) ?? null"
            :values="repeatUnitOptions"
            label-key="label"
            value-key="value"
            :label="$t('budgetPlans.goals.repeatUnitLabel')"
            :placeholder="$t('budgetPlans.goals.repeatUnitPlaceholder')"
            @update:model-value="
              (option) => option && patch({ changes: { repeatUnit: option.value as BudgetLineGoalRepeatUnit } })
            "
          />
        </div>
      </div>

      <div v-if="fields.stopAtBalance" class="grid gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-0.5">
            <Label for="goal-stop-at-balance">{{ $t('budgetPlans.goals.stopAtBalanceLabel') }}</Label>
            <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.goals.stopAtBalanceHint') }}</p>
          </div>
          <Switch
            id="goal-stop-at-balance"
            :model-value="state.hasStopAtBalance"
            @update:model-value="(value: boolean) => patch({ changes: { hasStopAtBalance: value } })"
          />
        </div>
        <FormattedAmountField
          v-if="state.hasStopAtBalance"
          :model-value="state.stopAtBalance"
          class="[&_input]:text-right"
          :placeholder="$t('budgetPlans.goals.amountPlaceholder')"
          :error-message="errorFor({ key: 'stopAtBalance' })"
          @update:model-value="(value) => patch({ changes: { stopAtBalance: value } })"
        />
      </div>

      <div v-if="fields.fundingCap" class="grid gap-3">
        <div class="flex items-center justify-between gap-3">
          <Label for="goal-funding-cap">{{ $t(`budgetPlans.goals.unit.${unit}.fundingCap`) }}</Label>
          <Switch
            id="goal-funding-cap"
            :model-value="state.hasFundingCap"
            @update:model-value="(value: boolean) => patch({ changes: { hasFundingCap: value } })"
          />
        </div>
        <FormattedAmountField
          v-if="state.hasFundingCap"
          :model-value="state.fundingCap"
          class="[&_input]:text-right"
          :placeholder="$t('budgetPlans.goals.amountPlaceholder')"
          :error-message="errorFor({ key: 'fundingCap' })"
          @update:model-value="(value) => patch({ changes: { fundingCap: value } })"
        />
      </div>

      <div v-if="isEdit" class="flex items-center justify-between gap-3 text-sm">
        <span class="text-muted-foreground">{{ $t('budgetPlans.goals.startedLabel') }}</span>
        <span class="font-medium capitalize">{{ startedLabel }}</span>
      </div>

      <p v-if="summary" class="border-border bg-muted/40 rounded-lg border p-3 text-sm">
        {{ goalText({ part: summary }) }}
      </p>
    </form>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
        <Button v-if="isEdit" variant="ghost-destructive" :disabled="isPending" @click="requestDelete">
          {{ $t('budgetPlans.goals.delete') }}
        </Button>
        <div class="ml-auto flex gap-2">
          <Button variant="outline" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
          <Button type="submit" form="goal-editor-form" :disabled="isPending">
            {{ $t('common.actions.save') }}
          </Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>

  <DeleteGoalDialog v-model:open="isDeleteOpen" :plan-id="planId" :line="line" />
</template>
