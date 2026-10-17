<script setup lang="ts">
import { createBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import DocsLink from '@/components/common/docs-link.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { useNotificationCenter } from '@/components/notification-center';
import { ArrowRightIcon, InfoIcon, LoaderCircleIcon } from '@lucide/vue';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { Switch } from '@/components/lib/ui/switch';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useIsAiUsageExitPage } from '@/composable/use-close-dialog-when';
import { useDateLocale } from '@/composable/use-date-locale';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useUserStore } from '@/stores';
import { BUDGET_PLAN_MAX_INTERVAL_N, type BudgetPlanCarryPolicy, type BudgetSuggestionAnswers } from '@bt/shared/types';
import { endOfDay, isAfter, isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  BUDGET_CADENCE_PRESETS,
  BUDGET_CUSTOM_CADENCE_UNITS,
  type BudgetCadencePreset,
  type BudgetCustomCadenceUnit,
  CARRY_POLICY_OPTIONS,
  buildCreatePlanPayload,
  isAttachableAccount,
  isValidCustomInterval,
  BUDGET_POOL_ENABLED,
} from '../helpers';
import SuggestionWizard from './suggestion-wizard.vue';

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const { addInfoNotification, addWarningNotification } = useNotificationCenter();
const router = useRouter();
const { activeAccounts, isAccountsFetched, isAccountsError } = storeToRefs(useAccountsStore());
const userStore = useUserStore();
const { locale } = useDateLocale();
const isExitPage = useIsAiUsageExitPage();
const { isReached } = useAiAllowance();
const isAiReached = computed(() => isReached());

const preset = ref<BudgetCadencePreset>('monthly');
const customUnit = ref<BudgetCustomCadenceUnit>('days');
const customEvery = ref<number | null>(null);
const editedStartsOn = ref<Date>();
const accountIds = ref<string[]>([]);
const carryPolicy = ref<BudgetPlanCarryPolicy>('floor');
const poolEnabled = ref(false);
const withSuggestedLines = ref(true);
const askQuestions = ref(true);
const isAskingQuestions = ref(false);
const opensQuestions = computed(() => withSuggestedLines.value && askQuestions.value && !isAiReached.value);

const startsOn = computed(() => {
  if (editedStartsOn.value) return editedStartsOn.value;
  const today = new Date();
  const isMonthBased =
    preset.value === 'monthly' ||
    preset.value === 'semiMonthly' ||
    (preset.value === 'custom' && customUnit.value === 'months');
  return isMonthBased
    ? startOfMonth(today)
    : startOfWeek(today, {
        weekStartsOn: locale.value.options?.weekStartsOn ?? 1,
      });
});

// DateField emits every model change back, so only a different day counts as a user edit.
const setStartsOn = ({ value }: { value: Date }) => {
  if (!isSameDay(value, startsOn.value)) editedStartsOn.value = value;
};

const eligibleAccountIds = computed(() =>
  activeAccounts.value.filter((account) => isAttachableAccount({ account })).map((account) => account.id),
);
const hasNoEligibleAccounts = computed(
  () => isAccountsFetched.value && !isAccountsError.value && eligibleAccountIds.value.length === 0,
);

watch([isOpen, isAccountsFetched], ([open], [wasOpen]) => {
  if (!open) return;
  if (!wasOpen) {
    editedStartsOn.value = undefined;
    isAskingQuestions.value = false;
  }
  accountIds.value = eligibleAccountIds.value;
});

const presetItems = computed(() =>
  BUDGET_CADENCE_PRESETS.map((value) => ({
    value,
    label: t(`budgetPlans.cadence.${value}`),
  })),
);

const customUnitOptions = computed(() =>
  BUDGET_CUSTOM_CADENCE_UNITS.map((value) => ({ value, label: t(`budgetPlans.create.customUnits.${value}`) })),
);

const setCustomEvery = ({ value }: { value: string | number | null }) => {
  const parsed = value === null || value === '' ? null : Number(value);
  customEvery.value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
};

