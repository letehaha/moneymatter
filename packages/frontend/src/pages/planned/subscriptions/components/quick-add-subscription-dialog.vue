<script setup lang="ts">
import { createSubscription } from '@/api/subscriptions';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TransactionTypeToggle from '@/components/fields/transaction-type-toggle.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { Label } from '@/components/lib/ui/label';
import { useNotificationCenter } from '@/components/notification-center';
import { usePrioritizedCurrencies } from '@/composable/data-queries/prioritized-currencies';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { useFormValidation } from '@/composable/form-validator';
import { useCurrencyName, useFormatCurrency } from '@/composable/formatters';
import { ApiErrorResponseError } from '@/js/errors';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { helpers, required } from '@/js/helpers/validators';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { useCurrenciesStore } from '@/stores';
import {
  type CurrencyModel,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  type SubscriptionModel,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { CreditCardIcon, ReceiptIcon, RepeatIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type QuickAddFormState, buildQuickAddPayload } from '../quick-add-payload';
import { formatFrequency } from '../utils';

const FORM_ID = 'quick-add-subscription-form';

const props = defineProps<{
  /** Seeds the form each time the dialog opens (e.g. from a discovered candidate). */
  prefill?: Partial<QuickAddFormState> | null;
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{
  created: [subscription: SubscriptionModel];
}>();

const { t } = useI18n();
const router = useRouter();
const { addSuccessNotification } = useNotificationCenter();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const { currencies } = usePrioritizedCurrencies();
const { formatCurrencyLabel } = useCurrencyName();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const getInitialState = (): QuickAddFormState => ({
  name: '',
  transactionType: TRANSACTION_TYPES.expense,
  type: SUBSCRIPTION_TYPES.subscription,
  expectedAmount: null,
  expectedCurrencyCode: baseCurrency.value?.currencyCode ?? '',
  frequency: SUBSCRIPTION_FREQUENCIES.monthly,
  nextPaymentDate: null,
  maxOccurrences: null,
  logo: null,
  accountId: null,
  ...props.prefill,
});

const form = ref<QuickAddFormState>(getInitialState());
const formError = ref<string | null>(null);

const isInstallment = computed(() => form.value.type === SUBSCRIPTION_TYPES.installment);

const transactionTypeDescription = computed(() =>
  form.value.transactionType === TRANSACTION_TYPES.income
    ? t('planned.subscriptions.form.transactionTypeIncomeDesc')
    : t('planned.subscriptions.form.transactionTypeExpenseDesc'),
);

const typeOptions = computed(() => [
  {
    value: SUBSCRIPTION_TYPES.subscription,
    label: t('planned.subscriptions.typeSubscription'),
    icon: RepeatIcon,
  },
  { value: SUBSCRIPTION_TYPES.bill, label: t('planned.subscriptions.typeBill'), icon: ReceiptIcon },
  { value: SUBSCRIPTION_TYPES.installment, label: t('planned.subscriptions.typeInstallment'), icon: CreditCardIcon },
]);

const FREQUENCY_OPTIONS = Object.values(SUBSCRIPTION_FREQUENCIES);

const selectedCurrency = computed(
  () => currencies.value.find((c) => c.code === form.value.expectedCurrencyCode) ?? null,
);

const amountDecimals = computed(() => getCurrencyDecimals({ code: form.value.expectedCurrencyCode }));

const installmentTotalLabel = computed(() => {
  const { expectedAmount, maxOccurrences, expectedCurrencyCode } = form.value;
  if (!isInstallment.value || !expectedAmount || !maxOccurrences || !expectedCurrencyCode) return null;
  return formatAmountByCurrencyCode(expectedAmount * maxOccurrences, expectedCurrencyCode);
});

const validationRules = computed(() => ({
  name: { required },
  expectedAmount: {
    requiredForSubscription: helpers.withMessage(
      t('planned.subscriptions.form.validationSubscriptionRequiresAmount'),
      (value: number | null, siblings: QuickAddFormState) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.subscription) return true;
        return value !== null && value > 0;
      },
    ),
  },
  expectedCurrencyCode: {
    requiredWithAmount: helpers.withMessage(
      t('planned.subscriptions.form.validationAmountCurrency'),
      (value: string, siblings: QuickAddFormState) => {
        if (siblings.expectedAmount === null || siblings.expectedAmount <= 0) return true;
        return !!value;
      },
    ),
  },
  nextPaymentDate: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresSchedule'),
      (value: Date | null, siblings: QuickAddFormState) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.installment) return true;
        return value != null;
      },
    ),
  },
  maxOccurrences: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresCount'),
      (value: number | null, siblings: QuickAddFormState) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.installment) return true;
        return value != null && value > 0;
      },
    ),
  },
}));

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
);

watch(isOpen, (opened) => {
  if (!opened) return;
  form.value = getInitialState();
  formError.value = null;
  resetValidation();
});

const { mutate: submit, isPending } = useMutation({
  mutationFn: createSubscription,
  onSuccess: (created) => {
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.createSuccess'));
    // Emitted before closing: close-handlers in the parent may clear the state
    // its `created` listener still needs (e.g. a pending candidate id).
    emit('created', created);
    isOpen.value = false;
    router.push({ name: ROUTES_NAMES.plannedSubscriptionDetails, params: { id: created.id } });
  },
  onError: (error) => {
    formError.value =
      error instanceof ApiErrorResponseError
        ? (error.data.message ?? t('planned.subscriptions.createError'))
        : t('planned.subscriptions.createError');
  },
});

