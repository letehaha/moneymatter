<template>
  <div>
    <div class="flex flex-col gap-3 @[26rem]/currencies:flex-row @[26rem]/currencies:items-end">
      <input-field
        v-model="form.baseRate"
        class="min-w-0 @[26rem]/currencies:flex-1"
        :label="`1 ${currency.currency?.code} =`"
        :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
        :disabled="isLiveRateEnabled"
        @focus="onBaseFocus"
      />
      <input-field
        v-model="form.quoteRate"
        class="min-w-0 @[26rem]/currencies:flex-1"
        :label="`1 ${currency.quoteCode} =`"
        :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
        :disabled="isLiveRateEnabled"
        @focus="onQuoteFocus"
      />
      <DateField
        v-if="isCustomCurrency"
        v-model="effectiveDate"
        mode="date"
        class="min-w-0 @[26rem]/currencies:flex-1"
        :label="$t('settings.currencies.rateSource.manual.effectiveFromLabel')"
        :disabled="isFormDisabled"
        :calendar-options="effectiveDateOptions"
        data-testid="manual-rate-effective-date"
      />
      <Button
        v-if="shouldShowSaveButton"
        class="min-w-24 shrink-0"
        :disabled="!canSubmit || isFormDisabled"
        :loading="isFormDisabled"
        @click="onSubmitHandler"
      >
        {{ $t('settings.currencies.exchangeRate.saveButton') }}
      </Button>
    </div>

    <template v-if="isCustomCurrency">
      <p class="text-muted-foreground mt-4 flex items-start gap-1 text-xs leading-5">
        <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
        {{ $t('settings.currencies.custom.rateHint', { code: currency.quoteCode }) }}
      </p>
      <p class="text-muted-foreground mt-2 flex items-start gap-1 text-xs leading-5">
        <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
        {{ $t('settings.currencies.rateSource.manual.datedHint') }}
      </p>

      <RemoveDatedRate
        class="mt-3"
        :currency="currency"
        :is-form-disabled="isFormDisabled"
        @submit="emit('submit')"
        @trigger-disabled="emit('trigger-disabled', $event)"
      />
    </template>

    <label
      v-else
      class="mt-4 flex cursor-pointer items-start justify-between gap-4 aria-disabled:cursor-default"
      :aria-disabled="isFormDisabled"
    >
      <span class="text-muted-foreground min-w-0 text-xs leading-5">
        {{ $t('settings.currencies.exchangeRate.disableLiveUpdate') }}
        <span class="mt-0.5 flex items-center gap-1">
          <InfoIcon class="text-primary-text size-3.5 shrink-0" />
          {{ $t('settings.currencies.exchangeRate.liveUpdateInfo') }}
        </span>
      </span>

      <span class="flex shrink-0 items-center gap-2">
        <span class="text-sm">{{ $t('settings.currencies.exchangeRate.liveUpdateLabel') }}</span>
        <Checkbox
          :model-value="isLiveRateEnabled"
          :disabled="isFormDisabled"
          @update:model-value="toggleChange(Boolean($event))"
        />
      </span>
    </label>
  </div>
</template>

<script setup lang="ts">
import { deleteCustomRate, editUserCurrenciesExchangeRates } from '@/api/currencies';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { API_ERROR_CODES } from '@bt/shared/types';
import { format, isToday } from 'date-fns';
import { InfoIcon } from '@lucide/vue';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { CurrencyWithExchangeRate } from '../types';
import RemoveDatedRate from './remove-dated-rate.vue';

const API_DATE_FORMAT = 'yyyy-MM-dd';

const RATIO_DIGITS = 6;
// A custom currency can be worth a tiny fraction of its quote, so its inverse keeps significant
// digits rather than a fixed number of decimals.
const CUSTOM_RATIO_SIGNIFICANT_DIGITS = 12;

