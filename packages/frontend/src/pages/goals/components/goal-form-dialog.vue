<script setup lang="ts">
import {
  ALL_LOGO_TABS,
  type LogoSelection,
  pickLogoFields,
  toLogoPatch,
  toLogoSelection,
  toOptionalLogoPayload,
} from '@/components/common/logo-selection';
import AccountLogo from '@/components/common/account-logo.vue';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import FieldError from '@/components/fields/components/field-error.vue';
import DateField from '@/components/fields/date-field.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { Switch } from '@/components/lib/ui/switch';
import { useCurrencyName, useFormatCurrency } from '@/composable';
import { useCreateGoal, useGoals, useUpdateGoal } from '@/composable/data-queries/goals';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { API_ERROR_CODES, type CurrencyModel, GOAL_NAME_MAX_LENGTH, type GoalModel } from '@bt/shared/types';
import { PencilIcon, PlusIcon } from '@lucide/vue';
import { startOfTomorrow } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { GoalWhatIfApplyValues } from '../composables/use-goal-what-if';
import {
  type GoalFormErrors,
  type GoalFormServerError,
  type GoalFormState,
  buildGoalPayload,
  getGoalFormServerError,
  getGoalFormSummary,
  goalFormStateFrom,
  sumCountedAmount,
  validateGoalForm,
} from '../form-helpers';
import GoalAccountsDialog from './goal-accounts-dialog.vue';
import GoalLogo from './goal-logo.vue';

const SILENT_ERROR_CODES = [API_ERROR_CODES.goalShareCapacityExceeded, API_ERROR_CODES.goalCurrencyRateUnavailable];
const EMPTY_LOGO_FIELDS = pickLogoFields({});

const props = defineProps<{ goal?: GoalModel; initialValues?: GoalWhatIfApplyValues | null }>();
const open = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { format } = useDateLocale();
const { formatAmountByCurrencyCode, formatBaseCurrency } = useFormatCurrency();
const { formatCurrencyLabel } = useCurrencyName();
const { accountsRecord } = storeToRefs(useAccountsStore());
const { baseCurrency, systemCurrenciesVerbose } = storeToRefs(useCurrenciesStore());
const { refetch: refetchGoals } = useGoals();
const createMutation = useCreateGoal({ silentErrorCodes: SILENT_ERROR_CODES });
const updateMutation = useUpdateGoal({ silentErrorCodes: SILENT_ERROR_CODES });

const formId = useId();
const plannedMonthlyId = useId();
const baseCurrencyCode = computed(() => baseCurrency.value?.currencyCode ?? '');

const state = ref<GoalFormState>(goalFormStateFrom({ baseCurrencyCode: baseCurrencyCode.value }));
const storedLogo = ref<LogoSelection | null>(null);
const logo = ref<LogoSelection | null>(null);
const showErrors = ref(false);
const serverError = ref<GoalFormServerError | null>(null);
const isAccountsOpen = ref(false);

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    state.value = goalFormStateFrom({
      goal: props.goal,
      initialValues: props.initialValues,
      baseCurrencyCode: baseCurrencyCode.value,
    });
    storedLogo.value = props.goal ? toLogoSelection(props.goal) : null;
    logo.value = storedLogo.value;
    showErrors.value = false;
    serverError.value = null;
  },
  { immediate: true },
);

const isPending = computed(() => createMutation.isPending.value || updateMutation.isPending.value);

const errors = computed(() => validateGoalForm({ state: state.value, storedTargetDate: props.goal?.targetDate }));
const hasErrors = computed(() => Object.values(errors.value).some(Boolean));
const errorFor = (key: keyof GoalFormErrors) =>
  showErrors.value && errors.value[key] ? t(errors.value[key]!) : undefined;

const currencyError = computed(() =>
  serverError.value?.field === 'currencyCode' && serverError.value.currencyCode === state.value.currencyCode
    ? (serverError.value.message ?? t('goals.details.noRate.title'))
    : undefined,
);

const accountsError = computed(() => {
  const required = errorFor('accounts');
  if (required) return required;
  if (serverError.value?.field !== 'accounts') return undefined;
  const { details } = serverError.value;
  if (!details) return t('goals.form.errors.shareCapacityGeneric');
  return t('goals.form.errors.shareCapacity', { account: details.accountName, free: details.free });
});

const selectedCurrency = computed(
  () => systemCurrenciesVerbose.value.linked.find((item) => item.code === state.value.currencyCode) ?? null,
);
const currencyLabel = (item: CurrencyModel) => formatCurrencyLabel({ code: item.code, fallbackName: item.currency });

