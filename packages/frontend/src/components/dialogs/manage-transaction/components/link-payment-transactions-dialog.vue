<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { computed, ref } from 'vue';

import LinkPaymentCandidates from './link-payment-candidates.vue';

defineProps<{
  transactionType: TRANSACTION_TYPES;
  time: Date;
  /** Rows already in the form, including the main one. */
  excludeIds: string[];
  maxCount: number;
}>();

const emit = defineEmits<{ link: [transactions: TransactionModel[]] }>();

const isOpen = ref(false);
const candidatesRef = ref<InstanceType<typeof LinkPaymentCandidates> | null>(null);
const selected = computed(() => candidatesRef.value?.selected ?? []);

const submit = () => {
  emit('link', selected.value);
  isOpen.value = false;
};
</script>

<template>
  <ResponsiveDialog
    v-model:open="isOpen"
    no-internal-scroll
    dialog-content-class="max-w-[900px] h-[85vh]"
    drawer-content-class="h-[calc(100dvh-1.25rem)] max-h-[calc(100dvh-1.25rem)]"
  >
    <template #trigger>
      <slot />
    </template>

    <template #title>{{ $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.title') }}</template>

    <LinkPaymentCandidates
      ref="candidatesRef"
      :transaction-type="transactionType"
      :time="time"
      :exclude-ids="excludeIds"
      :max-count="maxCount"
    />

    <template #footer>
      <Button type="button" :disabled="!selected.length" @click="submit">
        {{
          $t(
            'dialogs.manageTransaction.form.paymentLegs.linkPicker.submit',
            { count: selected.length },
            selected.length,
          )
        }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>
