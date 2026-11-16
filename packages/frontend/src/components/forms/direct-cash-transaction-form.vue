<script setup lang="ts">
import HintIcon from '@/components/common/hint-icon.vue';
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import * as AlertDialog from '@/components/lib/ui/alert-dialog';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Separator } from '@/components/lib/ui/separator';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useFormatCurrency } from '@/composable';
import {
  useAccountToPortfolioTransfer,
  useCreateDirectCashTransaction,
  useLinkTransactionToPortfolio,
  usePortfolioToAccountTransfer,
} from '@/composable/data-queries/portfolio-transfers';
import { usePortfolioCurrencySorting } from '@/composable/data-queries/use-portfolio-currency-sorting';
import { useFormValidation } from '@/composable/form-validator';
import { useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import type { AccountModel, PortfolioModel, TransactionModel, UserCurrencyModel } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, X } from '@lucide/vue';
import { minValue, required } from '@vuelidate/validators';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type OperationType = 'deposit' | 'withdrawal';
type MethodType = 'direct' | 'transfer';

interface Emit {
  (e: 'success'): void;
  (e: 'cancel'): void;
}

const props = defineProps<{
  portfolioId: string;
  portfolio: PortfolioModel;
  disabled?: boolean;
}>();

const emit = defineEmits<Emit>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
// Loan accounts excluded – money only flows INTO a loan (transfer_to_loan), so they can't be a transfer source.
const { txTargetableSourceAccountsActiveFirst: txTargetableAccountsActiveFirst, accountsRecord } =
  storeToRefs(accountsStore);
const { currencies } = storeToRefs(useCurrenciesStore());
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { sortedCurrencies, currencyLabel } = usePortfolioCurrencySorting(computed(() => props.portfolioId));
const { resolveDefaultAccount } = useAccountDropdownPrefs();

const defaultTransferAccount = () =>
  resolveDefaultAccount({ accounts: txTargetableAccountsActiveFirst.value, fallbackToFirst: false });

// Mutations
const directCashMutation = useCreateDirectCashTransaction();
const accountToPortfolioMutation = useAccountToPortfolioTransfer();
const portfolioToAccountMutation = usePortfolioToAccountTransfer();
const linkToPortfolioMutation = useLinkTransactionToPortfolio();

// Tab state
const operationType = ref<OperationType>('deposit');
const methodType = ref<MethodType>('direct');

const outerItems = computed(() => [
  {
    value: 'deposit',
    label: t('forms.directCashTransaction.operationTypes.deposit'),
    icon: ArrowDownIcon,
  },
  {
    value: 'withdrawal',
    label: t('forms.directCashTransaction.operationTypes.withdrawal'),
    icon: ArrowUpIcon,
  },
]);

const innerItems = computed(() => [
  {
    value: 'direct',
    label: t('forms.directCashTransaction.methodTypes.direct'),
  },
  {
    value: 'transfer',
    label: t('forms.directCashTransaction.methodTypes.transfer'),
  },
]);

// Direct mode form
const directForm = reactive<{
  amount: string;
  selectedCurrency: UserCurrencyModel | null;
  date: Date;
  description: string;
  isAdjustment: boolean;
}>({
  amount: '',
  selectedCurrency: null,
  date: new Date(),
  description: '',
  isAdjustment: false,
});

// Transfer mode form
const transferForm = reactive<{
  selectedAccount: AccountModel | null;
  amount: string;
  selectedCurrency: UserCurrencyModel | null;
  date: Date;
  description: string;
}>({
  selectedAccount: defaultTransferAccount(),
  amount: '',
  selectedCurrency: null,
  date: new Date(),
  description: '',
});

// Link existing transaction state
const linkedTransaction = ref<TransactionModel | null>(null);
const linkedCashAlreadyReflected = ref(false);
const isPickerOpen = ref(false);
const isLinkMode = computed(() => !!linkedTransaction.value);

// Confirmation dialog state
const showConfirmDialog = ref(false);
const confirmDialogData = ref<{
  from: string;
  to: string;
  amount: string;
  action: string;
} | null>(null);