const isCustomValid = computed(
  () => preset.value !== 'custom' || isValidCustomInterval({ unit: customUnit.value, every: customEvery.value }),
);
const customEveryError = computed(() =>
  customEvery.value !== null && !isCustomValid.value
    ? t('budgetPlans.create.customEveryError', { max: BUDGET_PLAN_MAX_INTERVAL_N[customUnit.value] })
    : undefined,
);

const { isPending, mutate } = useInvalidatingMutation({
  mutationFn: createBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  invalidateOnSettleKeys: [VUE_QUERY_CACHE_KEYS.aiFeaturesStatus],
  successKey: 'budgetPlans.create.success',
  errorKey: 'budgetPlans.create.error',
  onSuccess: () => {
    isOpen.value = false;
    // The first plan starts the early adopter budget trial, which the user payload carries.
    userStore.loadUser().catch((error) =>
      captureException({
        error,
        context: { scope: 'create-plan:user-refresh' },
      }),
    );
  },
});

const isSubmitDisabled = computed(
  () =>
    isPending.value ||
    accountIds.value.length === 0 ||
    !isCustomValid.value ||
    isAfter(startsOn.value, endOfDay(new Date())),
);

const create = ({ answers }: { answers?: BudgetSuggestionAnswers } = {}) => {
  if (isSubmitDisabled.value) return;
  mutate(
    {
      payload: {
        ...buildCreatePlanPayload({
          name: t('budgetPlans.defaultName'),
          preset: preset.value,
          custom: customEvery.value === null ? undefined : { unit: customUnit.value, every: customEvery.value },
          startsOn: startsOn.value,
          accountIds: accountIds.value,
          carryPolicy: carryPolicy.value,
          withSuggestedLines: withSuggestedLines.value,
        }),
        poolEnabled: poolEnabled.value,
        suggestionAnswers: answers,
      },
    },
    {
      onSuccess: ({ plan, suggestedLinesFailed, suggestionAnswersIgnored }) => {
        if (suggestedLinesFailed) addWarningNotification(t('budgetPlans.create.suggestedLinesFailed'));
        if (suggestionAnswersIgnored) addInfoNotification(t('budgetPlans.suggest.answersIgnored'));
        router.replace({
          name: ROUTES_NAMES.budgetPlan,
          params: { planId: plan.id },
        });
      },
    },
  );
};

