<template>
  <ResponsiveTooltip v-if="parts.length > 1" :delay-duration="100" content-class-name="max-w-72">
    <template #content>
      <p class="mb-1 font-medium">{{ title }}</p>
      <ul class="grid gap-0.5">
        <li
          v-for="part in parts"
          :key="part.transactionId"
          :class="[
            'flex justify-between gap-4',
            isAccountScoped && part.transactionId === transaction.id && 'font-semibold',
          ]"
        >
          <span>
            {{ getAccountName({ accountId: part.accountId }) }}
            <template v-if="isAccountScoped && part.transactionId === transaction.id">
              {{ $t('common.transactions.record.payment.thisAccount') }}
            </template>
          </span>
          <span class="tabular-nums">
            {{ formatUIAmount(part.amount, { currency: part.currencyCode }) }}
            <template v-if="part.currencyCode !== mainCurrencyCode">
              ≈ {{ formatUIAmount(part.paymentAmount, { currency: mainCurrencyCode }) }}
            </template>
          </span>
        </li>
      </ul>
    </template>
    <div
      class="border-primary/60 bg-primary/10 text-primary-text flex h-6 cursor-help items-center gap-0.5 rounded-sm border px-1 py-0.5 text-xs"
      role="img"
      :aria-label="title"
      @click="isTouch && $event.stopPropagation()"
    >
      <LayersIcon class="size-4" />
      <span>{{ parts.length }}</span>
    </div>
  </ResponsiveTooltip>
</template>

<script lang="ts" setup>
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import {
  getPaymentMainCurrencyCode,
  isAccountScopedPaymentRow,
} from '@/components/dialogs/manage-transaction/utils/payment-legs';
import { useAccountName } from '@/composable/use-account-name';
import { formatUIAmount } from '@/js/helpers';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { LayersIcon } from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  transaction: TransactionModel;
}>();

const { t } = useI18n();
const getAccountName = useAccountName();
const isTouch = useMediaQuery('(pointer: coarse)');

const parts = computed(() => props.transaction.paymentParts ?? []);
const mainCurrencyCode = computed(() => getPaymentMainCurrencyCode({ transaction: props.transaction }));
const isAccountScoped = computed(() => isAccountScopedPaymentRow({ transaction: props.transaction }));

const title = computed(() => {
  if (isAccountScoped.value) {
    const total = parts.value.reduce((sum, part) => sum + part.paymentAmount, 0);
    return t('common.transactions.record.payment.partOf', {
      total: formatUIAmount(total, { currency: mainCurrencyCode.value }),
    });
  }
  return props.transaction.transactionType === TRANSACTION_TYPES.income
    ? t('common.transactions.record.payment.receivedInto', { count: parts.value.length })
    : t('common.transactions.record.payment.paidFrom', { count: parts.value.length });
});
</script>