// Transaction type filter for picker
const pickerTransactionType = computed(() => {
  // Deposit = money coming IN to portfolio = the account transaction is an EXPENSE
  // Withdrawal = money going OUT of portfolio = the account transaction is INCOME
  if (operationType.value === 'deposit') return TRANSACTION_TYPES.expense;
  return TRANSACTION_TYPES.income;
});

// Show currency selector only for withdrawal+transfer (user picks currency from portfolio)
const showTransferCurrency = computed(() => operationType.value === 'withdrawal' && methodType.value === 'transfer');

// Watchers for resetting state on tab changes
watch(operationType, () => {
  methodType.value = 'direct';
  linkedTransaction.value = null;
  linkedCashAlreadyReflected.value = false;
  resetDirectForm();
  resetTransferForm();
});

watch(methodType, () => {
  linkedTransaction.value = null;
  linkedCashAlreadyReflected.value = false;
  if (methodType.value === 'direct') {
    resetDirectForm();
  } else {
    resetTransferForm();
  }
});

// Auto-set currency from selected account for deposit+transfer
watch(
  () => transferForm.selectedAccount,
  (account) => {
    if (operationType.value === 'deposit' && account?.currencyCode) {
      transferForm.selectedCurrency = currencies.value?.find((c) => c.currencyCode === account.currencyCode) || null;
    }
  },
);

// Validation for direct form
const directValidationRules = computed(() => ({
  amount: { required, minValue: minValue(0.01) },
  selectedCurrency: { required },
  date: { required },
}));

const {
  isFormValid: isDirectFormValid,
  getFieldErrorMessage: getDirectFieldError,
  touchField: touchDirectField,
  resetValidation: resetDirectValidation,
} = useFormValidation(
  { directForm },
  { directForm: directValidationRules },
  {},
  {
    customValidationMessages: {
      required: t('forms.directCashTransaction.validation.required'),
      minValue: t('forms.directCashTransaction.validation.minValue'),
    },
  },
);

// Validation for transfer form
const transferValidationRules = computed(() => ({
  selectedAccount: { required },
  amount: { required, minValue: minValue(0.01) },
  ...(showTransferCurrency.value ? { selectedCurrency: { required } } : {}),
}));

const {
  isFormValid: isTransferFormValid,
  getFieldErrorMessage: getTransferFieldError,
  touchField: touchTransferField,
  resetValidation: resetTransferValidation,
} = useFormValidation(
  { transferForm },
  { transferForm: transferValidationRules },
  {},
  {
    customValidationMessages: {
      required: t('forms.directCashTransaction.validation.required'),
      minValue: t('forms.directCashTransaction.validation.minValue'),
    },
  },
);

const resetDirectForm = () => {
  directForm.amount = '';
  directForm.selectedCurrency = null;
  directForm.date = new Date();
  directForm.description = '';
  directForm.isAdjustment = false;
  resetDirectValidation();
};

const resetTransferForm = () => {
  transferForm.selectedAccount = defaultTransferAccount();
  transferForm.amount = '';
  transferForm.selectedCurrency = null;
  transferForm.date = new Date();
  transferForm.description = '';
  resetTransferValidation();
};

const prepareConfirmationData = () => {
  let fromName: string;
  let toName: string;
  let amount: string;
  let action: string;

  if (isLinkMode.value && linkedTransaction.value) {
    const tx = linkedTransaction.value;
    amount = formatAmountByCurrencyCode(tx.amount, tx.currencyCode);
    const accountName =
      accountsRecord.value[tx.accountId]?.name || t('forms.directCashTransaction.linkedTransactionLabel');

    if (operationType.value === 'deposit') {
      action = t('forms.directCashTransaction.confirmDialog.actionDeposit');
      fromName = accountName;
      toName = props.portfolio.name;
    } else {
      action = t('forms.directCashTransaction.confirmDialog.actionWithdrawal');
      fromName = props.portfolio.name;
      toName = accountName;
    }
  } else {
    const currencyCode =
      transferForm.selectedCurrency?.currency?.code || transferForm.selectedAccount?.currencyCode || '';
    amount = formatAmountByCurrencyCode(Number(transferForm.amount), currencyCode);
    const accountName = transferForm.selectedAccount?.name || '';

    if (operationType.value === 'deposit') {
      action = t('forms.directCashTransaction.confirmDialog.actionDeposit');
      fromName = accountName;
      toName = props.portfolio.name;
    } else {
      action = t('forms.directCashTransaction.confirmDialog.actionWithdrawal');
      fromName = props.portfolio.name;
      toName = accountName;
    }
  }

  confirmDialogData.value = { from: fromName, to: toName, amount, action };
};

