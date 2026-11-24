<script setup lang="ts">
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import * as AlertDialog from '@/components/lib/ui/alert-dialog';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import {
  type TransferContext,
  type TransferType,
  useAccountToPortfolioTransfer,
  useCreatePortfolioTransfer,
  useLinkTransactionToPortfolio,
  usePortfolioToAccountTransfer,
} from '@/composable/data-queries/portfolio-transfers';
import { usePortfolioCurrencySorting } from '@/composable/data-queries/use-portfolio-currency-sorting';
import { usePortfolios } from '@/composable/data-queries/portfolios';
import { useFormValidation } from '@/composable/form-validator';
import { useCurrencyDecimalRule } from '@/composable/use-currency-decimal-rule';
import { formatAccountAmount, formatUIAmount } from '@/js/helpers';
import { getCurrencyDecimals, getSmallestCurrencyUnit } from '@/js/helpers/currency-decimals';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { AccountModel, PortfolioModel, TRANSACTION_TYPES, TransactionModel, UserCurrencyModel } from '@bt/shared/types';
import { X } from '@lucide/vue';
import { minValue, required } from '@vuelidate/validators';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

interface Emit {
  (e: 'success'): void;
  (e: 'cancel'): void;
}

const props = defineProps<{
  /** Transfer context - determines which page this form is used on */
  context: TransferContext;
  /** Initial source portfolio (when context is 'portfolio') */
  initialPortfolio?: PortfolioModel;
  /** Initial source account (when context is 'account') */
  initialAccount?: AccountModel;
  /** Disable the form inputs */
  disabled?: boolean;
}>();

const emit = defineEmits<Emit>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
// Loan accounts excluded – money only flows INTO a loan (transfer_to_loan), so they can't be a transfer source.
const { txTargetableSourceAccountsActiveFirst: txTargetableAccountsActiveFirst, accountsRecord } =
  storeToRefs(useAccountsStore());
const { currencies } = storeToRefs(useCurrenciesStore());
const { data: portfolios } = usePortfolios();

const createTransferMutation = useCreatePortfolioTransfer();
const accountToPortfolioMutation = useAccountToPortfolioTransfer();
const portfolioToAccountMutation = usePortfolioToAccountTransfer();
const linkToPortfolioMutation = useLinkTransactionToPortfolio();

// Form state — defined before balance logic so balance computeds can reference it
const form = reactive<{
  fromPortfolio: PortfolioModel | null;
  toPortfolio: PortfolioModel | null;
  fromAccount: AccountModel | null;
  toAccount: AccountModel | null;
  transferTypeOption: { value: TransferType; label: string } | null;
  amount: string;
  selectedCurrency: UserCurrencyModel | null;
  date: Date;
  description: string;
}>({
  fromPortfolio: props.context === 'portfolio' ? props.initialPortfolio || null : null,
  toPortfolio: null,
  fromAccount: props.context === 'account' ? props.initialAccount || null : null,
  toAccount: null,
  transferTypeOption: null,
  amount: '',
  selectedCurrency: null,
  date: new Date(),
  description: '',
});

// Portfolio balance data for currency sorting
const sourcePortfolioId = computed(() => form.fromPortfolio?.id ?? '');
const { sortedCurrencies, currencyLabel } = usePortfolioCurrencySorting(sourcePortfolioId);

// Computed values for easier access
const transferType = computed(() => form.transferTypeOption?.value || 'portfolio-to-portfolio');

// Link existing transaction state
const linkedTransaction = ref<TransactionModel | null>(null);
const isPickerOpen = ref(false);
const isLinkExistingTx = computed(() => !!linkedTransaction.value);

const supportsLinking = computed(
  () => transferType.value === 'portfolio-to-account' || transferType.value === 'account-to-portfolio',
);

