<script setup lang="ts">
import { VERBOSE_PAYMENT_TYPES } from '@/common/const';
import { getMaxLoanPayment, isLoanOverpayment, isLoanPaymentPreAnchor } from '@/common/utils/loan-payment';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import FormRow from '@/components/dialogs/manage-transaction/components/form-row.vue';
import { useDeleteTransaction, useSubmitTransaction } from '@/components/dialogs/manage-transaction/composables';
import { useDefaultPaymentType } from '@/components/dialogs/manage-transaction/composables/use-default-payment-type';
import { useLoans, useUnlinkLoanPayment } from '@/composable/data-queries/loans';
import { useDateLocale } from '@/composable/use-date-locale';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { FORM_TYPES, type UI_FORM_STRUCT } from '@/components/dialogs/manage-transaction/types';
import type { FormattedCategory } from '@/common/types';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import SourceAccountInfoPopover from './source-account-info-popover.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useFormValidation } from '@/composable/form-validator';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { useFormatCurrency } from '@/composable/formatters';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useAccountsStore, useCategoriesStore, useCurrenciesStore } from '@/stores';
import { AccountModel, type TransactionModel } from '@bt/shared/types';
import { helpers, minValue, required } from '@vuelidate/validators';
import { HandCoinsIcon, InfoIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { DialogClose, DialogTitle } from 'reka-ui';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Destination loan account. Required for both create and edit modes. */
  loanAccount: AccountModel;
  /** Source-side leg in edit mode (the expense transaction on the user's bank account). */
  transaction?: TransactionModel;
  /** Loan-side leg in edit mode (the income transaction on the loan account). */
  oppositeTransaction?: TransactionModel;
}>();

const emit = defineEmits<{ 'close-modal': [] }>();

const { t } = useI18n();
const { txTargetableSourceAccountsActiveFirst, accountsRecord } = storeToRefs(useAccountsStore());
const { currenciesMap } = storeToRefs(useCurrenciesStore());
// `useSubmitTransaction`'s prepopulateForm-style fallbacks need a real FormattedCategory even though
// loan payments are transfers (categoryId stays null on the wire).
const { formattedCategories } = storeToRefs(useCategoriesStore());

const isEdit = computed(() => Boolean(props.transaction));

const { resolveDefaultAccount } = useAccountDropdownPrefs();

const initialSourceAccount = computed<AccountModel | null>(() => {
  if (props.transaction) return accountsRecord.value[props.transaction.accountId] ?? null;
  return resolveDefaultAccount({ accounts: txTargetableSourceAccountsActiveFirst.value });
});

const form = ref<{
  account: AccountModel | null;
  amount: number | null;
  targetAmount: number | null;
  time: Date;
}>({
  account: initialSourceAccount.value,
  amount: props.transaction?.amount ?? null,
  targetAmount: props.oppositeTransaction?.amount ?? null,
  time: props.transaction ? new Date(props.transaction.time) : new Date(),
});

const sourceCurrency = computed(() => {
  const code = form.value.account?.currencyCode;
  return code ? currenciesMap.value[code]?.currency?.code : undefined;
});
const loanCurrency = computed(() => currenciesMap.value[props.loanAccount.currencyCode]?.currency?.code);
const sourceDecimals = computed(() => getCurrencyDecimals({ code: sourceCurrency.value }));
const loanDecimals = computed(() => getCurrencyDecimals({ code: loanCurrency.value }));

const isCurrenciesDifferent = computed(
  () => !!form.value.account && form.value.account.currencyCode !== props.loanAccount.currencyCode,
);

const { convert: convertCurrency, data: exchangeRates } = useExchangeRates();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();

// Largest payment that keeps the loan at or above zero. In edit mode the
// existing leg is credited back so re-saving the same value isn't an overpay.
const maxLoanPaymentAllowed = computed(() =>
  getMaxLoanPayment({
    loanCurrentBalance: props.loanAccount.currentBalance,
    existingLegAmount: props.oppositeTransaction?.amount ?? 0,
  }),
);

// Reuses the Loans page's TanStack Query cache to reach the loan's balance anchor date.
const { data: loansData } = useLoans();

const loanAnchorDate = computed(
  () => loansData.value?.find((l) => l.id === props.loanAccount.id)?.loanDetails.balanceAnchorDate,
);

