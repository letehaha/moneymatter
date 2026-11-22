<script setup lang="ts">
import { formatFractionAsPercent } from '@/common/utils/percentage';
import { useFormatCurrency } from '@/composable/formatters';
import { useVentureDealMetrics } from '@/composable/data-queries/venture/deal-metrics';
import { TrendingDownIcon, TrendingUpIcon } from '@lucide/vue';
import { computed, toRef } from 'vue';

const props = defineProps<{
  dealId: string;
  currencyCode: string;
}>();

const dealIdRef = toRef(props, 'dealId');
const { data: metrics, isPending } = useVentureDealMetrics(dealIdRef);

const { formatAmountByCurrencyCode } = useFormatCurrency();

const formatMultiple = (val: string | null): string => {
  if (val === null || val === undefined) return '—';
  const n = Number(val);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}x`;
};

const pnlSign = computed<'profit' | 'loss' | 'flat'>(() => {
  if (!metrics.value?.pnlAbsolute) return 'flat';
  const n = Number(metrics.value.pnlAbsolute);
  if (n > 0) return 'profit';
  if (n < 0) return 'loss';
  return 'flat';
});

const pnlClass = computed(() => {
  if (pnlSign.value === 'profit') return 'text-app-income-color';
  if (pnlSign.value === 'loss') return 'text-app-expense-color';
  return 'text-foreground';
});
</script>

<template>
  <div v-if="isPending" class="bg-muted h-32 w-full animate-pulse rounded-xl" />

  <div v-else-if="metrics" class="grid gap-3 @lg/venture-deal:grid-cols-2">
    <div class="bg-card border-border rounded-xl border p-5">
      <div class="text-muted-foreground mb-4 text-[10px] font-medium tracking-[0.12em] uppercase">
        {{ $t('venture.metrics.capitalSection') }}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.costBasis') }}</div>
          <div class="mt-0.5 text-2xl font-medium tabular-nums">
            {{ formatAmountByCurrencyCode({ amount: Number(metrics.costBasis), currencyCode }) }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.currentValue') }}</div>
          <div class="mt-0.5 text-2xl font-medium tabular-nums">
            {{ formatAmountByCurrencyCode({ amount: Number(metrics.currentValue), currencyCode }) }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.totalDistributions') }}</div>
          <div class="mt-0.5 text-lg font-medium tabular-nums">
            {{ formatAmountByCurrencyCode({ amount: Number(metrics.totalDistributions), currencyCode }) }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.pnl') }}</div>
          <div :class="['mt-0.5 flex items-center gap-1 text-lg font-medium tabular-nums', pnlClass]">
            <TrendingUpIcon v-if="pnlSign === 'profit'" class="size-4" />
            <TrendingDownIcon v-else-if="pnlSign === 'loss'" class="size-4" />
            <span>{{ formatAmountByCurrencyCode({ amount: Number(metrics.pnlAbsolute), currencyCode }) }}</span>
            <span v-if="metrics.pnlPct" class="text-muted-foreground text-xs"
              >({{ formatFractionAsPercent(metrics.pnlPct) }})</span
            >
          </div>
        </div>
      </div>
    </div>

    <div class="bg-card border-border rounded-xl border p-5">
      <div class="text-muted-foreground mb-4 text-[10px] font-medium tracking-[0.12em] uppercase">
        {{ $t('venture.metrics.returnsSection') }}
      </div>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.tvpi') }}</div>
          <div class="mt-0.5 text-2xl font-medium tabular-nums">{{ formatMultiple(metrics.tvpi) }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.dpi') }}</div>
          <div class="mt-0.5 text-2xl font-medium tabular-nums">{{ formatMultiple(metrics.dpi) }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('venture.metrics.irr') }}</div>
          <div class="mt-0.5 text-2xl font-medium tabular-nums">{{ formatFractionAsPercent(metrics.irr) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