const pickerTransactionType = computed(() => {
  if (transferType.value === 'portfolio-to-account') return TRANSACTION_TYPES.income;
  if (transferType.value === 'account-to-portfolio') return TRANSACTION_TYPES.expense;
  return undefined;
});

// Transfer type options based on context
const transferTypeOptions = computed(() => {
  if (props.context === 'portfolio') {
    return [
      {
        value: 'portfolio-to-portfolio' as TransferType,
        label: t('forms.portfolioTransfer.transferTypes.portfolioToPortfolio'),
      },
      {
        value: 'portfolio-to-account' as TransferType,
        label: t('forms.portfolioTransfer.transferTypes.portfolioToAccount'),
      },
    ];
  } else {
    return [
      {
        value: 'account-to-portfolio' as TransferType,
        label: t('forms.portfolioTransfer.transferTypes.accountToPortfolio'),
      },
    ];
  }
});

// Initialize default transfer type
watch(
  () => props.context,
  (context) => {
    if (!form.transferTypeOption) {
      const defaultType: TransferType = context === 'portfolio' ? 'portfolio-to-portfolio' : 'account-to-portfolio';
      form.transferTypeOption = transferTypeOptions.value.find((opt) => opt.value === defaultType) || null;
    }
  },
  { immediate: true },
);

// Confirmation dialog state
const showConfirmDialog = ref(false);
const confirmDialogData = ref<{
  from: string;
  to: string;
  amount: string;
  currency: string;
  action: string;
} | null>(null);

// Available options based on transfer type and selections
const availableFromPortfolios = computed(() => {
  if (props.context === 'account') return [];
  return portfolios.value?.filter((p) => p.id !== form.toPortfolio?.id) || [];
});

const availableToPortfolios = computed(() => {
  if (transferType.value === 'portfolio-to-account') return [];
  return portfolios.value?.filter((p) => p.id !== form.fromPortfolio?.id) || [];
});

const availableFromAccounts = computed(() => {
  if (props.context === 'portfolio') return [];
  if (transferType.value !== 'account-to-portfolio') return [];
  return txTargetableAccountsActiveFirst.value.filter((a) => a.id !== form.toAccount?.id);
});

const availableToAccounts = computed(() => {
  if (transferType.value === 'portfolio-to-portfolio' || transferType.value === 'account-to-portfolio') return [];
  return txTargetableAccountsActiveFirst.value.filter((a) => a.id !== form.fromAccount?.id);
});

// Field visibility based on context and transfer type
const showFromPortfolio = computed(
  () =>
    props.context === 'portfolio' &&
    (transferType.value === 'portfolio-to-portfolio' || transferType.value === 'portfolio-to-account'),
);

const showToPortfolio = computed(
  () => transferType.value === 'portfolio-to-portfolio' || transferType.value === 'account-to-portfolio',
);

const showFromAccount = computed(() => props.context === 'account' && transferType.value === 'account-to-portfolio');

const showToAccount = computed(() => transferType.value === 'portfolio-to-account');

// A transfer to or from an account always moves the account's currency, which a shared account
// may have outside the viewer's currencies.
const transferAccount = computed(() => {
  if (transferType.value === 'account-to-portfolio') return form.fromAccount;
  if (transferType.value === 'portfolio-to-account') return form.toAccount;
  return undefined;
});
const accountCurrencyCode = computed(() => transferAccount.value?.currencyCode);
const isAccountTransfer = computed(() => transferType.value !== 'portfolio-to-portfolio');
const currencyCode = computed(() =>
  isAccountTransfer.value ? accountCurrencyCode.value : form.selectedCurrency?.currencyCode,
);
const currencyMeta = computed(() => (isAccountTransfer.value ? transferAccount.value?.currencyMeta : undefined));
const decimals = computed(() =>
  currencyCode.value ? getCurrencyDecimals({ code: currencyCode.value, meta: currencyMeta.value }) : undefined,
);
const currencyDecimal = useCurrencyDecimalRule({ decimals });

