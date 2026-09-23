<script setup lang="ts">
import { createBudgetPlan } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore } from '@/stores';
import { type BudgetPlanCarryPolicy } from '@bt/shared/types';
import { isSameDay, startOfMonth, startOfWeek } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import {
  BUDGET_CADENCE_PRESETS,
  type BudgetCadencePreset,
  buildCarryOptions,
  buildCreatePlanPayload,
  isAttachableAccount,
} from '../helpers';

const isOpen = defineModel<boolean>('open', { required: true });

const { t } = useI18n();
const router = useRouter();
const { activeAccounts, isAccountsFetched, isAccountsError } = storeToRefs(useAccountsStore());
const { locale } = useDateLocale();

const preset = ref<BudgetCadencePreset>('monthly');
const editedStartsOn = ref<Date>();
const accountIds = ref<string[]>([]);
const carryPolicy = ref<BudgetPlanCarryPolicy>('floor');

const startsOn = computed(() => {
  if (editedStartsOn.value) return editedStartsOn.value;
  const today = new Date();
  return preset.value === 'monthly' || preset.value === 'semiMonthly'
    ? startOfMonth(today)
    : startOfWeek(today, { weekStartsOn: locale.value.options?.weekStartsOn ?? 1 });
});

// DateField emits every model change back, so only a different day counts as a user edit.
const setStartsOn = ({ value }: { value: Date }) => {
  if (!isSameDay(value, startsOn.value)) editedStartsOn.value = value;
};

const eligibleAccountIds = computed(() =>
  activeAccounts.value.filter(isAttachableAccount).map((account) => account.id),
);
const hasNoEligibleAccounts = computed(
  () => isAccountsFetched.value && !isAccountsError.value && eligibleAccountIds.value.length === 0,
);

watch([isOpen, isAccountsFetched], ([open], [wasOpen]) => {
  if (!open) return;
  if (!wasOpen) editedStartsOn.value = undefined;
  accountIds.value = eligibleAccountIds.value;
});

const presetItems = computed(() =>
  BUDGET_CADENCE_PRESETS.map((value) => ({ value, label: t(`budgetPlans.cadence.${value}`) })),
);

const carryOptions = computed(() => buildCarryOptions({ t }));

const { isPending, mutate } = useInvalidatingMutation({
  mutationFn: createBudgetPlan,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.create.success',
  errorKey: 'budgetPlans.create.error',
  onSuccess: () => {
    isOpen.value = false;
  },
});

const isSubmitDisabled = computed(() => isPending.value || accountIds.value.length === 0);

const submit = () => {
  if (isSubmitDisabled.value) return;
  mutate(
    {
      payload: buildCreatePlanPayload({
        name: t('budgetPlans.defaultName'),
        preset: preset.value,
        startsOn: startsOn.value,
        accountIds: accountIds.value,
        carryPolicy: carryPolicy.value,
      }),
    },
    { onSuccess: ({ plan }) => router.replace({ name: ROUTES_NAMES.budgetPlan, params: { planId: plan.id } }) },
  );
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('budgetPlans.create.title') }}</template>
    <template #description>{{ $t('budgetPlans.create.description') }}</template>

    <Callout v-if="hasNoEligibleAccounts" variant="info" :title="$t('budgetPlans.create.noAccountsTitle')">
      <p>{{ $t('budgetPlans.create.noAccountsDescription') }}</p>
      <Button variant="soft-primary" size="sm" class="mt-3" as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.accounts }" @click="isOpen = false">
          {{ $t('budgetPlans.create.goToAccounts') }}
        </RouterLink>
      </Button>
    </Callout>

    <form v-else class="grid gap-4" @submit.prevent="submit">
      <div class="grid gap-2">
        <Label>{{ $t('budgetPlans.create.cadenceLabel') }}</Label>
        <PillTabs
          :model-value="preset"
          :items="presetItems"
          @update:model-value="(value) => (preset = value as BudgetCadencePreset)"
        />
      </div>

      <DateField
        :model-value="startsOn"
        :label="$t('budgetPlans.create.startsOnLabel')"
        :calendar-options="{ maxDate: new Date() }"
        @update:model-value="(value) => setStartsOn({ value })"
      />

      <AccountMultiSelectField
        :model-value="accountIds"
        :label="$t('budgetPlans.create.accountsLabel')"
        :placeholder="$t('budgetPlans.create.accountsPlaceholder')"
        :filter-accounts="isAttachableAccount"
        @update:model-value="(value) => (accountIds = value)"
      />

      <SelectField
        :model-value="carryOptions.find((option) => option.value === carryPolicy) ?? null"
        :values="carryOptions"
        :label="$t('budgetPlans.create.rolloverLabel')"
        :placeholder="$t('budgetPlans.create.rolloverPlaceholder')"
        @update:model-value="(option) => option && (carryPolicy = option.value)"
      />

      <Button type="submit" :disabled="isSubmitDisabled">{{ $t('budgetPlans.create.submit') }}</Button>
    </form>
  </ResponsiveDialog>
</template>
