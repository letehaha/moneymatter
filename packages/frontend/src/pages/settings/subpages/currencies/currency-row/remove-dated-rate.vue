<template>
  <div>
    <Button
      type="button"
      variant="ghost-destructive"
      size="sm"
      :disabled="isFormDisabled"
      data-testid="manual-rate-remove"
      @click="isConfirmOpen = true"
    >
      <Trash2Icon class="size-4" />
      {{ $t('settings.currencies.rateSource.manual.removeButton') }}
    </Button>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('settings.currencies.rateSource.manual.removeConfirm')"
      confirm-variant="destructive"
      :confirm-disabled="isFormDisabled"
      @confirm="removeRate"
    >
      <template #title>{{ $t('settings.currencies.rateSource.manual.removeTitle') }}</template>
      <template #description>
        {{ $t('settings.currencies.rateSource.manual.removeDescription', { code: currency.currencyCode }) }}
      </template>

      <DateField
        v-model="removalDate"
        mode="date"
        class="mt-2"
        :label="$t('settings.currencies.rateSource.manual.removeDateLabel')"
        :calendar-options="removalDateOptions"
        data-testid="manual-rate-remove-date"
      />
    </ResponsiveAlertDialog>
  </div>
</template>

<script setup lang="ts">
import { deleteCustomRate } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { format } from 'date-fns';
import { Trash2Icon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';

const API_DATE_FORMAT = 'yyyy-MM-dd';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const isConfirmOpen = ref(false);
const removalDate = ref(new Date());
const removalDateOptions = { maxDate: new Date() };

// Both directions of the pair go together, as the API requires. Only the rate that starts on the
// chosen day is removed; the days it covered fall back to the earlier rate.
const removeRate = async () => {
  const effectiveDate = format(removalDate.value, API_DATE_FORMAT);
  const { currencyCode, quoteCode } = props.currency;

  emit('trigger-disabled', true);
  try {
    await deleteCustomRate([
      { baseCode: currencyCode, quoteCode, effectiveDate },
      { baseCode: quoteCode, quoteCode: currencyCode, effectiveDate },
    ]);
    isConfirmOpen.value = false;
    addSuccessNotification(t('settings.currencies.rateSource.manual.successfullyRemoved'));
    emit('submit');
  } catch (error) {
    addErrorNotification(
      extractApiErrorMessage(error) || t('settings.currencies.rateSource.manual.errors.removeFailed'),
    );
  } finally {
    emit('trigger-disabled', false);
  }
};
</script>
