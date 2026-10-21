<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-md">
    <template #title>{{ $t('settings.currencies.rateSource.history.editTitle') }}</template>
    <template #description>
      {{ $t('settings.currencies.rateSource.history.editDescription', { code, date: displayDate }) }}
    </template>

    <form :id="FORM_ID" class="grid gap-4" @submit.prevent="saveRate">
      <div class="grid grid-cols-2 gap-3">
        <InputField
          :model-value="form.baseRate"
          :label="`1 ${code} =`"
          :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
          data-testid="edit-dated-rate-base"
          @update:model-value="onBaseInput"
        />
        <InputField
          :model-value="form.quoteRate"
          :label="`1 ${quoteCode} =`"
          :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
          data-testid="edit-dated-rate-quote"
          @update:model-value="onQuoteInput"
        />
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="isSaving" @click="open = false">
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button
          type="submit"
          :form="FORM_ID"
          :disabled="!canSubmit || isFormDisabled || isSaving"
          :loading="isSaving"
          data-testid="edit-dated-rate-save"
        >
          {{ $t('settings.currencies.exchangeRate.saveButton') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { editUserCurrenciesExchangeRates } from '@/api/currencies';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { format, parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { calculateRatio } from '../currency-row/calculate-ratio';

const FORM_ID = 'edit-dated-rate-form';

const props = defineProps<{
  code: string;
  /** The currency the rate is quoted in. */
  quoteCode: string;
  /** The day (`yyyy-MM-dd`) the rate starts to apply; fixed, the edit replaces this day only. */
  effectiveDate: string;
  /** The stored rate: one unit of `code` in `quoteCode`. */
  rate: number;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification, addWarningNotification, addErrorNotification } = useNotificationCenter();

const form = reactive<{ baseRate: number | string; quoteRate: number | string }>({ baseRate: '', quoteRate: '' });
const isSaving = ref(false);

const displayDate = computed(() => format(parseISO(props.effectiveDate), 'PP'));

const seedForm = () => {
  form.baseRate = props.rate;
  form.quoteRate = calculateRatio({ value: props.rate, isCustomCurrency: true });
};

// Each opening starts from the stored rate, not from what an earlier, cancelled edit left behind.
watch(
  open,
  (isOpen) => {
    if (isOpen) seedForm();
  },
  { immediate: true },
);

const onBaseInput = (value: string | number | null) => {
  form.baseRate = value ?? '';
  form.quoteRate = calculateRatio({ value: form.baseRate, isCustomCurrency: true });
};
const onQuoteInput = (value: string | number | null) => {
  form.quoteRate = value ?? '';
  form.baseRate = calculateRatio({ value: form.quoteRate, isCustomCurrency: true });
};

const canSubmit = computed(
  () => Number(form.baseRate) > 0 && Number(form.quoteRate) > 0 && Number(form.baseRate) !== props.rate,
);

// Both directions of the pair go together, with the row's day, so the write replaces that day only.
const saveRate = async () => {
  if (!canSubmit.value || props.isFormDisabled || isSaving.value) return;
  const { code, quoteCode, effectiveDate } = props;

  isSaving.value = true;
  emit('trigger-disabled', true);
  try {
    const { remeasure } = await editUserCurrenciesExchangeRates([
      { baseCode: code, quoteCode, rate: Number(form.baseRate), effectiveDate },
      { baseCode: quoteCode, quoteCode: code, rate: Number(form.quoteRate), effectiveDate },
    ]);
    open.value = false;
    addSuccessNotification(t('settings.currencies.rateSource.history.successfullyUpdated'));
    // Tolerate deploy skew: an older backend without the `remeasure` field returns a
    // response without it, so guard the access rather than throw in the success path.
    const failed = remeasure?.failed ?? 0;
    if (failed > 0) {
      addWarningNotification(t('settings.currencies.exchangeRate.balancesNotRefreshed', { count: failed }));
    }
    emit('submit');
  } catch (error) {
    addErrorNotification(extractApiErrorMessage(error) || t('settings.currencies.exchangeRate.errors.updateFailed'));
  } finally {
    isSaving.value = false;
    emit('trigger-disabled', false);
  }
};
</script>