// A payment dated before the anchor is already baked into the opening snapshot and
// exempt from the overpay guard on the backend, so the client-side rule skips it too.
const isPreAnchorPayment = computed(() =>
  isLoanPaymentPreAnchor({ paymentDate: form.value.time, balanceAnchorDate: loanAnchorDate.value }),
);

const anchorDateDisplay = computed(() =>
  loanAnchorDate.value ? formatDate(parseISO(loanAnchorDate.value), 'MMM d, yyyy') : '',
);

// Soft heads-up only: flags a positive-balance account being driven negative. Accounts already in the
// red (credit lines) overdraw by design, so they're excluded; the app allows negative balances anyway.
const wouldOverdrawSource = computed(() => {
  const account = form.value.account;
  if (!account) return false;
  const amount = Number(form.value.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return account.currentBalance >= 0 && amount > account.currentBalance;
});

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const submitMutation = useSubmitTransaction({ onSuccess: () => emit('close-modal') });
const deleteMutation = useDeleteTransaction({ onSuccess: () => emit('close-modal') });
const unlinkMutation = useUnlinkLoanPayment();

const isLoading = computed(
  () => submitMutation.isPending.value || deleteMutation.isPending.value || unlinkMutation.isPending.value,
);

// `submit` needs a fallback category from the store; keep the button disabled until it hydrates so a
// fast click after page load doesn't turn into a silent no-op.
const categoriesReady = computed(() => formattedCategories.value.length > 0);

const validationRules = computed(() => {
  // Matches the backend's row-locked overpay guard. Cross-currency validates the loan-side amount;
  // same-currency validates Amount directly (no targetAmount field shown).
  const overpayRule = helpers.withMessage(
    () =>
      t('dialogs.loanPayment.overpayError', {
        max: formatAmountByCurrencyCode(maxLoanPaymentAllowed.value, props.loanAccount.currencyCode),
      }),
    (value: unknown) => {
      // Pre-anchor payments never enter the post-anchor balance sum, so the backend
      // exempts them from the overpay guard — mirror that and let any amount through.
      if (isPreAnchorPayment.value) return true;
      if (value == null || value === '') return true;
      return !isLoanOverpayment({ amount: Number(value), maxPayment: maxLoanPaymentAllowed.value });
    },
  );

  return {
    form: {
      account: { required },
      amount: isCurrenciesDifferent.value
        ? { required, minValue: minValue(0.01) }
        : { required, minValue: minValue(0.01), notOverpay: overpayRule },
      targetAmount: isCurrenciesDifferent.value ? { required, minValue: minValue(0.01), notOverpay: overpayRule } : {},
    },
  };
});

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation(
  { form },
  validationRules,
  {},
  {
    customValidationMessages: {
      required: t('dialogs.manageTransaction.form.validation.required'),
      minValue: t('dialogs.manageTransaction.form.validation.minValue'),
    },
  },
);

const accountErrorMessage = computed(() => getFieldErrorMessage('form.account'));
const amountErrorMessage = computed(() => getFieldErrorMessage('form.amount'));
const targetAmountErrorMessage = computed(() => getFieldErrorMessage('form.targetAmount'));

// Re-fires on every Amount blur; a hand-edited loan-side value survives until Amount changes again.
const prefillTargetAmount = () => {
  if (!isCurrenciesDifferent.value) return;
  if (form.value.amount == null) return;
  const sourceCode = form.value.account?.currencyCode;
  if (!sourceCode) return;
  const converted = convertCurrency({
    amount: Number(form.value.amount),
    from: sourceCode,
    to: props.loanAccount.currencyCode,
  });
  if (converted == null) return;
  form.value.targetAmount = converted;
};

const onAmountBlur = () => {
  touchField('form.amount');
  prefillTargetAmount();
};

// Rates start as empty placeholder data, so a user who fills Amount first gets no prefill. Re-run once
// rates land, but only while the loan-side field is still empty so a hand-entered value survives.
watch(exchangeRates, () => {
  if (form.value.targetAmount != null) return;
  prefillTargetAmount();
});

// Update params always forward `paymentType`, so in edit mode it must reflect the stored value — a
// fixed default would silently rewrite it. The user's default applies to new payments only.
const { defaultPaymentType } = useDefaultPaymentType();
const paymentType = computed(() =>
  props.transaction
    ? (VERBOSE_PAYMENT_TYPES.find((item) => item.value === props.transaction?.paymentType) ?? null)
    : defaultPaymentType.value,
);

const buildFormStruct = ({ fallbackCategory }: { fallbackCategory: FormattedCategory }): UI_FORM_STRUCT => ({
  type: FORM_TYPES.transfer,
  amount: Number(form.value.amount),
  account: form.value.account!,
  toAccount: props.loanAccount,
  toPortfolio: null,
  targetAmount: isCurrenciesDifferent.value ? Number(form.value.targetAmount) : Number(form.value.amount),
  category: fallbackCategory,
  time: form.value.time,
  paymentType: paymentType.value,
  note: undefined,
  refundedByTxs: undefined,
  refundsTx: undefined,
  // Seeded from the source leg so an edit with no tag/payee UI in this dialog
  // diffs to "unchanged" against `prepareTxUpdationParams` instead of wiping
  // whatever the transaction already carries. `props.transaction` is absent
  // in creation mode, so both fall back to empty naturally.
  tagIds: props.transaction?.tags?.map((tag) => tag.id) ?? [],
  payeeId: props.transaction?.payeeId ?? null,
  categoryUserTouched: false,
});

const submit = () => {
  touchField('form.account');
  touchField('form.amount');
  touchField('form.targetAmount');
  if (!isFormValid('form')) return;

  // Transfers persist with `categoryId: null` — `fallbackCategory` only satisfies UI_FORM_STRUCT's
  // non-nullable type; this guard keeps an unhydrated categories store from smuggling `undefined` through it.
  const fallbackCategory = formattedCategories.value[0];
  if (!fallbackCategory) return;

  submitMutation.mutate({
    form: buildFormStruct({ fallbackCategory }),
    isFormCreation: !isEdit.value,
    isTransferTx: true,
    isCurrenciesDifferent: isCurrenciesDifferent.value,
    isOriginalRefundsOverriden: false,
    isRecordExternal: false,
    transaction: props.transaction,
    oppositeTransaction: props.oppositeTransaction,
    linkedTransaction: null,
  });
};

const isDeleteConfirmOpen = ref(false);
const isUnlinkConfirmOpen = ref(false);

const deletePayment = () => {
  if (!props.transaction) return;
  deleteMutation.mutate({ transactionId: props.transaction.id });
};

const unlinkPayment = () => {
  if (!props.transaction) return;
  unlinkMutation.mutate(
    { id: props.loanAccount.id, transactionId: props.transaction.id },
    {
      onSuccess: () => {
        addSuccessNotification(t('dialogs.loanPayment.unlinkSuccess'));
        emit('close-modal');
      },
      onError: (error) => {
        if (error instanceof ApiErrorResponseError) {
          addErrorNotification(error.data.message ?? error.message);
        } else {
          addErrorNotification(t('dialogs.loanPayment.unlinkError'));
        }
      },
    },
  );
};
</script>

<template>
  <div class="rounded-t-xl">
    <div class="bg-app-transfer-color h-3 rounded-t-lg" />
    <div class="mb-4 flex items-center justify-between px-6 py-3">
      <DialogTitle>
        <span class="text-2xl">
          {{ isEdit ? $t('dialogs.loanPayment.editTitle') : $t('dialogs.loanPayment.createTitle') }}
        </span>
      </DialogTitle>
      <DialogClose as-child>
        <Button variant="ghost">{{ $t('dialogs.manageTransaction.form.closeButton') }}</Button>
      </DialogClose>
    </div>

    <div class="space-y-1 px-6 pb-6">
      <div class="bg-muted/40 mb-4 flex items-center gap-2 rounded-lg px-3 py-2.5">
        <HandCoinsIcon class="text-app-transfer-color size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-muted-foreground text-xs">{{ $t('dialogs.loanPayment.payingTo') }}</div>
          <div class="truncate text-sm font-medium">{{ loanAccount.name }}</div>
        </div>
        <div class="text-muted-foreground shrink-0 text-xs">{{ loanCurrency }}</div>
      </div>

      <FormRow>
        <AccountSelectField
          v-model="form.account"
          :label="$t('dialogs.loanPayment.fromAccountLabel')"
          :accounts="txTargetableSourceAccountsActiveFirst"
          :placeholder="$t('dialogs.loanPayment.fromAccountPlaceholder')"
          :disabled="isLoading"
          :error-message="accountErrorMessage"
        />
      </FormRow>

      <Callout variant="info" class="mb-2 text-xs">
        {{ $t('dialogs.loanPayment.syncedAccountHint') }} <SourceAccountInfoPopover />
      </Callout>

      <FormRow>
        <InputField
          v-model="form.amount"
          :label="$t('dialogs.loanPayment.amountLabel')"
          type="number"
          :decimals="sourceDecimals"
          only-positive
          :placeholder="$t('dialogs.loanPayment.amountPlaceholder')"
          :disabled="isLoading"
          :error-message="amountErrorMessage"
          @blur="onAmountBlur"
        >
          <template #iconTrailing>
            <span>{{ sourceCurrency }}</span>
          </template>
        </InputField>
      </FormRow>

      <p v-if="wouldOverdrawSource" class="text-warning-text -mt-1 px-1 text-xs">
        {{ $t('dialogs.loanPayment.overdrawWarning', { account: form.account?.name ?? '' }) }}
      </p>

      <FormRow v-if="isCurrenciesDifferent">
        <InputField
          v-model="form.targetAmount"
          :label="$t('dialogs.loanPayment.targetAmountLabel')"
          type="number"
          :decimals="loanDecimals"
          only-positive
          :placeholder="$t('dialogs.loanPayment.targetAmountPlaceholder')"
          :disabled="isLoading"
          :error-message="targetAmountErrorMessage"
          @blur="touchField('form.targetAmount')"
        >
          <template #label-after>
            <DesktopOnlyTooltip
              :content="
                $t('dialogs.loanPayment.targetAmountTooltip', {
                  source: sourceCurrency ?? '',
                  loan: loanCurrency ?? '',
                })
              "
              side="top"
            >
              <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
            </DesktopOnlyTooltip>
          </template>
          <template #iconTrailing>
            <span>{{ loanCurrency }}</span>
          </template>
        </InputField>
      </FormRow>

      <FormRow>
        <DateField
          v-model="form.time"
          :label="$t('dialogs.manageTransaction.form.datetimeLabel')"
          :disabled="isLoading"
          :calendar-options="{ maxDate: new Date() }"
        />
      </FormRow>

      <p v-if="isPreAnchorPayment" class="text-warning-text -mt-1 px-1 text-xs">
        {{ $t('dialogs.loanPayment.preAnchorWarning', { date: anchorDateDisplay }) }}
      </p>

      <div class="flex items-center justify-between pt-6">
        <div v-if="isEdit" class="flex gap-2">
          <Button class="min-w-25" variant="destructive" :disabled="isLoading" @click="isDeleteConfirmOpen = true">
            {{ $t('dialogs.manageTransaction.form.deleteButton') }}
          </Button>
          <Button class="min-w-25" variant="destructive" :disabled="isLoading" @click="isUnlinkConfirmOpen = true">
            {{ $t('dialogs.loanPayment.unlinkButton') }}
          </Button>
        </div>
        <Button class="ml-auto min-w-30" :disabled="isLoading || !categoriesReady" @click="submit">
          {{
            isLoading
              ? $t('dialogs.manageTransaction.form.loadingButton')
              : isEdit
                ? $t('dialogs.loanPayment.saveButton')
                : $t('dialogs.loanPayment.recordButton')
          }}
        </Button>
      </div>
    </div>

    <ResponsiveAlertDialog
      v-model:open="isDeleteConfirmOpen"
      :confirm-label="$t('dialogs.manageTransaction.form.deleteButton')"
      confirm-variant="destructive"
      :confirm-disabled="isLoading"
      @confirm="deletePayment"
    >
      <template #title>{{ $t('dialogs.loanPayment.deleteConfirmTitle') }}</template>
      <template #description>{{ $t('dialogs.loanPayment.deleteConfirmDescription') }}</template>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isUnlinkConfirmOpen"
      :confirm-label="$t('dialogs.loanPayment.unlinkButton')"
      confirm-variant="destructive"
      :confirm-disabled="isLoading"
      @confirm="unlinkPayment"
    >
      <template #title>{{ $t('dialogs.loanPayment.unlinkConfirmTitle') }}</template>
      <template #description>{{ $t('dialogs.loanPayment.unlinkConfirmDescription') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