const amountLabel = computed(() =>
  currencyCode.value
    ? t('forms.portfolioTransfer.amountLabelWithCurrency', { currency: currencyCode.value })
    : t('forms.portfolioTransfer.amountLabel'),
);

// Form validation
const validationRules = computed(() => ({
  amount: {
    required,
    minValue: minValue(getSmallestCurrencyUnit({ code: currencyCode.value, meta: currencyMeta.value })),
    currencyDecimal: currencyDecimal.rule.value,
  },
  ...(isAccountTransfer.value ? {} : { selectedCurrency: { required } }),
  date: {
    required,
  },
  transferTypeOption: {
    required,
  },
}));

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
  {},
  {
    customValidationMessages: {
      required: t('forms.portfolioTransfer.validation.required'),
      minValue: t('forms.portfolioTransfer.validation.minValue'),
      currencyDecimal: currencyDecimal.message,
    },
  },
);

// Auto-set currency based on source.
watch(
  [() => form.fromPortfolio, () => form.fromAccount, () => transferType.value, accountCurrencyCode],
  () => {
    if (accountCurrencyCode.value) {
      form.selectedCurrency = currencies.value?.find((c) => c.currencyCode === accountCurrencyCode.value) || null;
      return;
    }

    const sourceCurrencyCode = form.fromPortfolio?.balances?.[0]?.currencyCode || form.fromAccount?.currencyCode;
    if (sourceCurrencyCode && !form.selectedCurrency) {
      form.selectedCurrency = currencies.value?.find((c) => c.currencyCode === sourceCurrencyCode) || null;
    }
  },
  { immediate: true },
);

// Update transfer type based on selections
watch([() => form.fromPortfolio, () => form.toPortfolio, () => form.fromAccount, () => form.toAccount], () => {
  let newType: TransferType;
  if (form.fromPortfolio && form.toPortfolio) {
    newType = 'portfolio-to-portfolio';
  } else if (form.fromPortfolio && form.toAccount) {
    newType = 'portfolio-to-account';
  } else if (form.fromAccount && form.toPortfolio) {
    newType = 'account-to-portfolio';
  } else {
    return;
  }
  form.transferTypeOption = transferTypeOptions.value.find((opt) => opt.value === newType) || null;
});

// Clear conflicting selections when transfer type changes
watch(
  () => transferType.value,
  (newType) => {
    if (newType === 'portfolio-to-portfolio') {
      form.fromAccount = null;
      form.toAccount = null;
      linkedTransaction.value = null;
    } else if (newType === 'portfolio-to-account') {
      form.toPortfolio = null;
      form.fromAccount = null;
    } else if (newType === 'account-to-portfolio') {
      form.fromPortfolio = null;
      form.toAccount = null;
    }
  },
);

const resetForm = () => {
  form.fromPortfolio = props.context === 'portfolio' ? props.initialPortfolio || null : null;
  form.toPortfolio = null;
  form.toAccount = null;
  const defaultType: TransferType = props.context === 'portfolio' ? 'portfolio-to-portfolio' : 'account-to-portfolio';
  form.transferTypeOption = transferTypeOptions.value.find((opt) => opt.value === defaultType) || null;
  form.fromAccount = props.context === 'account' ? props.initialAccount || null : null;
  form.amount = '';
  form.selectedCurrency = null;
  form.date = new Date();
  form.description = '';
  linkedTransaction.value = null;

  resetValidation();
};

const validateForm = (): boolean => {
  if (isLinkExistingTx.value) {
    touchField('form.transferTypeOption');
    if (!linkedTransaction.value) return false;
    if (!form.fromPortfolio && !form.toPortfolio) return false;
    return true;
  }

  touchField('form.transferTypeOption');
  touchField('form.amount');
  touchField('form.selectedCurrency');
  touchField('form.date');

  if (!form.fromPortfolio && !form.fromAccount) {
    return false;
  }

  if (!form.toPortfolio && !form.toAccount) {
    return false;
  }

  return isFormValid('form');
};

