<script setup lang="ts">
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Separator } from '@/components/lib/ui/separator';
import {
  type BudgetAssignmentScope,
  type BudgetPlanCarryPolicy,
  type BudgetPlanPeriodViewLine,
  type SetBudgetPlanAssignmentPayload,
} from '@bt/shared/types';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useSetAssignment } from '../composables/use-set-assignment';
import { CARRY_POLICY_OPTIONS, buildAssignmentPayload, defaultAssignmentScope } from '../helpers';

const props = defineProps<{ planId: string; periodId: string; line: BudgetPlanPeriodViewLine }>();

const { t } = useI18n();

const isOpen = ref(false);
const contentRef = ref<HTMLElement | null>(null);

const amount = ref<number | null>(null);
const scope = ref<BudgetAssignmentScope>('from_here');
const carryPolicy = ref<BudgetPlanCarryPolicy>('floor');

const scopeItems = computed(() => [
  { value: 'this_period', label: t('budgetPlans.assign.scopeThisPeriod') },
  { value: 'from_here', label: t('budgetPlans.assign.scopeFromNow') },
]);

watch(isOpen, async (open) => {
  if (!open) return;
  amount.value = props.line.assigned;
  scope.value = defaultAssignmentScope({ line: props.line });
  carryPolicy.value = props.line.carryPolicy;
  await nextTick();
  contentRef.value?.querySelector('input')?.focus();
});

const { isPending, mutate } = useSetAssignment({
  onSuccess: () => {
    isOpen.value = false;
  },
});

const submit = ({ payload }: { payload: SetBudgetPlanAssignmentPayload | null }) => {
  if (isPending.value) return;
  if (!payload) {
    isOpen.value = false;
    return;
  }
  mutate({ planId: props.planId, periodId: props.periodId, lineId: props.line.lineId, payload });
};

const save = () =>
  submit({
    payload: buildAssignmentPayload({
      line: props.line,
      amount: amount.value,
      scope: scope.value,
      carryPolicy: carryPolicy.value,
    }),
  });

const resetToBaseline = () => submit({ payload: { scope: 'this_period', amount: null } });
</script>

<template>
  <ResponsivePopover align="end" v-model:open="isOpen" :title="line.name" content-class="w-80">
    <template #trigger>
      <slot />
    </template>

    <div ref="contentRef" class="grid gap-3">
      <FormattedAmountField
        :model-value="amount"
        :label="$t('budgetPlans.assign.amountLabel')"
        :placeholder="$t('budgetPlans.assign.amountPlaceholder')"
        @update:model-value="(value) => (amount = value)"
        @keydown.enter.prevent="save"
      />

      <div class="grid gap-1.5">
        <Label>{{ $t('budgetPlans.assign.scopeLabel') }}</Label>
        <PillTabs
          :model-value="scope"
          :items="scopeItems"
          size="sm"
          full-width
          @update:model-value="(value) => (scope = value as BudgetAssignmentScope)"
        />
        <Button
          v-if="line.assignedSource === 'override'"
          variant="link"
          size="sm"
          class="h-auto justify-self-start p-0 text-xs"
          :disabled="isPending"
          @click="resetToBaseline"
        >
          {{ $t('budgetPlans.assign.useBaseline') }}
        </Button>
      </div>

      <Separator />

      <div class="grid gap-1.5">
        <SelectField
          :model-value="CARRY_POLICY_OPTIONS.find((option) => option.value === carryPolicy) ?? null"
          :values="CARRY_POLICY_OPTIONS"
          :label-key="(option) => $t(option.labelKey)"
          :label="$t('budgetPlans.assign.rolloverLabel')"
          :placeholder="$t('budgetPlans.assign.rolloverPlaceholder')"
          @update:model-value="(option) => option && (carryPolicy = option.value)"
        />
        <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.assign.rolloverHint') }}</p>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <span class="text-muted-foreground text-xs">{{ $t('budgetPlans.assign.enterHint') }}</span>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
          <Button size="sm" :disabled="isPending" @click="save">{{ $t('common.actions.save') }}</Button>
        </div>
      </div>
    </div>
  </ResponsivePopover>
</template>
