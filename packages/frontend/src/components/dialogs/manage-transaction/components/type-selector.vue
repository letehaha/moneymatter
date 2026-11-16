<template>
  <PillTabs
    :model-value="selectedTransactionType"
    :items="items"
    size="lg"
    full-width
    @update:model-value="emit('change-tx-type', $event as FORM_TYPES)"
  />
</template>

<script setup lang="ts">
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { ACCOUNT_TYPES, type AccountModel, TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { ArrowDownLeftIcon, ArrowRightLeftIcon, ArrowUpRightIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { FORM_TYPES } from '../types';

const { t } = useI18n();

const props = defineProps<{
  selectedTransactionType: FORM_TYPES;
  transaction?: TransactionModel;
  account?: AccountModel;
  disabled?: boolean;
  /** Planned rows must stay standalone, so transfer is off the table while the mode is on. */
  isTransferDisabled?: boolean;
  /** Only the selected type stays enabled. */
  isTypeLocked?: boolean;
}>();

const isLockedOut = ({ type }: { type: FORM_TYPES }) =>
  Boolean(props.isTypeLocked) && props.selectedTransactionType !== type;

const emit = defineEmits<{
  'change-tx-type': [value: FORM_TYPES];
}>();

// Check the account type, not the transaction type
// A system transaction in a monobank account should not be editable
const isExpenseDisabled = computed(
  () => props.account?.type !== ACCOUNT_TYPES.system && props.transaction?.transactionType === TRANSACTION_TYPES.income,
);
const isIncomeDisabled = computed(
  () =>
    props.account?.type !== ACCOUNT_TYPES.system && props.transaction?.transactionType === TRANSACTION_TYPES.expense,
);

const items = computed<PillTabItem[]>(() =>
  [
    {
      value: FORM_TYPES.expense,
      icon: ArrowDownLeftIcon,
      label: t('dialogs.manageTransaction.typeSelector.expense'),
      ariaLabel: t('dialogs.manageTransaction.typeSelector.selectExpense'),
      disabled: isExpenseDisabled.value,
      tone: 'var(--app-expense-color)',
    },
    {
      value: FORM_TYPES.income,
      icon: ArrowUpRightIcon,
      label: t('dialogs.manageTransaction.typeSelector.income'),
      ariaLabel: t('dialogs.manageTransaction.typeSelector.selectIncome'),
      disabled: isIncomeDisabled.value,
      tone: 'var(--app-income-color)',
    },
    {
      value: FORM_TYPES.transfer,
      icon: ArrowRightLeftIcon,
      label: t('dialogs.manageTransaction.typeSelector.transfer'),
      ariaLabel: t('dialogs.manageTransaction.typeSelector.selectTransfer'),
      disabled: Boolean(props.isTransferDisabled),
      tone: 'var(--foreground)',
    },
  ].map((item) => ({
    ...item,
    disabled: Boolean(props.disabled) || item.disabled || isLockedOut({ type: item.value }),
  })),
);
</script>
