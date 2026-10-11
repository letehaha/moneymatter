<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { computed, ref, watch } from 'vue';

import { useSetAssignment } from '../composables/use-set-assignment';
import { amountToneClass, buildPoolTakeBackPayload, pickTakeBackLine, takeBackCandidates } from '../helpers';

// Stays mounted while hidden: unmounting it in the render that closes its drawer can leave the page inert.
const props = defineProps<{ planId: string; view: BudgetPlanPeriodView; visible: boolean }>();

const { formatBaseCurrency } = useFormatCurrency();

const isOpen = ref(false);
const lineId = ref<string | null>(null);
const amount = ref<number | null>(null);

const candidates = computed(() => takeBackCandidates({ lines: props.view.lines }));
const lineOptions = computed(() =>
  candidates.value.map((line) => ({ value: line.lineId, label: line.name, available: line.available })),
);
const selectedLine = computed(() => candidates.value.find((line) => line.lineId === lineId.value));

const selectLine = ({ id }: { id: string | null }) => {
  lineId.value = id;
  const shortfall = Math.max(-(props.view.pool?.readyToAssign ?? 0), 0);
  amount.value = selectedLine.value ? Math.min(shortfall, selectedLine.value.poolAssigned) : null;
};

watch(isOpen, (open) => {
  if (open) selectLine({ id: pickTakeBackLine({ lines: candidates.value })?.lineId ?? null });
});

const payload = computed(() =>
  selectedLine.value ? buildPoolTakeBackPayload({ line: selectedLine.value, amount: amount.value }) : null,
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
  <ResponsivePopover align="end" v-model:open="isOpen" :title="$t('budgetPlans.pool.fixTitle')" content-class="w-80">
    <template #trigger>
      <Button v-show="visible" size="sm" variant="outline">
        {{ $t('budgetPlans.pool.fix') }}
      </Button>
    </template>

    <p v-if="!lineOptions.length" class="text-muted-foreground text-sm">
      {{ $t('budgetPlans.pool.fixNoLines') }}
    </p>

    <form v-else class="grid gap-3" @submit.prevent="submit">
      <SelectField
        :model-value="lineOptions.find((option) => option.value === lineId) ?? null"
        :values="lineOptions"
        :label="$t('budgetPlans.pool.fromLabel')"
        :placeholder="$t('budgetPlans.pool.fromPlaceholder')"
        with-search
        @update:model-value="(option) => selectLine({ id: option?.value ?? null })"
      >
        <template #item="{ item }">
          <span class="flex w-full items-center justify-between gap-3">
            <span class="truncate">{{ item.label }}</span>
            <span :class="cn('text-xs tabular-nums', amountToneClass({ amount: item.available }))">
              {{ formatBaseCurrency(item.available) }}
            </span>
          </span>
        </template>
      </SelectField>

      <FormattedAmountField
        :model-value="amount"
        :label="$t('budgetPlans.pool.amountLabel')"
        :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
        @update:model-value="(value) => (amount = value)"
      />

      <Button type="submit" :disabled="isPending || !payload">
        {{ $t('budgetPlans.pool.fixSubmit', { amount: formatBaseCurrency(amount ?? 0) }) }}
      </Button>
    </form>

    <DocsLink path="/budgeting/ready-to-assign/#over-assigned" class="mt-3 text-xs" />
  </ResponsivePopover>
</template>
