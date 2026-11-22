<template>
  <div>
    <div class="flex flex-col gap-3 @[26rem]/currencies:flex-row @[26rem]/currencies:items-end">
      <input-field
        v-model="form.baseRate"
        type="number"
        only-positive
        class="min-w-0 @[26rem]/currencies:flex-1"
        :label="`1 ${currency.currency?.code} =`"
        :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
        :disabled="isLiveRateEnabled"
        data-testid="manual-rate-base"
        @focus="onBaseFocus"
      />
      <input-field
        v-model="form.quoteRate"
        type="number"
        only-positive
        class="min-w-0 @[26rem]/currencies:flex-1"
        :label="`1 ${quoteCode} =`"
        :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
        :disabled="isLiveRateEnabled"
        data-testid="manual-rate-quote"
        @focus="onQuoteFocus"
      />
      <DateField
        v-if="currency.isCustomCurrency && !datedRate"
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
        data-testid="manual-rate-save"
        @click="onSubmitHandler"
      >
        {{ $t('settings.currencies.exchangeRate.saveButton') }}
      </Button>
    </div>

    <template v-if="currency.isCustomCurrency">
      <p v-if="!datedRate" class="text-muted-foreground mt-4 flex items-start gap-1 text-xs leading-5">
        <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
        {{ $t('settings.currencies.custom.rateHint', { code: quoteCode }) }}
      </p>
      <p v-if="!datedRate" class="text-muted-foreground mt-2 flex items-start gap-1 text-xs leading-5">
        <InfoIcon class="text-primary-text mt-1 size-3.5 shrink-0" />
        {{ $t('settings.currencies.rateSource.manual.datedHint') }}
      </p>
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
import { extractApiErrorMessage } from '@/js/errors';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { InfoIcon } from '@lucide/vue';
import { format, isToday } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { CurrencyWithExchangeRate } from '../types';
import { calculateRatio } from './calculate-ratio';

const API_DATE_FORMAT = 'yyyy-MM-dd';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
  /** A stored rate of a custom currency to edit in place: the write keeps its quote and its day. */
  datedRate?: Pick<CurrencyRateHistoryItem, 'quoteCode' | 'rate' | 'effectiveDate'>;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const { addSuccessNotification, addWarningNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

// A rate change re-values account balances; `failed` counts accounts left on their old base value
// for lack of a market rate, so the unchanged balance is not mistaken for the rate not saving.
const notifyIfBalancesNotRefreshed = ({ failed }: { failed: number }) => {
  if (failed > 0) {
    addWarningNotification(t('settings.currencies.exchangeRate.balancesNotRefreshed', { count: failed }));
  }
};

const quoteCode = computed(() => props.datedRate?.quoteCode ?? props.currency.quoteCode);
const savedRates = computed(() =>
  props.datedRate
    ? { baseRate: props.datedRate.rate, quoteRate: calculateRatio({ value: props.datedRate.rate, isCustom: true }) }
    : { baseRate: props.currency.rate, quoteRate: props.currency.quoteRate },
);

const form = reactive<{ baseRate: number | string; quoteRate: number | string }>({ ...savedRates.value });
const isBaseEditing = ref(false);
const isQuoteEditing = ref(false);
// A custom currency has no market rate to follow, so only the user's own rate applies.
const isLiveRateEnabled = ref<boolean>(!props.currency.isCustomCurrency && !props.currency.custom);

const effectiveDate = ref(new Date());
const effectiveDateOptions = { maxDate: new Date() };
const isDateChanged = computed(
  () => props.currency.isCustomCurrency && !props.datedRate && !isToday(effectiveDate.value),
);
// Today is left to the API: it dates rates by the UTC day, which the local "today" misses near midnight.
const datedFields = computed(() => {
  if (props.datedRate) return { effectiveDate: props.datedRate.effectiveDate };
  return isDateChanged.value ? { effectiveDate: format(effectiveDate.value, API_DATE_FORMAT) } : {};
});

// The custom-currency editor stays open across saves: stale inputs would let Save write back a rate
// that was edited or removed in the history list.
const resetForm = () => {
  Object.assign(form, savedRates.value);
  effectiveDate.value = new Date();
  isBaseEditing.value = false;
  isQuoteEditing.value = false;
};
watch([() => savedRates.value.baseRate, () => savedRates.value.quoteRate], resetForm);

const isRateChanged = computed(
  () => +savedRates.value.baseRate !== +form.baseRate || +savedRates.value.quoteRate !== +form.quoteRate,
);
const hasRateValue = computed(() => Number(form.baseRate) > 0 && Number(form.quoteRate) > 0);

// Disabling live update reveals Save immediately (even before an edit) so the row shows
// the intended next action. Re-enabling live update also needs Save to drop the custom rate.
const shouldShowSaveButton = computed(() => {
  return !isLiveRateEnabled.value || props.currency.custom;
});

// Live on: Save drops the custom rate.
const canSubmit = computed(
  () => isLiveRateEnabled.value || (hasRateValue.value && (isRateChanged.value || isDateChanged.value)),
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
      form.quoteRate = calculateRatio({ value, isCustom: props.currency.isCustomCurrency });
    }
  },
);
watch(
  () => form.quoteRate,
  (value) => {
    if (isQuoteEditing.value) {
      form.baseRate = calculateRatio({ value, isCustom: props.currency.isCustomCurrency });
    }
  },
);

const deleteExchangeRates = async () => {
  try {
    const { remeasure } = await deleteCustomRate([
      { baseCode: props.currency.currency!.code, quoteCode: quoteCode.value },
      { baseCode: quoteCode.value, quoteCode: props.currency.currency!.code },
    ]);

    emit('submit');

    addSuccessNotification(t('settings.currencies.exchangeRate.successfullyUpdated'));
    // An older backend without the `remeasure` field must not throw in the success path.
    notifyIfBalancesNotRefreshed({ failed: remeasure?.failed ?? 0 });
  } catch (e: unknown) {
    addErrorNotification(extractApiErrorMessage(e) || t('settings.currencies.exchangeRate.errors.unexpectedError'));
  }
};

const updateExchangeRates = async () => {
  try {
    const { remeasure } = await editUserCurrenciesExchangeRates([
      {
        baseCode: props.currency.currency!.code,
        quoteCode: quoteCode.value,
        rate: Number(form.baseRate),
        ...datedFields.value,
      },
      {
        baseCode: quoteCode.value,
        quoteCode: props.currency.currency!.code,
        rate: Number(form.quoteRate),
        ...datedFields.value,
      },
    ]);

    resetForm();
    emit('submit');

    addSuccessNotification(t('settings.currencies.exchangeRate.successfullyUpdated'));
    // An older backend without the `remeasure` field must not throw in the success path.
    notifyIfBalancesNotRefreshed({ failed: remeasure?.failed ?? 0 });
  } catch (e: unknown) {
    addErrorNotification(extractApiErrorMessage(e) || t('settings.currencies.exchangeRate.errors.updateFailed'));
  }
};

const onSubmitHandler = async () => {
  emit('trigger-disabled', true);
  await (isLiveRateEnabled.value ? deleteExchangeRates() : updateExchangeRates());
  emit('trigger-disabled', false);
};
</script>