const selectedShares = computed(() =>
  state.value.accounts.map((share) => ({
    ...share,
    account: accountsRecord.value[share.accountId],
  })),
);
const missingAccountsCount = computed(() => selectedShares.value.filter((share) => !share.account).length);

const countedBase = computed(() =>
  sumCountedAmount({ shares: state.value.accounts, accountsById: accountsRecord.value }),
);

const rateToBase = computed(() => {
  if (state.value.currencyCode === baseCurrencyCode.value) return 1;
  const { goal } = props;
  return goal?.insights && goal.currencyCode === state.value.currencyCode ? goal.insights.rateToBase : null;
});

const summaryText = computed(() => {
  const summary = getGoalFormSummary({
    state: state.value,
    counted: rateToBase.value === null ? null : countedBase.value / rateToBase.value,
  });
  if (!summary) return null;

  const formatAmount = (amount: number) => formatAmountByCurrencyCode(amount, state.value.currencyCode);
  const target = formatAmount(state.value.targetAmount!);
  const { targetDate, hasPlannedMonthly, plannedMonthly } = state.value;
  const sentences = [
    targetDate
      ? t('goals.form.summary.dated', { target, date: format(targetDate, 'd MMM yyyy') })
      : t('goals.form.summary.undated', { target }),
  ];
  if (summary.isCovered) sentences.push(t('goals.form.summary.covered'));
  else if (summary.neededMonthly !== null) {
    sentences.push(t('goals.form.summary.needed', { amount: formatAmount(summary.neededMonthly) }));
  }
  if (hasPlannedMonthly && plannedMonthly) {
    sentences.push(t('goals.form.summary.planned', { amount: formatAmount(plannedMonthly) }));
  }
  return sentences.join(' ');
});

const onAccountsChange = (shares: GoalFormState['accounts']) => {
  state.value.accounts = shares;
  if (serverError.value?.field === 'accounts') serverError.value = null;
};

