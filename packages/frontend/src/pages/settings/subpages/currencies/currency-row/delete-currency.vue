<template>
  <DesktopOnlyTooltip
    :content="$t('settings.currencies.delete.disabledTooltip')"
    :disabled="!isDeletionDisabled"
    content-class-name="max-w-[320px]"
  >
    <!-- Disabled native buttons don't fire pointer events, so the tooltip trigger
    (merged onto this child via as-child) needs a non-disabled wrapper to hover on. -->
    <span class="inline-flex">
      <Button
        variant="soft-destructive"
        size="sm"
        class="whitespace-nowrap"
        :disabled="isDeletionDisabled || isFormDisabled"
        @click="isConfirmOpen = true"
      >
        <Trash2Icon class="size-4" />
        <span class="hidden @[450px]/currencies:inline">{{ $t('settings.currencies.delete.button') }}</span>
        <span class="@[450px]/currencies:hidden">{{ $t('settings.currencies.delete.buttonShort') }}</span>
      </Button>
    </span>
  </DesktopOnlyTooltip>

  <ResponsiveAlertDialog
    v-model:open="isConfirmOpen"
    :confirm-label="$t('settings.currencies.delete.button')"
    confirm-variant="destructive"
    :confirm-disabled="isFormDisabled"
    @confirm="deleteCurrency"
  >
    <template #title>{{ $t('settings.currencies.delete.confirmTitle') }}</template>
    <template #description>{{ $t('settings.currencies.delete.description') }}</template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { deleteCustomCurrency, deleteUserCurrency } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { Trash2Icon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { CurrencyWithExchangeRate } from '../types';

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
  isDeletionDisabled: boolean;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const isConfirmOpen = ref(false);

const { mutate: deleteCurrency } = useMutation({
  mutationFn: () => {
    emit('trigger-disabled', true);
    return props.currency.currency?.isCustom
      ? deleteCustomCurrency({ code: props.currency.currencyCode })
      : deleteUserCurrency(props.currency.currencyCode);
  },
  onSuccess: () => {
    addSuccessNotification(t('settings.currencies.delete.successfullyDeleted'));
    isConfirmOpen.value = false;
    emit('submit');
  },
  onError: (e) => {
    if (e instanceof ApiErrorResponseError) {
      if (e.data.code === API_ERROR_CODES.unauthorized) return;
      // A validation error or a conflict (a custom currency still used by a row) explains itself.
      if (e.data.code === API_ERROR_CODES.validationError || e.data.code === API_ERROR_CODES.conflict) {
        addErrorNotification(e.data.message ?? '');
        return;
      }
    }
    addErrorNotification(t('settings.currencies.delete.errors.deleteFailed'));
  },
  onSettled: () => {
    emit('trigger-disabled', false);
  },
});
</script>