const submit = () => {
  if (isSubmitDisabled.value) return;
  if (opensQuestions.value) isAskingQuestions.value = true;
  else create();
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" :close-when="isExitPage">
    <template #title>
      {{ $t(isAskingQuestions ? 'budgetPlans.suggest.title' : 'budgetPlans.create.title') }}
    </template>
    <template v-if="!isAskingQuestions" #description>{{ $t('budgetPlans.create.description') }}</template>

    <Callout v-if="hasNoEligibleAccounts" variant="info" :title="$t('budgetPlans.create.noAccountsTitle')">
      <p>{{ $t('budgetPlans.create.noAccountsDescription') }}</p>
      <Button variant="soft-primary" size="sm" class="mt-3" as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.accounts }" @click="isOpen = false">
          {{ $t('budgetPlans.create.goToAccounts') }}
        </RouterLink>
      </Button>
    </Callout>

    <SuggestionWizard
      v-else-if="isAskingQuestions"
      :account-ids="accountIds"
      :submit-label="$t('budgetPlans.create.submit')"
      :is-submitting="isPending"
      @back="isAskingQuestions = false"
      @submit="(answers) => create({ answers })"
    />

    <form v-else class="grid gap-4" @submit.prevent="submit">
      <SelectField
        :model-value="presetItems.find((option) => option.value === preset) ?? null"
        :values="presetItems"
        label-key="label"
        value-key="value"
        :label="$t('budgetPlans.create.cadenceLabel')"
        @update:model-value="(option) => option && (preset = option.value)"
      />

      <div v-if="preset === 'custom'" class="grid grid-cols-2 gap-3">
        <InputField
          type="number"
          :model-value="customEvery"
          :label="$t('budgetPlans.create.customEveryLabel')"
          :placeholder="$t('budgetPlans.create.customEveryPlaceholder')"
          :error-message="customEveryError"
          @update:model-value="setCustomEvery({ value: $event })"
        />
        <SelectField
          :model-value="customUnitOptions.find((option) => option.value === customUnit) ?? null"
          :values="customUnitOptions"
          label-key="label"
          value-key="value"
          :label="$t('budgetPlans.create.customUnitLabel')"
          :placeholder="$t('budgetPlans.create.customUnitPlaceholder')"
          @update:model-value="(option) => option && (customUnit = option.value)"
        />
      </div>

      <DateField
        :model-value="startsOn"
        mode="date"
        :label="$t('budgetPlans.create.startsOnLabel')"
        :calendar-options="{ maxDate: new Date() }"
        @update:model-value="(value) => setStartsOn({ value })"
      />

      <AccountMultiSelectField
        :model-value="accountIds"
        :label="$t('budgetPlans.create.accountsLabel')"
        :placeholder="$t('budgetPlans.create.accountsPlaceholder')"
        :filter-accounts="(account) => isAttachableAccount({ account })"
        @update:model-value="(value) => (accountIds = value)"
      />

      <SelectField
        :model-value="CARRY_POLICY_OPTIONS.find((option) => option.value === carryPolicy) ?? null"
        :values="CARRY_POLICY_OPTIONS"
        :label-key="(option) => $t(option.labelKey)"
        :label="$t('budgetPlans.create.rolloverLabel')"
        :placeholder="$t('budgetPlans.create.rolloverPlaceholder')"
        @update:model-value="(option) => option && (carryPolicy = option.value)"
      >
        <template #label-right>
          <DocsLink path="/budgeting/assigning-and-rollover/#rollover" class="text-xs" />
        </template>
      </SelectField>

      <div v-if="BUDGET_POOL_ENABLED" class="grid gap-1">
        <div class="flex items-center justify-between gap-3">
          <Label for="budget-create-pool" class="cursor-pointer text-sm font-normal">
            {{ $t('budgetPlans.pool.settingLabel') }}
          </Label>
          <Switch id="budget-create-pool" v-model="poolEnabled" />
        </div>
        <p class="text-muted-foreground text-xs">
          {{ $t('budgetPlans.pool.createHint') }}
        </p>
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <Label for="budget-create-suggested" class="cursor-pointer text-sm font-normal">
            {{ $t('budgetPlans.create.suggestedLinesLabel') }}
          </Label>
          <ResponsiveTooltip :content="$t('budgetPlans.create.suggestedLinesHint')" content-class-name="max-w-72">
            <InfoIcon class="text-muted-foreground size-3.5 shrink-0 cursor-help" />
          </ResponsiveTooltip>
          <StatusBadge variant="info">{{ $t('budgetPlans.create.recommended') }}</StatusBadge>
          <AiUsageBadge />
        </span>
        <Switch id="budget-create-suggested" v-model="withSuggestedLines" />
      </div>

      <div v-if="withSuggestedLines" class="grid gap-1">
        <div class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <Label for="budget-create-questions" class="cursor-pointer text-sm font-normal">
              {{ $t('budgetPlans.create.askQuestionsLabel') }}
            </Label>
            <StatusBadge variant="info">{{ $t('budgetPlans.create.recommended') }}</StatusBadge>
          </span>
          <Switch
            id="budget-create-questions"
            :model-value="askQuestions && !isAiReached"
            :disabled="isAiReached"
            @update:model-value="(value) => (askQuestions = value)"
          />
        </div>
        <p class="text-muted-foreground text-xs">
          {{ $t(isAiReached ? 'budgetPlans.create.askQuestionsNeedsAi' : 'budgetPlans.create.askQuestionsHint') }}
        </p>
      </div>

      <Button type="submit" :disabled="isSubmitDisabled">
        <template v-if="opensQuestions">
          {{ $t('budgetPlans.suggest.next') }}
          <ArrowRightIcon class="size-4" />
        </template>
        <template v-else-if="isPending">
          <LoaderCircleIcon class="size-4 animate-spin" />
          {{ $t('budgetPlans.create.creating') }}
        </template>
        <template v-else>{{ $t('budgetPlans.create.submit') }}</template>
      </Button>
    </form>
  </ResponsiveDialog>
</template>
