<template>
  <section class="border-border grid gap-3 rounded-xl border px-3.5 py-3" data-testid="iso-rate-panel">
    <div class="flex items-center gap-3">
      <div class="grid min-w-0 flex-1 gap-0.5">
        <span id="iso-live-rate-label" class="text-sm font-semibold">
          {{ $t('settings.currencies.dialog.iso.liveTitle') }}
        </span>
        <span class="text-muted-foreground text-xs">
          {{
            isLiveRateEnabled
              ? $t('settings.currencies.dialog.iso.liveOn')
              : $t('settings.currencies.dialog.iso.liveOff')
          }}
        </span>
      </div>
      <Switch
        :model-value="isLiveRateEnabled"
        :disabled="isFormDisabled"
        aria-labelledby="iso-live-rate-label"
        data-testid="iso-live-rate-switch"
        @update:model-value="toggleLiveRate({ value: Boolean($event) })"
      />
    </div>

    <template v-if="!isLiveRateEnabled">
      <div class="grid gap-1.5">
        <div class="grid gap-3 @sm/currencies:grid-cols-2">
          <InputField
            v-model="form.quoteRate"
            type="number"
            only-positive
            class="min-w-0"
            :label="`1 ${baseCode} =`"
            :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
            :disabled="isFormDisabled"
            data-testid="manual-rate-quote"
            @focus="editing = 'quote'"
          />
          <InputField
            v-model="form.baseRate"
            type="number"
            only-positive
            class="min-w-0"
            :label="`1 ${code} =`"
            :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
            :disabled="isFormDisabled"
            data-testid="manual-rate-base"
            @focus="editing = 'base'"
          />
        </div>
        <span class="text-muted-foreground text-xs">{{ $t('settings.currencies.dialog.form.typeEither') }}</span>
      </div>

      <div class="flex justify-end">
        <Button
          size="sm"
          :disabled="!canSubmit || isFormDisabled"
          :loading="isSaving"
          data-testid="manual-rate-save"
          @click="saveRate"
        >
          {{ $t('settings.currencies.dialog.iso.save') }}
        </Button>
      </div>

      <p class="text-muted-foreground flex items-start gap-2 text-sm" data-testid="iso-rate-note">
        <InfoIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
        {{ $t('settings.currencies.dialog.iso.note') }}
      </p>
    </template>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('settings.currencies.dialog.iso.confirm')"
      confirm-variant="destructive"
      :confirm-disabled="isFormDisabled"
      @confirm="removeRate"
    >
      <template #title>{{ $t('settings.currencies.dialog.iso.confirmTitle') }}</template>
      <template #description>
        {{ $t('settings.currencies.dialog.iso.confirmBody', { rate: savedRateText, code }) }}
      </template>
    </ResponsiveAlertDialog>
  </section>
</template>

<script setup lang="ts">
import { deleteCustomRate, editUserCurrenciesExchangeRates } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Switch } from '@/components/lib/ui/switch';
import { toLocalNumber } from '@/js/helpers/formatters';
import type { RefBalanceRemeasureResult } from '@bt/shared/types';
import { InfoIcon } from '@lucide/vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { rateDisplayOptions } from '../rate-precision';
import type { CurrencyWithExchangeRate } from '../types';
import { useRateNotifications } from './use-rate-notifications';
import { useRatePair } from './use-rate-pair';

const RATE_DISPLAY_OPTIONS = rateDisplayOptions({ isCustom: false, isoDecimals: 6 });

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
  /** True while the live rate is off and the typed rate is not saved. */
  'update:dirty': [value: boolean];
}>();

const { t } = useI18n();
const { notifyRateSaved, notifyRateFailed } = useRateNotifications();

const code = computed(() => props.currency.currencyCode);
const baseCode = computed(() => props.currency.quoteCode);

const { form, editing, isRateChanged, hasRateValue, resetPair } = useRatePair({
  saved: () => ({ baseRate: props.currency.rate, quoteRate: props.currency.quoteRate }),
  isCustom: () => false,
});
const isLiveRateEnabled = ref(!props.currency.custom);
const isConfirmOpen = ref(false);
const isSaving = ref(false);

const isDirty = computed(() => !isLiveRateEnabled.value && isRateChanged.value);
const canSubmit = computed(() => hasRateValue.value && isRateChanged.value);

watch(isDirty, (value) => emit('update:dirty', value));
onUnmounted(() => emit('update:dirty', false));

watch(
  () => props.currency.custom,
  (custom) => {
    isLiveRateEnabled.value = !custom;
  },
);
resetPair();
// A reloaded rate re-seeds the inputs only when they still hold the previous saved rate.
watch([() => props.currency.rate, () => props.currency.quoteRate], (_, [previousRate, previousQuoteRate]) => {
  const isTouched =
    !isLiveRateEnabled.value && (+form.baseRate !== +previousRate || +form.quoteRate !== +previousQuoteRate);
  if (!isTouched) resetPair();
});

const savedRateText = computed(() =>
  t('settings.currencies.dialog.row.rate', {
    code: baseCode.value,
    rate: toLocalNumber(props.currency.quoteRate, RATE_DISPLAY_OPTIONS),
    quote: code.value,
  }),
);

// A user rate exists only once saved; turning live back on before that has nothing to remove.
const toggleLiveRate = ({ value }: { value: boolean }) => {
  if (props.isFormDisabled) return;
  if (value && props.currency.custom) {
    isConfirmOpen.value = true;
    return;
  }
  if (value) resetPair();
  isLiveRateEnabled.value = value;
};

const runRequest = async ({
  request,
  fallbackKey,
  flow,
}: {
  request: () => Promise<{ remeasure: RefBalanceRemeasureResult }>;
  fallbackKey: string;
  flow: string;
}): Promise<boolean> => {
  emit('trigger-disabled', true);
  let remeasure: RefBalanceRemeasureResult;
  try {
    ({ remeasure } = await request());
  } catch (error) {
    notifyRateFailed({ error, fallback: t(fallbackKey), flow });
    return false;
  } finally {
    emit('trigger-disabled', false);
  }

  notifyRateSaved({ message: t('settings.currencies.exchangeRate.successfullyUpdated'), remeasure });
  emit('submit');
  return true;
};

const saveRate = async () => {
  isSaving.value = true;
  const isSaved = await runRequest({
    request: () =>
      editUserCurrenciesExchangeRates([
        { baseCode: code.value, quoteCode: baseCode.value, rate: Number(form.baseRate) },
        { baseCode: baseCode.value, quoteCode: code.value, rate: Number(form.quoteRate) },
      ]),
    fallbackKey: 'settings.currencies.exchangeRate.errors.updateFailed',
    flow: 'saveIsoRate',
  });
  isSaving.value = false;
  if (isSaved) emit('update:dirty', false);
};

const removeRate = async () => {
  isConfirmOpen.value = false;
  await runRequest({
    request: () =>
      deleteCustomRate([
        { baseCode: code.value, quoteCode: baseCode.value },
        { baseCode: baseCode.value, quoteCode: code.value },
      ]),
    fallbackKey: 'settings.currencies.exchangeRate.errors.unexpectedError',
    flow: 'removeIsoRate',
  });
};
</script>
