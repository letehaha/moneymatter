<script setup lang="ts">
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import { Button } from '@/components/lib/ui/button';
import type { TrackerLineModel } from '@bt/shared/types';
import { nextTick, ref, watch } from 'vue';

import { useTrackerLineMutations } from './use-tracker-line-mutations';

const props = defineProps<{ budgetId: string; line: TrackerLineModel }>();

const { updateLine } = useTrackerLineMutations({ budgetId: () => props.budgetId });

const isOpen = ref(false);
const contentRef = ref<HTMLElement | null>(null);
const amount = ref<number | null>(null);

watch(isOpen, async (open) => {
  if (!open) return;
  amount.value = props.line.limitAmount;
  await nextTick();
  contentRef.value?.querySelector('input')?.focus();
});

const save = async () => {
  if (updateLine.isPending.value) return;
  if (amount.value === props.line.limitAmount) {
    isOpen.value = false;
    return;
  }
  try {
    await updateLine.mutateAsync({ lineId: props.line.id, payload: { limitAmount: amount.value } });
    isOpen.value = false;
  } catch {
    // Error toast is shown by the mutation.
  }
};
</script>

<template>
  <ResponsivePopover align="end" v-model:open="isOpen" :title="line.name" content-class="w-72">
    <template #trigger>
      <slot />
    </template>

    <div ref="contentRef" class="grid gap-3">
      <FormattedAmountField
        :model-value="amount"
        :label="$t('budgets.lines.columns.limit')"
        :placeholder="$t('budgets.lines.noLimitPlaceholder')"
        @update:model-value="(value) => (amount = value)"
        @keydown.enter.prevent="save"
      />

      <div class="flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
        <Button size="sm" :disabled="updateLine.isPending.value" @click="save">
          {{ $t('common.actions.save') }}
        </Button>
      </div>
    </div>
  </ResponsivePopover>
</template>
