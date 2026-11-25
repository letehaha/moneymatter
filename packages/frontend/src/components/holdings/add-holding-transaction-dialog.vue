<script setup lang="ts">
import { createInvestmentTransaction } from '@/api/investment-transactions';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import InvestmentTransactionForm from '@/components/forms/investment-transaction-form.vue';
import type { HoldingModel } from '@bt/shared/types/investments';
import { useIsMutating } from '@tanstack/vue-query';
import { computed } from 'vue';

const props = defineProps<{
  portfolioId: string;
  holding: HoldingModel | null;
  portfolioName?: string;
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const isSaving = useIsMutating({
  predicate: (mutation) => mutation.options.mutationFn === createInvestmentTransaction,
});

const securities = computed(() => {
  const holding = props.holding;
  if (!holding) return [];
  const symbol = holding.security?.symbol ?? '';
  return [
    {
      value: String(holding.securityId),
      label: holding.security?.name ? `${holding.security.name} (${symbol})` : symbol,
      currencyCode: holding.currencyCode,
    },
  ];
});

const subtitle = computed(() =>
  [props.holding?.security?.symbol, props.holding?.security?.name, props.portfolioName].filter(Boolean).join(' · '),
);
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" :dismissible="!isSaving" dialog-content-class="sm:max-w-2xl">
    <template #title>
      <span class="flex items-center gap-3">
        <SecurityLogo v-if="holding?.security" :security="holding.security" />
        {{ $t('portfolioDetail.holdingsTable.addTransactionDialog.title') }}
      </span>
    </template>
    <template #description>{{ subtitle }}</template>

    <InvestmentTransactionForm
      v-if="holding"
      :portfolio-id="portfolioId"
      :securities="securities"
      :security-id="String(holding.securityId)"
      @success="isOpen = false"
      @cancel="isOpen = false"
    />
  </ResponsiveDialog>
</template>
