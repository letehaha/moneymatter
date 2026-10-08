<script lang="ts" setup>
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { Button } from '@/components/lib/ui/button';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { Link2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';

import LinkedTransactionRow from './linked-transaction-row.vue';
import TransferRecordsList from './transfer-records-list.vue';
import FormRow from './form-row.vue';

interface Props {
  isTransferTx: boolean;
  isFormCreation: boolean;
  oppositeTransaction?: TransactionModel;
  transactionType?: TRANSACTION_TYPES;
  disabled: boolean;
  /** Origin transaction ID (for recommendations when editing) */
  originTransactionId?: string;
  /** Origin transaction amount for recommendations */
  originAmount?: number | null;
  /** Origin account ID for recommendations */
  originAccountId?: string | null;
}

const props = defineProps<Props>();

defineEmits<{
  unlink: [];
}>();

const linkedTransaction = defineModel<TransactionModel | null>('linkedTransaction');

const oppositeTransactionType = computed(() =>
  props.transactionType === TRANSACTION_TYPES.expense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
);

const showLinkButton = computed(
  () => props.isTransferTx && !linkedTransaction.value && !props.isFormCreation && !props.oppositeTransaction,
);

const showUnlinkButton = computed(() => props.isTransferTx && props.oppositeTransaction && !props.isFormCreation);

const showLinkedTransaction = computed(() => linkedTransaction.value && props.isTransferTx && !props.isFormCreation);

const isDialogOpen = ref(false);

const clearLinkedTransaction = () => {
  linkedTransaction.value = null;
};

const handleSelectTransaction = (transaction: TransactionModel) => {
  linkedTransaction.value = transaction;
  isDialogOpen.value = false;
};
</script>

<template>
  <template v-if="showLinkButton">
    <FormRow>
      <div
        class="text-muted-foreground mb-3.5 flex items-center gap-3 text-xs tracking-wide uppercase"
        aria-hidden="true"
      >
        <div class="bg-border h-px flex-1" />
        {{ $t('dialogs.manageTransaction.linkSection.orDivider') }}
        <div class="bg-border h-px flex-1" />
      </div>

      <ResponsiveDialog
        v-model:open="isDialogOpen"
        custom-close
        no-internal-scroll
        dialog-content-class="h-[min(85dvh,46rem)]"
        drawer-content-class="h-[calc(100dvh-1.25rem)] max-h-[calc(100dvh-1.25rem)]"
      >
        <template #trigger>
          <Button class="w-full" :disabled="disabled" variant="outline" size="sm">
            <Link2Icon class="size-4" />
            {{ $t('dialogs.manageTransaction.linkSection.linkButton') }}
          </Button>
        </template>

        <template #title>{{ $t('dialogs.manageTransaction.linkSection.title') }}</template>
        <template #description>{{ $t('dialogs.manageTransaction.linkSection.description') }}</template>

        <TransferRecordsList
          :transaction-type="oppositeTransactionType"
          :origin-transaction-id="props.originTransactionId"
          :origin-amount="props.originAmount"
          :origin-account-id="props.originAccountId"
          @select="handleSelectTransaction"
        />
      </ResponsiveDialog>

      <p class="text-muted-foreground mt-2 px-1 text-xs">
        {{ $t('dialogs.manageTransaction.linkSection.linkHint') }}
      </p>
    </FormRow>
  </template>

  <template v-if="showUnlinkButton">
    <FormRow>
      <Button class="w-full" :disabled="disabled" size="sm" @click="$emit('unlink')">{{
        $t('dialogs.manageTransaction.linkSection.unlinkButton')
      }}</Button>
    </FormRow>
  </template>

  <template v-if="showLinkedTransaction">
    <FormRow>
      <FieldLabel :label="$t('dialogs.manageTransaction.linkSection.linkedTransactionLabel')" only-template>
        <LinkedTransactionRow
          :transaction="linkedTransaction!"
          :disabled="disabled"
          :remove-label="$t('dialogs.manageTransaction.linkSection.cancelLinkingAriaLabel')"
          @remove="clearLinkedTransaction"
        />
      </FieldLabel>
    </FormRow>
  </template>
</template>
