<template>
  <Transition name="spike-panel-fade">
    <div
      v-if="visible"
      ref="panelRef"
      class="bg-card text-card-foreground fixed z-50 w-84.5 rounded-lg border shadow-xl"
      :style="{ left: `${x}px`, top: `${y}px` }"
    >
      <!-- Header -->
      <div class="flex items-start justify-between gap-2 border-b px-3 py-2">
        <div>
          <div class="text-sm font-medium">{{ spikeDate }}</div>
          <div
            class="text-xs font-semibold"
            :class="{
              'text-success-text': isPositive,
              'text-app-expense-color': !isPositive,
            }"
          >
            {{ isPositive ? '+' : ''
            }}{{ formatLargeNumber(deltaAbsolute, { isFiat: true, currency: currencyCode }) }} ({{
              isPositive ? '+' : ''
            }}{{ deltaPercent.toFixed(1) }}%)
          </div>
        </div>
        <button
          class="text-muted-foreground hover:text-foreground -mt-0.5 -mr-1 shrink-0 rounded p-1 transition-colors"
          @click="$emit('close')"
        >
          <XIcon class="size-4" />
        </button>
      </div>

      <!-- Content -->
      <div class="px-3 py-2">
        <!-- Balance breakdown (total mode only) -->
        <div v-if="showBalanceBreakdown" class="mb-2 space-y-0.5 border-b pb-2 text-xs">
          <div class="flex justify-between">
            <span class="text-foreground font-semibold">{{
              t('dashboard.widgets.balanceTrend.spikePanel.accounts')
            }}</span>
            <span
              :class="{
                'text-success-text': accountsDelta > 0,
                'text-app-expense-color': accountsDelta < 0,
                'text-muted-foreground': accountsDelta === 0,
              }"
            >
              {{ accountsDelta > 0 ? '+' : ''
              }}{{ formatLargeNumber(accountsDelta, { isFiat: true, currency: currencyCode }) }}
            </span>
          </div>
          <div class="mt-1 flex justify-between">
            <span class="text-foreground font-semibold">{{
              t('dashboard.widgets.balanceTrend.spikePanel.portfolios')
            }}</span>
            <span
              :class="{
                'text-success-text': portfoliosDelta > 0,
                'text-app-expense-color': portfoliosDelta < 0,
                'text-muted-foreground': portfoliosDelta === 0,
              }"
            >
              {{ portfoliosDelta > 0 ? '+' : ''
              }}{{ formatLargeNumber(portfoliosDelta, { isFiat: true, currency: currencyCode }) }}
            </span>
          </div>
        </div>

        <template v-if="isPortfolioMode">
          <p class="text-muted-foreground text-xs">
            {{ t('dashboard.widgets.balanceTrend.spikePanel.priceDrivenChange') }}
          </p>
        </template>
        <template v-else-if="isLoading">
          <div class="space-y-1">
            <TransactionRecordSkeleton v-for="i in 3" :key="i" />
          </div>
        </template>
        <template v-else-if="significantTransactions.length === 0">
          <p class="text-muted-foreground text-xs">
            {{ t('dashboard.widgets.balanceTrend.spikePanel.noSignificantTransactions') }}
          </p>
        </template>
        <template v-else>
          <div class="space-y-1">
            <TransactionRecord v-for="tx in significantTransactions" :key="tx.id" :tx="tx" :as-button="false" />
          </div>
          <button
            class="text-primary-text hover:text-primary-text/80 mt-2 w-full text-center text-xs font-medium transition-colors"
            @click="$emit('see-all')"
          >
            {{ t('dashboard.widgets.balanceTrend.spikePanel.seeAllTransactions') }} &rarr;
          </button>
        </template>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import TransactionRecordSkeleton from '@/components/transactions-list/transaction-record-skeleton.vue';
import { formatLargeNumber } from '@/js/helpers';
import {
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionModel,
  isTwoLegTransfer,
} from '@bt/shared/types';
import { XIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  spikeDate: string;
  deltaAbsolute: number;
  deltaPercent: number;
  isPositive: boolean;
  transactions: TransactionModel[];
  isLoading: boolean;
  isPortfolioMode: boolean;
  accountsDelta: number;
  portfoliosDelta: number;
  selectedBalanceType: 'total' | 'accounts' | 'portfolios' | 'ventures' | 'vehicles' | 'loans';
  currencyCode?: string;
}>();

const showBalanceBreakdown = computed(
  () => props.selectedBalanceType === 'total' && (props.accountsDelta !== 0 || props.portfoliosDelta !== 0),
);

// Show only relevant transactions:
// - exclude between-account transfers (zero-sum)
// - positive spike → income only, negative spike → expense only
// - filter by significance (>= 2% of spike delta)
const significantTransactions = computed(() => {
  const threshold = Math.abs(props.deltaAbsolute) * 0.02;
  const relevantType = props.isPositive ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;

  return props.transactions
    .filter((tx) => {
      if (isTwoLegTransfer(tx.transferNature)) return false;
      if (Math.abs(tx.refAmount) < threshold) return false;
      // Out-of-wallet transfers don't have a matching type, keep them based on amount sign
      if (tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) return true;
      return tx.transactionType === relevantType;
    })
    .slice(0, 3);
});

defineEmits<{
  close: [];
  'see-all': [];
}>();

const panelRef = ref<HTMLDivElement | null>(null);

defineExpose({ panelRef });
</script>

<style scoped>
.spike-panel-fade-enter-active,
.spike-panel-fade-leave-active {
  transition: opacity 0.15s ease;
}

.spike-panel-fade-enter-from,
.spike-panel-fade-leave-to {
  opacity: 0;
}
</style>
