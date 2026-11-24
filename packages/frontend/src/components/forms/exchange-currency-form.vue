<script setup lang="ts">
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { usePortfolioBalances } from '@/composable/data-queries/portfolio-balances';
import { useExchangeCurrency } from '@/composable/data-queries/portfolio-transfers';
import { useFormValidation } from '@/composable/form-validator';
import { useCurrencyDecimalRule } from '@/composable/use-currency-decimal-rule';
import { getCurrencyDecimals, getSmallestCurrencyUnit } from '@/js/helpers/currency-decimals';
import { toLocalCurrencyNumber } from '@/js/helpers/formatters';
import { useCurrenciesStore } from '@/stores';
import type { CurrencyModel, PortfolioModel, UserCurrencyModel } from '@bt/shared/types';
import { format as formatDate } from 'date-fns';
import { minValue, required } from '@vuelidate/validators';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

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
const { currencies } = storeToRefs(useCurrenciesStore());
const { formatAmountByCurrencyCode } = useFormatCurrency();

const portfolioId = toRef(props, 'portfolioId');
const { data: balances } = usePortfolioBalances(portfolioId);

const exchangeMutation = useExchangeCurrency();

const form = reactive<{
  fromCurrency: UserCurrencyModel | null;
  toCurrency: UserCurrencyModel | null;
  fromAmount: string;
  toAmount: string;
  date: Date;
  description: string;
}>({
  fromCurrency: null,
  toCurrency: null,
  fromAmount: '',
  toAmount: '',
  date: new Date(),
  description: '',
});

const balancesByCurrency = computed(() => {
  const map = new Map<string, number>();
  if (balances.value) {
    for (const balance of balances.value) {
      map.set(balance.currencyCode, Number(balance.availableCash));
    }
  }
  return map;
});

// Sort currencies: non-zero balances first (by amount desc), then the rest alphabetically
const sortedCurrencies = computed(() => {
  if (!currencies.value) return [];

  return currencies.value
    .filter((c) => !c.currency?.isCustom)
    .sort((a, b) => {
      const balA = balancesByCurrency.value.get(a.currencyCode) ?? 0;
      const balB = balancesByCurrency.value.get(b.currencyCode) ?? 0;
      if (balA !== 0 && balB !== 0) return balB - balA;
      if (balA !== 0) return -1;
      if (balB !== 0) return 1;
      return a.currencyCode.localeCompare(b.currencyCode);
    });
});

// Exclude the other field's selection so the same currency can't be picked in both
const fromCurrencies = computed(() =>
  sortedCurrencies.value.filter((c) => c.currencyCode !== form.toCurrency?.currencyCode),
);
const toCurrencies = computed(() =>
  sortedCurrencies.value.filter((c) => c.currencyCode !== form.fromCurrency?.currencyCode),
);

const currencyLabel = (currency: UserCurrencyModel) => {
  const code = currency.currency?.code ?? currency.currencyCode;
  const balance = balancesByCurrency.value.get(currency.currencyCode);
  if (balance !== undefined && balance !== 0) {
    return `${code} (${formatAmountByCurrencyCode({ amount: balance, currencyCode: currency.currencyCode })})`;
  }
  return code;
};

// Get available cash for the selected "from" currency
const fromAvailableCash = computed(() => {
  if (!form.fromCurrency) return null;
  return balancesByCurrency.value.get(form.fromCurrency.currencyCode) ?? null;
});

const handleMaxAmount = () => {
  if (fromAvailableCash.value !== null && fromAvailableCash.value > 0) {
    form.fromAmount = String(fromAvailableCash.value);
  }
};

const fromDecimals = computed(() =>
  form.fromCurrency ? getCurrencyDecimals({ code: form.fromCurrency.currencyCode }) : undefined,
);
const toDecimals = computed(() =>
  form.toCurrency ? getCurrencyDecimals({ code: form.toCurrency.currencyCode }) : undefined,
);
const fromCurrencyDecimal = useCurrencyDecimalRule({ decimals: fromDecimals });
const toCurrencyDecimal = useCurrencyDecimalRule({ decimals: toDecimals });

// Validation
const validationRules = computed(() => ({
  fromCurrency: { required },
  toCurrency: { required },
  fromAmount: {
    required,
    minValue: minValue(getSmallestCurrencyUnit({ code: form.fromCurrency?.currencyCode })),
    fromCurrencyDecimal: fromCurrencyDecimal.rule.value,
  },
  toAmount: {
    required,
    minValue: minValue(getSmallestCurrencyUnit({ code: form.toCurrency?.currencyCode })),
    toCurrencyDecimal: toCurrencyDecimal.rule.value,
  },
  date: { required },
}));

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
  {},
  {
    customValidationMessages: {
      required: t('forms.exchangeCurrency.validation.required'),
      minValue: t('forms.exchangeCurrency.validation.minValue'),
      fromCurrencyDecimal: fromCurrencyDecimal.message,
      toCurrencyDecimal: toCurrencyDecimal.message,
    },
  },
);

// Custom validation: currencies must differ
const sameCurrencyError = ref('');

const resetForm = () => {
  form.fromCurrency = null;
  form.toCurrency = null;
  form.fromAmount = '';
  form.toAmount = '';
  form.date = new Date();
  form.description = '';
  sameCurrencyError.value = '';
  resetValidation();
};