const calculateRatio = ({ value, isCustomCurrency }: { value: number | string; isCustomCurrency: boolean }) => {
  const num = 1 / Number(value);
  const result = isCustomCurrency
    ? Number(num.toPrecision(CUSTOM_RATIO_SIGNIFICANT_DIGITS))
    : Math.round(num * 10 ** RATIO_DIGITS) / 10 ** RATIO_DIGITS;

  return Number.isFinite(result) ? result : 0;
};

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const { addSuccessNotification, addWarningNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

// A custom-rate change re-anchors this user's account balances to the new rate.
// When no market rate is available for an account's currency yet, the backend
// keeps that account's stale base-currency value and reports it as `failed`; warn
// the user so the unchanged balance isn't mistaken for the rate not saving.
const notifyIfBalancesNotRefreshed = (failed: number) => {
  if (failed > 0) {
    addWarningNotification(t('settings.currencies.exchangeRate.balancesNotRefreshed', { count: failed }));
  }
};

const isCustomCurrency = computed(() => Boolean(props.currency.currency?.isCustom));

// A custom currency starts without a rate; the fields stay empty until the user enters one.
const toFieldValue = (value: number): number | string => (Number.isFinite(value) ? value : '');

const form = reactive<{ baseRate: number | string; quoteRate: number | string }>({
  baseRate: toFieldValue(props.currency.rate),
  quoteRate: toFieldValue(props.currency.quoteRate),
});
const isBaseEditing = ref(false);
const isQuoteEditing = ref(false);
// A custom currency has no market rate to follow, so only the user's own rate applies.
const isLiveRateEnabled = ref<boolean>(!isCustomCurrency.value && !props.currency.custom);

// A rate of a custom currency starts to apply on a day of its own; today unless the user picks another.
const effectiveDate = ref(new Date());
const effectiveDateOptions = { maxDate: new Date() };
const isDateChanged = computed(() => !isToday(effectiveDate.value));
// Rates between ISO currencies apply to every day and refuse a date.
const datedFields = computed(() =>
  isCustomCurrency.value ? { effectiveDate: format(effectiveDate.value, API_DATE_FORMAT) } : {},
);

const isRateChanged = computed(
  () => +props.currency.rate !== +form.baseRate || +props.currency.quoteRate !== +form.quoteRate,
);
const hasRateValue = computed(() => Number(form.baseRate) > 0 && Number(form.quoteRate) > 0);

// Disabling live update reveals Save immediately (even before an edit) so the row shows
// the intended next action. Re-enabling live update also needs Save to drop the custom rate.
const shouldShowSaveButton = computed(() => {
  return !isLiveRateEnabled.value || props.currency.custom;
});

// Live off: only actionable once the rate actually changed (a custom currency also needs a usable
// rate). Live on: Save drops the custom rate.
const canSubmit = computed(() =>
  isLiveRateEnabled.value
    ? true
    : isCustomCurrency.value
      ? hasRateValue.value && (isRateChanged.value || isDateChanged.value)
      : isRateChanged.value,
);

const onBaseFocus = () => {
  isBaseEditing.value = true;
  isQuoteEditing.value = false;
};
const onQuoteFocus = () => {
  isQuoteEditing.value = true;
  isBaseEditing.value = false;
};
const toggleChange = (value: boolean) => {
  if (props.isFormDisabled) return;
  isLiveRateEnabled.value = !!value;
};

watch(
  () => form.baseRate,
  (value) => {
    if (isBaseEditing.value) {
      form.quoteRate = calculateRatio({ value, isCustomCurrency: isCustomCurrency.value });
    }
  },
);
watch(
  () => form.quoteRate,
  (value) => {
    if (isQuoteEditing.value) {
      form.baseRate = calculateRatio({ value, isCustomCurrency: isCustomCurrency.value });
    }
  },
);

const deleteExchangeRates = async () => {
  try {
    const { remeasure } = await deleteCustomRate([
      {
        baseCode: props.currency.currency!.code,
        quoteCode: props.currency.quoteCode,
      },
      {
        baseCode: props.currency.quoteCode,
        quoteCode: props.currency.currency!.code,
      },
    ]);

    emit('submit');

    addSuccessNotification(t('settings.currencies.exchangeRate.successfullyUpdated'));
    // Tolerate deploy skew: an older backend without the `remeasure` field returns a
    // response without it, so guard the access rather than throw in the success path.
    notifyIfBalancesNotRefreshed(remeasure?.failed ?? 0);
  } catch (e: unknown) {
    if ((e as any)?.data?.code === API_ERROR_CODES.validationError) {
      addErrorNotification((e as any).data.message);
      return;
    }
    addErrorNotification(t('settings.currencies.exchangeRate.errors.unexpectedError'));
  }
};

const updateExchangeRates = async () => {
  try {
    const { remeasure } = await editUserCurrenciesExchangeRates([
      {
        baseCode: props.currency.currency!.code,
        quoteCode: props.currency.quoteCode,
        rate: Number(form.baseRate),
        ...datedFields.value,
      },
      {
        baseCode: props.currency.quoteCode,
        quoteCode: props.currency.currency!.code,
        rate: Number(form.quoteRate),
        ...datedFields.value,
      },
    ]);

    emit('submit');

    addSuccessNotification(t('settings.currencies.exchangeRate.successfullyUpdated'));
    // Tolerate deploy skew: an older backend without the `remeasure` field returns a
    // response without it, so guard the access rather than throw in the success path.
    notifyIfBalancesNotRefreshed(remeasure?.failed ?? 0);
  } catch (e: unknown) {
    if ((e as any)?.data?.code === API_ERROR_CODES.validationError) {
      addErrorNotification((e as any).data.message);
      return;
    }
    addErrorNotification(t('settings.currencies.exchangeRate.errors.updateFailed'));
  }
};

const onSubmitHandler = async () => {
  emit('trigger-disabled', true);
  if (!isLiveRateEnabled.value && (isRateChanged.value || (isCustomCurrency.value && isDateChanged.value))) {
    await updateExchangeRates();
  } else if (isLiveRateEnabled.value) {
    await deleteExchangeRates();
  }
  emit('trigger-disabled', false);
};
</script>
