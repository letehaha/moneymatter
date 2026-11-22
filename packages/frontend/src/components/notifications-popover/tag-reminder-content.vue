<script setup lang="ts">
import { useFormatCurrency } from '@/composable/formatters';
import { TAG_REMINDER_TYPES, TagReminderNotificationPayload } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  payload: TagReminderNotificationPayload;
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const formattedActualAmount = computed(() => {
  if (props.payload.actualAmount === undefined) return '';
  return formatAmountByCurrencyCode({
    amount: props.payload.actualAmount,
    currencyCode: props.payload.currencyCode || 'USD',
  });
});

const formattedThresholdAmount = computed(() => {
  if (props.payload.thresholdAmount === undefined) return '';
  return formatAmountByCurrencyCode({
    amount: props.payload.thresholdAmount,
    currencyCode: props.payload.currencyCode || 'USD',
  });
});

const message = computed(() => {
  switch (props.payload.reminderType) {
    case TAG_REMINDER_TYPES.amountThreshold:
      return t('notifications.tagReminder.thresholdMessage', {
        amount: formattedActualAmount.value,
        threshold: formattedThresholdAmount.value,
      });
    case TAG_REMINDER_TYPES.existenceCheck:
      return t('notifications.tagReminder.existenceMessage', {
        count: props.payload.transactionCount ?? 0,
      });
    default:
      return '';
  }
});

const tagStyle = computed(() => ({
  backgroundColor: props.payload.tagColor || '#6b7280',
}));
</script>

<template>
  <div class="mt-0.5 flex items-center gap-1.5 text-xs">
    <span
      class="inline-flex items-center truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white/90"
      :style="tagStyle"
    >
      {{ payload.tagName }}
    </span>
    <span class="text-muted-foreground">{{ message }}</span>
  </div>
</template>
