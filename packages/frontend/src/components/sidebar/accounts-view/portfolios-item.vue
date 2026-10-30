<script setup lang="ts">
import PortfolioLogo from '@/components/common/portfolio-logo.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { usePortfolioSummaries } from '@/composable/data-queries/portfolio-summary';
import { useFormatCurrency } from '@/composable/formatters';
import { ROUTES_NAMES } from '@/routes/constants';
import { PortfolioModel } from '@bt/shared/types/investments';
import { EyeOffIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{
  portfolio: PortfolioModel;
}>();

const { data: summaries, isFetching: isSummaryFetching } = usePortfolioSummaries();
const summary = computed(() => summaries.value?.find((item) => item.portfolioId === props.portfolio.id));
const { formatCompactAmount, formatAmountByCurrencyCode } = useFormatCurrency();

const totalValue = computed(() => (summary.value ? Number(summary.value.totalPortfolioValue) : null));
const currencyCode = computed(() => summary.value?.currencyCode ?? 'USD');
</script>

<template>
  <router-link
    v-slot="{ isActive }"
    :to="{ name: ROUTES_NAMES.portfolioDetail, params: { portfolioId: portfolio.id } }"
    class="flex w-full"
  >
    <Button
      :variant="isActive ? 'secondary' : 'ghost'"
      as="div"
      size="default"
      class="h-auto w-full px-2"
      :class="!portfolio.isEnabled && 'opacity-60'"
    >
      <div class="flex w-full items-center justify-between gap-x-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <PortfolioLogo :portfolio="portfolio" class="size-5" />
          <span class="truncate text-sm">{{ portfolio.name }}</span>
          <EyeOffIcon v-if="!portfolio.isEnabled" class="text-muted-foreground size-3 shrink-0" />
        </div>
        <template v-if="isSummaryFetching && !summary">
          <div class="bg-muted/30 h-3.5 w-12 shrink-0 animate-pulse rounded" />
        </template>
        <DesktopOnlyTooltip
          v-else-if="totalValue !== null"
          :content="formatAmountByCurrencyCode(totalValue, currencyCode)"
        >
          <span class="text-amount shrink-0 text-sm font-medium">
            {{ formatCompactAmount(totalValue, currencyCode) }}
          </span>
        </DesktopOnlyTooltip>
      </div>
    </Button>
  </router-link>
</template>