const getTransferAction = (): string => {
  if (transferType.value === 'portfolio-to-portfolio') {
    return t('forms.portfolioTransfer.confirmDialog.actionTransfer');
  } else if (transferType.value === 'portfolio-to-account') {
    return t('forms.portfolioTransfer.confirmDialog.actionWithdrawal');
  }
  return t('forms.portfolioTransfer.confirmDialog.actionDeposit');
};

const prepareConfirmationData = () => {
  let fromName = '';
  let toName = '';
  let amount: string;
  let currency: string;

  if (isLinkExistingTx.value && linkedTransaction.value) {
    const tx = linkedTransaction.value;
    amount = formatAccountAmount({ amount: tx.amount, account: tx, fullPrecision: true });
    currency = tx.currencyCode;

    if (transferType.value === 'portfolio-to-account') {
      fromName = form.fromPortfolio?.name || '';
      toName = accountsRecord.value[tx.accountId]?.name || t('forms.portfolioTransfer.linkedTransactionLabel');
    } else {
      fromName = accountsRecord.value[tx.accountId]?.name || t('forms.portfolioTransfer.linkedTransactionLabel');
      toName = form.toPortfolio?.name || '';
    }
  } else {
    if (transferType.value === 'portfolio-to-portfolio') {
      fromName = form.fromPortfolio?.name || '';
      toName = form.toPortfolio?.name || '';
    } else if (transferType.value === 'portfolio-to-account') {
      fromName = form.fromPortfolio?.name || '';
      toName = form.toAccount?.name || '';
    } else if (transferType.value === 'account-to-portfolio') {
      fromName = form.fromAccount?.name || '';
      toName = form.toPortfolio?.name || '';
    }

    currency = currencyCode.value ?? '';
    amount = formatUIAmount(Number(form.amount), { currency, meta: currencyMeta.value, revealed: true });
  }

  confirmDialogData.value = { from: fromName, to: toName, amount, currency, action: getTransferAction() };
};

const onSubmit = () => {
  if (!validateForm()) return;

  prepareConfirmationData();
  showConfirmDialog.value = true;
};

const confirmTransfer = async () => {
  try {
    showConfirmDialog.value = false;

    if (isLinkExistingTx.value && linkedTransaction.value) {
      const portfolioId = transferType.value === 'portfolio-to-account' ? form.fromPortfolio!.id : form.toPortfolio!.id;

      await linkToPortfolioMutation.mutateAsync({
        transactionId: linkedTransaction.value.id,
        portfolioId,
      });
    } else {
      const dateStr = form.date.toISOString().split('T')[0]!;
      const amount = String(form.amount);

      if (transferType.value === 'portfolio-to-portfolio') {
        await createTransferMutation.mutateAsync({
          fromPortfolioId: form.fromPortfolio!.id,
          toPortfolioId: form.toPortfolio!.id,
          currencyCode: form.selectedCurrency!.currencyCode,
          amount,
          date: dateStr,
          description: form.description || undefined,
        });
      } else if (transferType.value === 'portfolio-to-account') {
        await portfolioToAccountMutation.mutateAsync({
          portfolioId: form.fromPortfolio!.id,
          accountId: form.toAccount!.id,
          amount,
          currencyCode: currencyCode.value!,
          date: dateStr,
          description: form.description || undefined,
        });
      } else {
        await accountToPortfolioMutation.mutateAsync({
          portfolioId: form.toPortfolio!.id,
          accountId: form.fromAccount!.id,
          amount,
          date: dateStr,
          description: form.description || undefined,
        });
      }
    }

    addNotification({
      text: t('forms.portfolioTransfer.notifications.success'),
      type: NotificationType.success,
    });

    resetForm();
    accountsStore.refetchAccounts();
    emit('success');
  } catch (error) {
    addNotification({
      text: error instanceof Error ? error.message : t('forms.portfolioTransfer.notifications.error'),
      type: NotificationType.error,
    });
  }
};