const onSubmit = async () => {
  if (methodType.value === 'direct') {
    touchDirectField('directForm.amount');
    touchDirectField('directForm.selectedCurrency');
    touchDirectField('directForm.date');

    if (!isDirectFormValid('directForm')) return;

    // Direct mode submits immediately without confirmation
    try {
      await directCashMutation.mutateAsync({
        portfolioId: props.portfolioId,
        type: operationType.value,
        amount: String(directForm.amount),
        currencyCode: directForm.selectedCurrency!.currencyCode,
        date: directForm.date.toISOString().split('T')[0]!,
        description: directForm.description || undefined,
        isAdjustment: directForm.isAdjustment,
      });

      addNotification({
        text: t('forms.directCashTransaction.notifications.success'),
        type: NotificationType.success,
      });

      resetDirectForm();
      emit('success');
    } catch (error) {
      addNotification({
        text: error instanceof Error ? error.message : t('forms.directCashTransaction.notifications.error'),
        type: NotificationType.error,
      });
    }
  } else {
    // Transfer mode
    if (isLinkMode.value) {
      if (!linkedTransaction.value) return;
    } else {
      touchTransferField('transferForm.selectedAccount');
      touchTransferField('transferForm.amount');
      if (showTransferCurrency.value) {
        touchTransferField('transferForm.selectedCurrency');
      }

      if (!isTransferFormValid('transferForm')) return;
    }

    prepareConfirmationData();
    showConfirmDialog.value = true;
  }
};

const confirmTransfer = async () => {
  try {
    showConfirmDialog.value = false;

    if (isLinkMode.value && linkedTransaction.value) {
      await linkToPortfolioMutation.mutateAsync({
        transactionId: linkedTransaction.value.id,
        portfolioId: props.portfolioId,
        affectsCash: !linkedCashAlreadyReflected.value,
      });
    } else if (operationType.value === 'deposit') {
      // Account to portfolio transfer
      await accountToPortfolioMutation.mutateAsync({
        portfolioId: props.portfolioId,
        accountId: transferForm.selectedAccount!.id,
        amount: String(transferForm.amount),
        date: transferForm.date.toISOString().split('T')[0]!,
        description: transferForm.description || undefined,
      });
    } else {
      // Portfolio to account transfer
      await portfolioToAccountMutation.mutateAsync({
        portfolioId: props.portfolioId,
        accountId: transferForm.selectedAccount!.id,
        amount: String(transferForm.amount),
        currencyCode: transferForm.selectedCurrency!.currencyCode,
        date: transferForm.date.toISOString().split('T')[0]!,
        description: transferForm.description || undefined,
      });
    }

    addNotification({
      text: t('forms.directCashTransaction.notifications.success'),
      type: NotificationType.success,
    });

    resetTransferForm();
    linkedTransaction.value = null;
    linkedCashAlreadyReflected.value = false;
    accountsStore.refetchAccounts();
    emit('success');
  } catch (error) {
    addNotification({
      text: error instanceof Error ? error.message : t('forms.directCashTransaction.notifications.error'),
      type: NotificationType.error,
    });
  }
};

const isAnyMutationPending = computed(
  () =>
    directCashMutation.isPending.value ||
    accountToPortfolioMutation.isPending.value ||
    portfolioToAccountMutation.isPending.value ||
    linkToPortfolioMutation.isPending.value,
);

const isSubmitDisabled = computed(() => {
  if (props.disabled || isAnyMutationPending.value) return true;

  if (methodType.value === 'direct') {
    return !directForm.amount || !directForm.selectedCurrency;
  }

  // Transfer mode
  if (isLinkMode.value) {
    return !linkedTransaction.value;
  }

  return (
    !transferForm.selectedAccount ||
    !transferForm.amount ||
    (showTransferCurrency.value && !transferForm.selectedCurrency)
  );
});

