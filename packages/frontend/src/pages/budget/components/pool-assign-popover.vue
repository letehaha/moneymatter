<script setup lang="ts">
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { ChevronDownIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { useSetAssignment } from '../composables/use-set-assignment';
import { buildPoolAssignPayload, groupLines } from '../helpers';

const props = defineProps<{ planId: string; view: BudgetPlanPeriodView; prominent?: boolean }>();

const { formatBaseCurrency } = useFormatCurrency();

const isOpen = ref(false);
const lineId = ref<string | null>(null);
const amount = ref<number | null>(null);

const lineOptions = computed(() => {
  const { ungrouped, groups } = groupLines({ lines: props.view.lines, groups: props.view.groups });
  return [...ungrouped, ...groups.flatMap((section) => section.lines)].map((line) => ({
    value: line.lineId,
    label: line.name,
  }));
});
const selectedLine = computed(() => props.view.lines.find((line) => line.lineId === lineId.value));

watch(isOpen, (open) => {
  if (!open) return;
  amount.value = Math.max(props.view.pool?.readyToAssign ?? 0, 0);
  if (!selectedLine.value) lineId.value = null;
});

const payload = computed(() =>
  selectedLine.value ? buildPoolAssignPayload({ line: selectedLine.value, amount: amount.value }) : null,
);

const { isPending, mutate } = useSetAssignment({
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = () => {
  if (isPending.value || !payload.value || !selectedLine.value) return;
  mutate({
    planId: props.planId,
    periodId: props.view.period.id,
    lineId: selectedLine.value.lineId,
    payload: payload.value,
  });
};
</script>

<template>
  <ResponsivePopover align="end" v-model:open="isOpen" :title="$t('budgetPlans.pool.assignTitle')" content-class="w-80">
    <template #trigger>
      <Button :size="prominent ? 'default' : 'sm'" :disabled="!view.lines.length">
        <template v-if="prominent">
          {{ $t('budgetPlans.pool.assignAmount', { amount: formatBaseCurrency(view.pool?.readyToAssign ?? 0) }) }}
        </template>
        <template v-else>{{ $t('budgetPlans.pool.assign') }}</template>
        <ChevronDownIcon class="size-4" />
      </Button>
    </template>

    <form class="grid gap-3" @submit.prevent="submit">
      <SelectField
        :model-value="lineOptions.find((option) => option.value === lineId) ?? null"
        :values="lineOptions"
        :label="$t('budgetPlans.pool.toLabel')"
        :placeholder="$t('budgetPlans.pool.toPlaceholder')"
        with-search
        @update:model-value="(option) => (lineId = option?.value ?? null)"
      />

      <FormattedAmountField
        :model-value="amount"
        :label="$t('budgetPlans.pool.amountLabel')"
        :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
        @update:model-value="(value) => (amount = value)"
      />

      <Button type="submit" :disabled="isPending || !payload">
        {{ $t('budgetPlans.pool.assignSubmit', { amount: formatBaseCurrency(amount ?? 0) }) }}
      </Button>
    </form>
  </ResponsivePopover>
</template>