const isAnyMutationPending = computed(
  () =>
    createTransferMutation.isPending.value ||
    accountToPortfolioMutation.isPending.value ||
    portfolioToAccountMutation.isPending.value ||
    linkToPortfolioMutation.isPending.value,
);

const isSubmitDisabled = computed(() => {
  if (props.disabled || isAnyMutationPending.value) return true;

  if (isLinkExistingTx.value) {
    if (!linkedTransaction.value) return true;
    if (!form.fromPortfolio && !form.toPortfolio) return true;
    return false;
  }

  return (
    !form.amount ||
    !currencyCode.value ||
    (!form.fromPortfolio && !form.fromAccount) ||
    (!form.toPortfolio && !form.toAccount)
  );
});
</script>

<template>
  <form class="grid w-full max-w-150 gap-6" @submit.prevent="onSubmit">
    <SelectField
      v-model="form.transferTypeOption"
      :label="$t('forms.portfolioTransfer.transferTypeLabel')"
      :values="transferTypeOptions"
      value-key="value"
      label-key="label"
      :disabled="isAnyMutationPending || disabled"
      :error-message="getFieldErrorMessage('form.transferTypeOption')"
    />

    <SelectField
      v-if="showFromPortfolio"
      v-model="form.fromPortfolio"
      :label="$t('forms.portfolioTransfer.fromPortfolioLabel')"
      :values="availableFromPortfolios"
      value-key="id"
      label-key="name"
      :placeholder="$t('forms.portfolioTransfer.fromPortfolioPlaceholder')"
      :disabled="isAnyMutationPending || disabled || props.context === 'portfolio'"
    />

    <AccountSelectField
      v-if="showFromAccount"
      v-model="form.fromAccount"
      :label="$t('forms.portfolioTransfer.fromAccountLabel')"
      :accounts="availableFromAccounts"
      :placeholder="$t('forms.portfolioTransfer.fromAccountPlaceholder')"
      :disabled="isAnyMutationPending || disabled || props.context === 'account'"
    />

    <SelectField
      v-if="showToPortfolio"
      v-model="form.toPortfolio"
      :label="$t('forms.portfolioTransfer.toPortfolioLabel')"
      :values="availableToPortfolios"
      value-key="id"
      label-key="name"
      :placeholder="
        availableToPortfolios.length
          ? $t('forms.portfolioTransfer.toPortfolioPlaceholder')
          : $t('forms.portfolioTransfer.noPortfoliosAvailable')
      "
      :disabled="isAnyMutationPending || disabled || !availableToPortfolios.length"
    />

    <AccountSelectField
      v-if="showToAccount && !isLinkExistingTx"
      v-model="form.toAccount"
      :label="$t('forms.portfolioTransfer.toAccountLabel')"
      :accounts="availableToAccounts"
      :placeholder="$t('forms.portfolioTransfer.toAccountPlaceholder')"
      :disabled="isAnyMutationPending || disabled"
    />

    <!-- Link existing transaction -->
    <template v-if="supportsLinking">
      <div v-if="!linkedTransaction">
        <UiButton
          type="button"
          variant="outline"
          class="w-full"
          :disabled="isAnyMutationPending || disabled"
          @click="isPickerOpen = true"
        >
          {{ $t('forms.portfolioTransfer.linkExistingTransaction') }}
        </UiButton>
      </div>
      <div v-else class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <TransactionRecord :tx="linkedTransaction" :as-button="false" />
        </div>
        <UiButton type="button" variant="ghost" size="icon-sm" class="shrink-0" @click="linkedTransaction = null">
          <X :size="16" />
        </UiButton>
      </div>
      <PickTransactionDialog
        v-model:open="isPickerOpen"
        :transaction-type="pickerTransactionType"
        @select="(tx: TransactionModel) => (linkedTransaction = tx)"
      />
    </template>

    <!-- Regular transfer fields (hidden when linking) -->
    <template v-if="!isLinkExistingTx">
      <SelectField
        v-if="transferType === 'portfolio-to-portfolio'"
        v-model="form.selectedCurrency"
        :label="$t('forms.portfolioTransfer.currencyLabel')"
        :values="sortedCurrencies"
        value-key="currencyCode"
        :label-key="currencyLabel"
        :placeholder="$t('forms.portfolioTransfer.currencyPlaceholder')"
        :disabled="isAnyMutationPending || disabled"
        :error-message="getFieldErrorMessage('form.selectedCurrency')"
      />

      <InputField
        v-model="form.amount"
        :label="amountLabel"
        type="number"
        only-positive
        :decimals="decimals"
        :placeholder="$t('forms.portfolioTransfer.amountPlaceholder')"
        :disabled="isAnyMutationPending || disabled"
        :error-message="getFieldErrorMessage('form.amount')"
        @blur="touchField('form.amount')"
      />

      <DateField
        v-model="form.date"
        :label="$t('forms.portfolioTransfer.dateLabel')"
        :disabled="isAnyMutationPending || disabled"
        :error-message="getFieldErrorMessage('form.date')"
        @blur="touchField('form.date')"
      />

      <TextareaField
        v-model="form.description"
        :label="$t('forms.portfolioTransfer.descriptionLabel')"
        :placeholder="$t('forms.portfolioTransfer.descriptionPlaceholder')"
        :disabled="isAnyMutationPending || disabled"
      />
    </template>

    <div class="flex justify-end gap-4">
      <UiButton type="button" variant="secondary" @click="emit('cancel')" :disabled="isAnyMutationPending || disabled">
        {{ $t('forms.portfolioTransfer.cancelButton') }}
      </UiButton>
      <UiButton type="submit" class="min-w-30" :disabled="isSubmitDisabled">
        {{
          isAnyMutationPending
            ? $t('forms.portfolioTransfer.submitButtonLoading')
            : $t('forms.portfolioTransfer.submitButton')
        }}
      </UiButton>
    </div>

    <AlertDialog.AlertDialog v-model:open="showConfirmDialog">
      <AlertDialog.AlertDialogContent>
        <AlertDialog.AlertDialogHeader>
          <AlertDialog.AlertDialogTitle>{{
            $t('forms.portfolioTransfer.confirmDialog.title')
          }}</AlertDialog.AlertDialogTitle>
          <AlertDialog.AlertDialogDescription>
            <i18n-t keypath="forms.portfolioTransfer.confirmDialog.description" tag="span">
              <template #amount>
                <strong>{{ confirmDialogData?.amount }}</strong>
              </template>
              <template #action>
                <span>{{ confirmDialogData?.action }}</span>
              </template>
              <template #from>
                <strong>{{ confirmDialogData?.from }}</strong>
              </template>
              <template #to>
                <strong>{{ confirmDialogData?.to }}</strong>
              </template>
            </i18n-t>
          </AlertDialog.AlertDialogDescription>
        </AlertDialog.AlertDialogHeader>
        <AlertDialog.AlertDialogFooter>
          <AlertDialog.AlertDialogCancel>{{
            $t('forms.portfolioTransfer.confirmDialog.cancelButton')
          }}</AlertDialog.AlertDialogCancel>
          <AlertDialog.AlertDialogAction variant="default" @click="confirmTransfer">
            {{ $t('forms.portfolioTransfer.confirmDialog.confirmButton') }}
          </AlertDialog.AlertDialogAction>
        </AlertDialog.AlertDialogFooter>
      </AlertDialog.AlertDialogContent>
    </AlertDialog.AlertDialog>
  </form>
</template>
