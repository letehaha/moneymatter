<template>
  <p
    v-if="accountsCount > 0"
    class="text-muted-foreground max-w-56 text-right text-sm"
    data-testid="delete-currency-blocked"
  >
    {{ $t('settings.currencies.dialog.footer.deleteBlocked', { count: accountsCount }, accountsCount) }}
  </p>
  <Button
    v-else
    variant="soft-destructive"
    size="sm"
    class="whitespace-nowrap"
    :disabled="isFormDisabled"
    data-testid="delete-currency"
    @click="openConfirm"
  >
    <Trash2Icon class="size-4" />
    <span class="hidden @[450px]/currencies:inline">{{ $t('settings.currencies.delete.button') }}</span>
    <span class="@[450px]/currencies:hidden">{{ $t('settings.currencies.delete.buttonShort') }}</span>
  </Button>

  <ResponsiveAlertDialog
    v-model:open="isConfirmOpen"
    :confirm-label="$t('settings.currencies.delete.button')"
    confirm-variant="destructive"
    :confirm-disabled="isFormDisabled || blockers.length > 0"
    @confirm="deleteCurrency"
  >
    <template #title>{{ $t('settings.currencies.delete.confirmTitle') }}</template>
    <template #description>
      <span class="grid gap-2">
        <span class="block">{{ $t('settings.currencies.delete.description') }}</span>
        <span v-if="!blockers.length" class="text-warning-text block">
          <TriangleAlertIcon class="inline size-4 align-text-bottom" />
          {{ $t('settings.currencies.delete.foreignAmountsWarning') }}
        </span>
      </span>
    </template>

    <div v-if="blockers.length" class="grid gap-2 text-sm">
      <p class="text-destructive-text font-medium">{{ $t('settings.currencies.delete.inUse.title') }}</p>
      <CurrencyBlockerList :blockers="blockers" />
    </div>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { deleteCustomCurrency, deleteUserCurrency } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyInUseBlocker, type CurrencyInUseDetails } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CurrencyBlockerList from '../currency-blocker-list.vue';
import { CurrencyWithExchangeRate } from '../types';

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  isFormDisabled: boolean;
  /** Accounts using the currency; any blocks the delete. */
  accountsCount: number;
}>();

const emit = defineEmits<{
  submit: [];
  'trigger-disabled': [value: boolean];
}>();

const isConfirmOpen = ref(false);
const blockers = ref<CurrencyInUseBlocker[]>([]);

const openConfirm = () => {
  blockers.value = [];
  isConfirmOpen.value = true;
};

const { mutate: deleteCurrency } = useMutation({
  mutationFn: () => {
    emit('trigger-disabled', true);
    return props.currency.isCustomCurrency
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
      if (e.data.code === API_ERROR_CODES.currencyInUse) {
        const inUse = (e.data.details as CurrencyInUseDetails | undefined)?.blockers ?? [];
        if (inUse.length) {
          blockers.value = inUse;
          // The desktop confirm action closes the dialog on click, so reopen it to show the blockers.
          isConfirmOpen.value = true;
          return;
        }
        addErrorNotification(e.data.message ?? t('settings.currencies.delete.errors.deleteFailed'));
        return;
      }
      if (e.data.code === API_ERROR_CODES.validationError) {
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
