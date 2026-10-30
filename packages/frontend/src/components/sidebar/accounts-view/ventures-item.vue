<script setup lang="ts">
import VentureDealLogo from '@/components/common/venture-deal-logo.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useVentureDealMetrics } from '@/composable/data-queries/venture/deal-metrics';
import { useFormatCurrency } from '@/composable/formatters';
import { ROUTES_NAMES } from '@/routes/constants';
import { VentureDealModel } from '@bt/shared/types/venture';
import { computed, toRef } from 'vue';

const props = defineProps<{
  deal: VentureDealModel;
}>();

const dealId = toRef(() => props.deal.id);
const { data: metrics, isLoading: isMetricsLoading } = useVentureDealMetrics(dealId);
const { formatCompactAmount, formatAmountByCurrencyCode } = useFormatCurrency();

const currentValue = computed(() => (metrics.value ? Number(metrics.value.currentValue) : null));
</script>

<template>
  <router-link
    v-slot="{ isActive }"
    :to="{ name: ROUTES_NAMES.ventureDealDetail, params: { dealId: deal.id } }"
    class="flex w-full"
  >
    <Button :variant="isActive ? 'secondary' : 'ghost'" as="div" size="default" class="h-auto w-full px-2">
      <div class="flex w-full items-center justify-between gap-x-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <VentureDealLogo :deal="deal" class="size-5" />
          <span class="truncate text-sm">{{ deal.name }}</span>
        </div>
        <template v-if="isMetricsLoading">
          <div class="bg-muted/30 h-3.5 w-12 shrink-0 animate-pulse rounded" />
        </template>
        <DesktopOnlyTooltip
          v-else-if="currentValue !== null"
          :content="formatAmountByCurrencyCode(currentValue, deal.currencyCode)"
        >
          <span class="text-amount shrink-0 text-sm font-medium">
            {{ formatCompactAmount(currentValue, deal.currencyCode) }}
          </span>
        </DesktopOnlyTooltip>
      </div>
    </Button>
  </router-link>
</template>
