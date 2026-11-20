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
        @click="openConfirm"
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
    :confirm-disabled="isFormDisabled || blockerGroups.length > 0"
    @confirm="deleteCurrency"
  >
    <template #title>{{ $t('settings.currencies.delete.confirmTitle') }}</template>
    <template #description>
      <span class="grid gap-2">
        <span class="block">{{ $t('settings.currencies.delete.description') }}</span>
        <span v-if="!blockerGroups.length" class="text-warning-text block">
          <TriangleAlertIcon class="inline size-4 align-text-bottom" />
          {{ $t('settings.currencies.delete.foreignAmountsWarning') }}
        </span>
      </span>
    </template>

    <div v-if="blockerGroups.length" class="grid gap-2 text-sm">
      <p class="text-destructive-text font-medium">{{ $t('settings.currencies.delete.inUse.title') }}</p>
      <ul class="grid gap-1">
        <li v-for="group in blockerGroups" :key="group.type">
          <span class="font-medium">{{ group.label }}:</span> {{ group.names }}
        </li>
      </ul>
    </div>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { deleteCustomCurrency, deleteUserCurrency } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { API_ERROR_CODES, type CurrencyInUseBlocker, type CurrencyInUseDetails } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
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
const blockers = ref<CurrencyInUseBlocker[]>([]);

const BLOCKER_LABEL_KEYS: Record<CurrencyInUseBlocker['type'], string> = {
  account: 'settings.currencies.delete.inUse.types.account',
  portfolio: 'settings.currencies.delete.inUse.types.portfolio',
  holding: 'settings.currencies.delete.inUse.types.holding',
  portfolioCash: 'settings.currencies.delete.inUse.types.portfolioCash',
  portfolioTransfer: 'settings.currencies.delete.inUse.types.portfolioTransfer',
  investmentTransaction: 'settings.currencies.delete.inUse.types.investmentTransaction',
  subscription: 'settings.currencies.delete.inUse.types.subscription',
  transactionTemplate: 'settings.currencies.delete.inUse.types.transactionTemplate',
  budget: 'settings.currencies.delete.inUse.types.budget',
  goal: 'settings.currencies.delete.inUse.types.goal',
  ventureDeal: 'settings.currencies.delete.inUse.types.ventureDeal',
};

const blockerGroups = computed(() => {
  const namesByType = new Map<CurrencyInUseBlocker['type'], string[]>();
  for (const blocker of blockers.value) {
    const name = blocker.trashed ? `${blocker.name} ${t('settings.currencies.delete.inUse.trashed')}` : blocker.name;
    namesByType.set(blocker.type, [...(namesByType.get(blocker.type) ?? []), name]);
  }
  return [...namesByType].map(([type, names]) => ({
    type,
    label: t(BLOCKER_LABEL_KEYS[type]),
    names: names.join(', '),
  }));
});

const openConfirm = () => {
  blockers.value = [];
  isConfirmOpen.value = true;
};

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