const submit = async () => {
  showErrors.value = true;
  if (hasErrors.value || isPending.value) return;

  serverError.value = null;
  const fields = buildGoalPayload({ state: state.value });

  try {
    if (props.goal) {
      await updateMutation.mutateAsync({
        goalId: props.goal.id,
        payload: { ...fields, ...toLogoPatch({ selection: logo.value, stored: storedLogo.value }) },
      });
    } else {
      await createMutation.mutateAsync({
        payload: { ...fields, ...toOptionalLogoPayload({ selection: logo.value }) },
      });
    }
    open.value = false;
  } catch (error) {
    serverError.value = getGoalFormServerError({ error, currencyCode: fields.currencyCode });
    // Another goal claimed the share meanwhile; fresh goals bring the "N% free" hints up to date.
    if (serverError.value?.field === 'accounts') refetchGoals();
  }
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="sm:max-w-lg">
    <template #title>{{ goal ? $t('goals.form.editTitle') : $t('goals.form.createTitle') }}</template>
    <template #description>{{ $t('goals.form.description') }}</template>

    <form :id="formId" class="@container/goal-form grid gap-4" @submit.prevent="submit">
      <div class="flex items-start gap-3">
        <LogoSquareField
          v-model="logo"
          :name-for-search="state.name"
          :reset-label="$t('common.logo.remove')"
          :tabs="ALL_LOGO_TABS"
          :disabled="isPending"
          align="with-labeled-field"
        >
          <template #placeholder>
            <GoalLogo :goal="{ name: state.name, ...EMPTY_LOGO_FIELDS }" class="size-10 rounded-lg" />
          </template>
        </LogoSquareField>
        <div class="min-w-0 flex-1">
          <InputField
            v-model="state.name"
            :label="$t('goals.form.nameLabel')"
            :placeholder="$t('goals.form.namePlaceholder')"
            :maxlength="GOAL_NAME_MAX_LENGTH"
            :error-message="errorFor('name')"
            :disabled="isPending"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 items-start gap-3 @sm/goal-form:grid-cols-2">
        <FormattedAmountField
          v-model="state.targetAmount"
          :label="$t('goals.form.targetAmountLabel')"
          :placeholder="$t('goals.form.targetAmountPlaceholder')"
          :error-message="errorFor('targetAmount')"
          :disabled="isPending"
        />
        <SelectField
          :model-value="selectedCurrency"
          :values="systemCurrenciesVerbose.linked"
          :label-key="currencyLabel"
          value-key="code"
          :label="$t('goals.form.currencyLabel')"
          :placeholder="$t('goals.form.currencyPlaceholder')"
          :error-message="currencyError"
          :disabled="isPending"
          @update:model-value="(item) => item && (state.currencyCode = item.code)"
        />
      </div>

      <div class="grid gap-1.5">
        <DateField
          :model-value="state.targetDate ?? undefined"
          :calendar-options="{ minDate: startOfTomorrow() }"
          mode="date"
          :label="$t('goals.form.targetDateLabel')"
          :error-message="errorFor('targetDate')"
          :disabled="isPending"
          clearable
          @update:model-value="(value: Date | undefined) => (state.targetDate = value ?? null)"
          @clear="state.targetDate = null"
        />
        <p class="text-muted-foreground text-xs">{{ $t('goals.form.targetDateHint') }}</p>
      </div>

      <div class="grid gap-1.5">
        <span class="text-sm font-medium">{{ $t('goals.form.accountsLabel') }}</span>
        <div
          :class="
            cn(
              'border-input bg-input-background grid gap-3 rounded-md border p-3',
              accountsError && 'border-destructive',
            )
          "
        >
          <div v-if="selectedShares.length" class="flex flex-wrap gap-1.5">
            <span
              v-for="share in selectedShares"
              :key="share.accountId"
              class="bg-muted inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-1 text-sm"
            >
              <AccountLogo v-if="share.account" :account="share.account" class="size-5 shrink-0 rounded-full" />
              <span v-if="share.account" class="truncate">{{ share.account.name }}</span>
              <span v-else class="text-warning-text truncate">{{ $t('goals.form.unavailableAccount') }}</span>
              <span class="text-muted-foreground tabular-nums">{{ share.sharePercent }}%</span>
            </span>
          </div>
          <p v-else class="text-muted-foreground text-sm">{{ $t('goals.form.noAccounts') }}</p>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <i18n-t
              v-if="selectedShares.length"
              keypath="goals.form.countsNow"
              tag="span"
              class="text-muted-foreground text-sm"
            >
              <template #amount>
                <span class="text-foreground font-medium tabular-nums">{{ formatBaseCurrency(countedBase) }}</span>
              </template>
            </i18n-t>
            <span v-if="missingAccountsCount" class="text-warning-text text-sm">
              {{ $t('goals.form.accountsMissing', { count: missingAccountsCount }, missingAccountsCount) }}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="ml-auto"
              aria-haspopup="dialog"
              :disabled="isPending"
              @click="isAccountsOpen = true"
            >
              <PencilIcon v-if="selectedShares.length" class="size-4" />
              <PlusIcon v-else class="size-4" />
              {{ selectedShares.length ? $t('goals.form.manageAccounts') : $t('goals.form.addAccounts') }}
            </Button>
          </div>
        </div>
        <FieldError :error-message="accountsError" />
        <p class="text-muted-foreground text-xs">{{ $t('goals.form.accountsHint') }}</p>
      </div>

      <div class="grid gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-0.5">
            <Label :for="plannedMonthlyId">{{ $t('goals.form.plannedMonthlyLabel') }}</Label>
            <p class="text-muted-foreground text-xs">{{ $t('goals.form.plannedMonthlyHint') }}</p>
          </div>
          <Switch
            :id="plannedMonthlyId"
            :model-value="state.hasPlannedMonthly"
            :disabled="isPending"
            @update:model-value="(value: boolean) => (state.hasPlannedMonthly = value)"
          />
        </div>
        <FormattedAmountField
          v-if="state.hasPlannedMonthly"
          v-model="state.plannedMonthly"
          :placeholder="$t('goals.form.plannedMonthlyPlaceholder')"
          :aria-label="$t('goals.form.plannedMonthlyLabel')"
          :error-message="errorFor('plannedMonthly')"
          :disabled="isPending"
        />
      </div>

      <p v-if="summaryText" class="border-border bg-muted/40 rounded-lg border p-3 text-sm">{{ summaryText }}</p>
    </form>

    <GoalAccountsDialog
      v-model:open="isAccountsOpen"
      :goal-name="state.name.trim() || $t('goals.form.thisGoal')"
      :model-value="state.accounts"
      :editing-goal-id="goal?.id"
      @update:model-value="onAccountsChange"
    />

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <Button variant="outline" :disabled="isPending" @click="open = false">
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button type="submit" :form="formId" :disabled="isPending">
          <template v-if="isPending">{{ $t('common.actions.saving') }}</template>
          <template v-else>{{ goal ? $t('common.actions.saveChanges') : $t('goals.form.createSubmit') }}</template>
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