watch(
  () => [form.fromCurrency, form.toCurrency],
  () => {
    sameCurrencyError.value = '';
  },
);

const onSubmit = async () => {
  touchField('form.fromCurrency');
  touchField('form.toCurrency');
  touchField('form.fromAmount');
  touchField('form.toAmount');
  touchField('form.date');

  if (!isFormValid('form')) return;

  if (form.fromCurrency!.currencyCode === form.toCurrency!.currencyCode) {
    sameCurrencyError.value = t('forms.exchangeCurrency.validation.sameCurrency');
    return;
  }

  try {
    await exchangeMutation.mutateAsync({
      portfolioId: props.portfolioId,
      fromCurrencyCode: form.fromCurrency!.currencyCode,
      toCurrencyCode: form.toCurrency!.currencyCode,
      fromAmount: String(form.fromAmount),
      toAmount: String(form.toAmount),
      date: formatDate(form.date, 'yyyy-MM-dd'),
      description: form.description || undefined,
    });

    addNotification({
      text: t('forms.exchangeCurrency.notifications.success'),
      type: NotificationType.success,
    });

    resetForm();
    emit('success');
  } catch (error) {
    addNotification({
      text: error instanceof Error ? error.message : t('forms.exchangeCurrency.notifications.error'),
      type: NotificationType.error,
    });
  }
};
</script>

<template>
  <form class="grid w-full max-w-150 gap-6" @submit.prevent="onSubmit">
    <!-- From currency + amount -->
    <SelectField
      v-model="form.fromCurrency"
      :label="$t('forms.exchangeCurrency.fromCurrencyLabel')"
      :values="fromCurrencies"
      value-key="currencyCode"
      :label-key="currencyLabel"
      with-search
      :search-keys="['currencyCode']"
      :placeholder="$t('forms.exchangeCurrency.currencyPlaceholder')"
      :disabled="exchangeMutation.isPending.value || disabled"
      :error-message="getFieldErrorMessage('form.fromCurrency') || sameCurrencyError"
    />

    <div>
      <InputField
        v-model="form.fromAmount"
        :label="$t('forms.exchangeCurrency.fromAmountLabel')"
        type="number"
        only-positive
        :decimals="fromDecimals"
        :placeholder="$t('forms.exchangeCurrency.amountPlaceholder')"
        :disabled="exchangeMutation.isPending.value || disabled"
        :error-message="getFieldErrorMessage('form.fromAmount')"
        @blur="touchField('form.fromAmount')"
      />

      <UiButton
        v-if="fromAvailableCash !== null && fromAvailableCash > 0"
        type="button"
        variant="link"
        size="sm"
        class="mt-1 h-auto p-0"
        @click="handleMaxAmount"
      >
        {{
          $t('forms.exchangeCurrency.maxButton', {
            amount: toLocalCurrencyNumber(fromAvailableCash, { currency: form.fromCurrency?.currencyCode }),
          })
        }}
      </UiButton>
    </div>

    <!-- To currency + amount -->
    <SelectField
      v-model="form.toCurrency"
      :label="$t('forms.exchangeCurrency.toCurrencyLabel')"
      :values="toCurrencies"
      value-key="currencyCode"
      :label-key="currencyLabel"
      with-search
      :search-keys="['currencyCode']"
      :placeholder="$t('forms.exchangeCurrency.currencyPlaceholder')"
      :disabled="exchangeMutation.isPending.value || disabled"
      :error-message="getFieldErrorMessage('form.toCurrency') || sameCurrencyError"
    />

    <InputField
      v-model="form.toAmount"
      :label="$t('forms.exchangeCurrency.toAmountLabel')"
      type="number"
      only-positive
      :decimals="toDecimals"
      :placeholder="$t('forms.exchangeCurrency.amountPlaceholder')"
      :disabled="exchangeMutation.isPending.value || disabled"
      :error-message="getFieldErrorMessage('form.toAmount')"
      @blur="touchField('form.toAmount')"
    />

    <!-- Date -->
    <DateField
      v-model="form.date"
      :label="$t('forms.exchangeCurrency.dateLabel')"
      :disabled="exchangeMutation.isPending.value || disabled"
      :error-message="getFieldErrorMessage('form.date')"
      @blur="touchField('form.date')"
    />

    <!-- Description -->
    <TextareaField
      v-model="form.description"
      :label="$t('forms.exchangeCurrency.descriptionLabel')"
      :placeholder="$t('forms.exchangeCurrency.descriptionPlaceholder')"
      :disabled="exchangeMutation.isPending.value || disabled"
    />

    <!-- Submit / Cancel buttons -->
    <div class="flex justify-end gap-4">
      <UiButton
        type="button"
        variant="secondary"
        :disabled="exchangeMutation.isPending.value || disabled"
        @click="emit('cancel')"
      >
        {{ $t('forms.exchangeCurrency.cancelButton') }}
      </UiButton>
      <UiButton type="submit" class="min-w-30" :disabled="exchangeMutation.isPending.value || disabled">
        {{
          exchangeMutation.isPending.value
            ? $t('forms.exchangeCurrency.submitButtonLoading')
            : $t('forms.exchangeCurrency.submitButton')
        }}
      </UiButton>
    </div>
  </form>
</template>