const handleSubmit = () => {
  if (!isFormValid()) return;
  formError.value = null;
  submit(buildQuickAddPayload({ form: form.value, now: new Date() }));
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="max-w-lg">
    <template #title>{{ $t('planned.subscriptions.createTitle') }}</template>

    <form :id="FORM_ID" class="grid gap-4" @submit.prevent="handleSubmit">
      <!-- items-start so a validation error growing below the input doesn't drag the logo down. -->
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InputField
            v-model="form.name"
            :label="$t('planned.subscriptions.form.nameLabel')"
            :placeholder="$t('planned.subscriptions.form.namePlaceholder')"
            :error-message="getFieldErrorMessage('form.name')"
            @blur="touchField('form.name')"
          />
        </div>
        <LogoSquareField
          v-model="form.logo"
          :name-for-search="form.name"
          size-class="size-10 rounded-lg"
          align="with-labeled-field"
        />
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-foreground text-sm font-medium">
          {{ $t('planned.subscriptions.form.transactionTypeLabel') }}
        </span>
        <TransactionTypeToggle v-model="form.transactionType" />
        <p class="text-muted-foreground text-xs leading-snug">{{ transactionTypeDescription }}</p>
      </div>

      <div class="flex flex-col gap-2">
        <Label class="text-sm font-medium">{{ $t('planned.subscriptions.form.typeLabel') }}</Label>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            type="button"
            :aria-pressed="form.type === option.value"
            :class="
              cn(
                'border-input focus-visible:ring-ring flex flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                form.type === option.value
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )
            "
            @click="form.type = option.value"
          >
            <component :is="option.icon" class="size-4 shrink-0" />
            <span class="text-center text-xs leading-tight font-medium">{{ option.label }}</span>
          </button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <InputField
          v-model.number="form.expectedAmount"
          type="number"
          :decimals="amountDecimals"
          :label="$t('planned.subscriptions.form.amountLabel')"
          :placeholder="$t('planned.subscriptions.form.amountPlaceholder')"
          :error-message="getFieldErrorMessage('form.expectedAmount')"
          only-positive
          @blur="touchField('form.expectedAmount')"
        >
          <template v-if="form.type === SUBSCRIPTION_TYPES.subscription" #label-after>
            <span class="text-destructive-text" aria-hidden="true">*</span>
          </template>
        </InputField>
        <SelectField
          :model-value="selectedCurrency"
          :values="currencies"
          value-key="code"
          :label="$t('planned.subscriptions.form.currencyLabel')"
          :placeholder="$t('planned.subscriptions.quickAdd.currencyPlaceholder')"
          :error-message="getFieldErrorMessage('form.expectedCurrencyCode')"
          with-search
          :label-key="(item: CurrencyModel) => formatCurrencyLabel({ code: item.code, fallbackName: item.currency })"
          @update:model-value="(v: CurrencyModel | null) => (form.expectedCurrencyCode = v?.code ?? '')"
          @blur="touchField('form.expectedCurrencyCode')"
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label class="text-sm font-medium">{{ $t('planned.subscriptions.form.frequencyLabel') }}</Label>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="frequency in FREQUENCY_OPTIONS"
            :key="frequency"
            type="button"
            :aria-pressed="form.frequency === frequency"
            :class="
              cn(
                'border-input focus-visible:ring-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                form.frequency === frequency
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )
            "
            @click="form.frequency = frequency"
          >
            {{ formatFrequency({ frequency, t }) }}
          </button>
        </div>
      </div>

      <div class="grid gap-2">
        <DateField
          :model-value="form.nextPaymentDate ?? undefined"
          :label="$t('planned.subscriptions.quickAdd.nextPaymentLabel')"
          :error-message="getFieldErrorMessage('form.nextPaymentDate')"
          @update:model-value="(v: Date | null) => (form.nextPaymentDate = v)"
        />
        <p class="text-muted-foreground -mt-1 text-xs">
          {{
            isInstallment
              ? $t('planned.subscriptions.form.installmentScheduleHint')
              : $t('planned.subscriptions.quickAdd.nextPaymentHint')
          }}
        </p>

        <InputField
          v-if="isInstallment"
          :model-value="form.maxOccurrences ?? undefined"
          type="number"
          :label="$t('planned.subscriptions.form.maxOccurrencesLabel')"
          :placeholder="$t('planned.subscriptions.form.maxOccurrencesInstallmentPlaceholder')"
          :error-message="getFieldErrorMessage('form.maxOccurrences')"
          only-positive
          @update:model-value="(v: string | number | null) => (form.maxOccurrences = v ? Number(v) : null)"
          @blur="touchField('form.maxOccurrences')"
        />
        <p v-if="installmentTotalLabel" class="text-muted-foreground -mt-1 text-xs">
          {{ $t('planned.subscriptions.form.installmentTotalCommitment', { total: installmentTotalLabel }) }}
        </p>
      </div>

      <Callout v-if="formError" variant="destructive">
        <span>{{ formError }}</span>
      </Callout>
    </form>

    <template #footer>
      <div class="flex w-full flex-col gap-3">
        <p class="text-muted-foreground text-xs leading-snug">{{ $t('planned.subscriptions.quickAdd.refineHint') }}</p>
        <div class="flex justify-end gap-2">
          <Button variant="outline" type="button" :disabled="isPending" @click="isOpen = false">
            {{ $t('planned.subscriptions.cancel') }}
          </Button>
          <Button type="submit" :form="FORM_ID" :disabled="isPending">
            {{ $t('planned.subscriptions.form.create') }}
          </Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>
</template>
