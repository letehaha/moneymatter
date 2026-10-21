<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('settings.currencies.rateSource.manual.removeConfirm')"
    confirm-variant="destructive"
    :confirm-disabled="isFormDisabled"
    @confirm="removeRate"
  >
    <template #title>{{ $t('settings.currencies.rateSource.manual.removeTitle') }}</template>
    <template #description>
      {{ $t('settings.currencies.rateSource.manual.removeDescription', { code, date: displayDate }) }}
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { deleteCustomRate } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { extractApiErrorMessage } from '@/js/errors';
import { format, parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  code: string;
  /** The currency the rate is quoted in. */
  quoteCode: string;
  /** The day (`yyyy-MM-dd`) the rate to remove starts to apply. */
  effectiveDate: string;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const displayDate = computed(() => format(parseISO(props.effectiveDate), 'PP'));

// Both directions of the pair go together, as the API requires. Only the rate that starts on the
// row's day is removed; the days it covered fall back to the earlier rate.
const removeRate = async () => {
  const { code, quoteCode, effectiveDate } = props;

  emit('trigger-disabled', true);
  try {
    await deleteCustomRate([
      { baseCode: code, quoteCode, effectiveDate },
      { baseCode: quoteCode, quoteCode: code, effectiveDate },
    ]);
    open.value = false;
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