const accountLabel = computed(() =>
  operationType.value === 'deposit'
    ? t('forms.directCashTransaction.fromAccountLabel')
    : t('forms.directCashTransaction.toAccountLabel'),
);
</script>

<template>
  <div class="grid w-full max-w-150 gap-6">
    <!-- Outer tabs: Deposit / Withdrawal -->
    <PillTabs v-model="operationType" :items="outerItems" :disabled="isAnyMutationPending || disabled" size="lg" />

    <!-- Inner tabs: Direct / Transfer -->
    <PillTabs v-model="methodType" :items="innerItems" :disabled="isAnyMutationPending || disabled" />

    <form class="grid gap-6" @submit.prevent="onSubmit">
      <!-- ─── Direct mode ─── -->
      <template v-if="methodType === 'direct'">
        <InputField
          v-model="directForm.amount"
          :label="$t('forms.directCashTransaction.amountLabel')"
          type="number"
          step="0.01"
          min="0.01"
          :placeholder="$t('forms.directCashTransaction.amountPlaceholder')"
          :disabled="isAnyMutationPending || disabled"
          :error="getDirectFieldError('directForm.amount')"
          @blur="touchDirectField('directForm.amount')"
        />

        <SelectField
          v-model="directForm.selectedCurrency"
          :label="$t('forms.directCashTransaction.currencyLabel')"
          :values="sortedCurrencies"
          value-key="currencyCode"
          :label-key="currencyLabel"
          :placeholder="$t('forms.directCashTransaction.currencyPlaceholder')"
          :disabled="isAnyMutationPending || disabled"
          :error-message="getDirectFieldError('directForm.selectedCurrency')"
        />

        <DateField
          v-model="directForm.date"
          :label="$t('forms.directCashTransaction.dateLabel')"
          :disabled="isAnyMutationPending || disabled"
          :error-message="getDirectFieldError('directForm.date')"
          @blur="touchDirectField('directForm.date')"
        />

        <TextareaField
          v-model="directForm.description"
          :label="$t('forms.directCashTransaction.descriptionLabel')"
          :placeholder="$t('forms.directCashTransaction.descriptionPlaceholder')"
          :disabled="isAnyMutationPending || disabled"
        />

        <label class="flex cursor-pointer items-start gap-3">
          <Checkbox
            v-model="directForm.isAdjustment"
            :disabled="isAnyMutationPending || disabled"
            class="mt-0.5 shrink-0"
          />
          <span class="grid gap-1">
            <span class="text-sm leading-none font-medium">
              {{ $t('forms.directCashTransaction.adjustmentLabel') }}
            </span>
            <span class="text-muted-foreground text-xs">
              {{ $t('forms.directCashTransaction.adjustmentHint') }}
            </span>
          </span>
        </label>
      </template>

      <!-- ─── Transfer mode ─── -->
      <template v-else>
        <!-- Linked transaction display -->
        <template v-if="isLinkMode">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <TransactionRecord :tx="linkedTransaction!" :as-button="false" />
            </div>
            <UiButton type="button" variant="ghost" size="icon-sm" class="shrink-0" @click="linkedTransaction = null">
              <X :size="16" />
            </UiButton>
          </div>

          <div class="flex items-center gap-2">
            <label class="flex cursor-pointer items-center gap-3">
              <Checkbox v-model="linkedCashAlreadyReflected" :disabled="isAnyMutationPending || disabled" />
              <span class="text-sm leading-none font-medium">
                {{ $t('dialogs.manageTransaction.form.portfolioCashAlreadyReflectedLabel') }}
              </span>
            </label>
            <HintIcon :content="$t('dialogs.manageTransaction.form.portfolioCashAlreadyReflectedHint')" />
          </div>
        </template>

        <!-- Manual transfer fields -->
        <template v-else>
          <AccountSelectField
            v-model="transferForm.selectedAccount"
            :label="accountLabel"
            :accounts="txTargetableAccountsActiveFirst"
            :placeholder="$t('forms.directCashTransaction.accountPlaceholder')"
            :disabled="isAnyMutationPending || disabled"
            :error-message="getTransferFieldError('transferForm.selectedAccount')"
          />

          <InputField
            v-model="transferForm.amount"
            :label="$t('forms.directCashTransaction.amountLabel')"
            type="number"
            step="0.01"
            min="0.01"
            :placeholder="$t('forms.directCashTransaction.amountPlaceholder')"
            :disabled="isAnyMutationPending || disabled"
            :error="getTransferFieldError('transferForm.amount')"
            @blur="touchTransferField('transferForm.amount')"
          />

          <SelectField
            v-if="showTransferCurrency"
            v-model="transferForm.selectedCurrency"
            :label="$t('forms.directCashTransaction.currencyLabel')"
            :values="sortedCurrencies"
            value-key="currencyCode"
            :label-key="currencyLabel"
            :placeholder="$t('forms.directCashTransaction.currencyPlaceholder')"
            :disabled="isAnyMutationPending || disabled"
            :error-message="getTransferFieldError('transferForm.selectedCurrency')"
          />

          <DateField
            v-model="transferForm.date"
            :label="$t('forms.directCashTransaction.dateLabel')"
            :disabled="isAnyMutationPending || disabled"
            @blur="touchTransferField('transferForm.date')"
          />

          <TextareaField
            v-model="transferForm.description"
            :label="$t('forms.directCashTransaction.descriptionLabel')"
            :placeholder="$t('forms.directCashTransaction.descriptionPlaceholder')"
            :disabled="isAnyMutationPending || disabled"
          />

          <!-- "or" separator -->
          <div class="relative flex items-center py-2">
            <Separator class="flex-1" />
            <span class="text-muted-foreground bg-dialog px-4 text-sm">
              {{ $t('forms.directCashTransaction.orSeparator') }}
            </span>
            <Separator class="flex-1" />
          </div>
        </template>

        <!-- Link existing transaction button -->
        <UiButton
          v-if="!isLinkMode"
          type="button"
          variant="default"
          class="w-full"
          :disabled="isAnyMutationPending || disabled"
          @click="isPickerOpen = true"
        >
          {{ $t('forms.directCashTransaction.linkExistingTransaction') }}
        </UiButton>

        <PickTransactionDialog
          v-model:open="isPickerOpen"
          :transaction-type="pickerTransactionType"
          @select="(tx: TransactionModel) => (linkedTransaction = tx)"
        />
      </template>

      <!-- Submit / Cancel buttons -->
      <div class="flex justify-end gap-4">
        <UiButton
          type="button"
          variant="secondary"
          :disabled="isAnyMutationPending || disabled"
          @click="emit('cancel')"
        >
          {{ $t('forms.directCashTransaction.cancelButton') }}
        </UiButton>
        <UiButton type="submit" class="min-w-30" :disabled="isSubmitDisabled">
          {{
            isAnyMutationPending
              ? $t('forms.directCashTransaction.submitButtonLoading')
              : $t('forms.directCashTransaction.submitButton')
          }}
        </UiButton>
      </div>
    </form>

    <!-- Confirmation dialog for transfer mode -->
    <AlertDialog.AlertDialog v-model:open="showConfirmDialog">
      <AlertDialog.AlertDialogContent>
        <AlertDialog.AlertDialogHeader>
          <AlertDialog.AlertDialogTitle>
            {{ $t('forms.directCashTransaction.confirmDialog.title') }}
          </AlertDialog.AlertDialogTitle>
          <AlertDialog.AlertDialogDescription>
            <i18n-t keypath="forms.directCashTransaction.confirmDialog.description" tag="span">
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
          <AlertDialog.AlertDialogCancel>
            {{ $t('forms.directCashTransaction.confirmDialog.cancelButton') }}
          </AlertDialog.AlertDialogCancel>
          <AlertDialog.AlertDialogAction variant="default" @click="confirmTransfer">
            {{ $t('forms.directCashTransaction.confirmDialog.confirmButton') }}
          </AlertDialog.AlertDialogAction>
        </AlertDialog.AlertDialogFooter>
      </AlertDialog.AlertDialogContent>
    </AlertDialog.AlertDialog>
  </div>
</template>
