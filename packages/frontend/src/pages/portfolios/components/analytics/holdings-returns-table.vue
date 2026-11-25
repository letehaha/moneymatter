<script setup lang="ts">
import { formatShare } from '@/common/utils/percentage';
import type { SecurityLogoSource } from '@/common/utils/security-logo-url';
import SecurityLogo from '@/components/common/security-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { getGainColorClass } from '@/composable/gain-color';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { PORTFOLIO_RETURN_PERIODS, type PortfolioAnalyticsHoldingModel } from '@bt/shared/types/investments';
import { computed, ref } from 'vue';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import { usePeriodLabels } from '../portfolio-hero/use-period-labels';
import { getHoldingLabel } from './analytics-derivations';

const props = defineProps<{
  portfolioId: string;
  holdings: PortfolioAnalyticsHoldingModel[];
  currencyCode: string;
  logoSources: Map<string, SecurityLogoSource>;
}>();

const { formatMoney, formatPercent } = useHeroFormat({ currencyCode: () => props.currencyCode });

const COLLAPSED_ROW_COUNT = 8;

const isExpanded = ref(false);
const visibleHoldings = computed(() =>
  isExpanded.value ? props.holdings : props.holdings.slice(0, COLLAPSED_ROW_COUNT),
);

const periodLabels = usePeriodLabels();

const holdingRoute = ({ securityId }: { securityId: string }) => ({
  name: ROUTES_NAMES.portfolioHolding,
  params: { portfolioId: props.portfolioId, securityId },
});

const headerCell = 'text-muted-foreground px-3 py-2 text-right text-xs font-semibold tracking-wide uppercase';
</script>

<template>
  <div>
    <ScrollArea with-horizontal-scrollbar>
      <table class="w-full min-w-180 text-sm tabular-nums">
        <thead class="bg-table-header">
          <tr>
            <th :class="cn(headerCell, 'pl-4 text-left')">{{ $t('portfolioDetail.analytics.table.holding') }}</th>
            <th :class="headerCell">{{ $t('portfolioDetail.analytics.table.weight') }}</th>
            <th :class="headerCell">{{ $t('portfolioDetail.analytics.table.value') }}</th>
            <th v-for="period in PORTFOLIO_RETURN_PERIODS" :key="period" :class="cn(headerCell, 'last:pr-4')">
              {{ periodLabels[period] }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y">
          <tr v-for="holding in visibleHoldings" :key="holding.securityId" class="hover:bg-hover transition-colors">
            <td class="py-2.5 pr-3 pl-4">
              <RouterLink
                :to="holdingRoute({ securityId: holding.securityId })"
                class="flex min-w-0 items-center gap-2.5"
              >
                <SecurityLogo
                  v-if="logoSources.get(holding.securityId)"
                  :security="logoSources.get(holding.securityId)!"
                  class="size-5"
                />
                <span class="font-semibold">{{ getHoldingLabel(holding) }}</span>
                <span v-if="holding.symbol && holding.name" class="text-muted-foreground max-w-48 truncate text-xs">
                  {{ holding.name }}
                </span>
              </RouterLink>
            </td>
            <td class="px-3 py-2.5 text-right">{{ formatShare({ fraction: Number(holding.weight) }) }}</td>
            <td class="px-3 py-2.5 text-right">{{ formatMoney({ amount: Number(holding.value) }) }}</td>
            <td
              v-for="period in PORTFOLIO_RETURN_PERIODS"
              :key="period"
              :class="
                cn(
                  'px-3 py-2.5 text-right font-semibold last:pr-4',
                  holding.returns[period] === null
                    ? 'text-muted-foreground'
                    : getGainColorClass({ gainValue: Number(holding.returns[period]) }),
                )
              "
            >
              {{
                holding.returns[period] === null ? '—' : formatPercent({ fraction: Number(holding.returns[period]) })
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </ScrollArea>

    <div v-if="holdings.length > COLLAPSED_ROW_COUNT" class="border-t px-4 pt-3">
      <Button variant="outline" size="sm" @click="isExpanded = !isExpanded">
        {{
          isExpanded
            ? $t('portfolioDetail.analytics.table.showLess')
            : $t('portfolioDetail.analytics.table.showAll', { count: holdings.length })
        }}
      </Button>
    </div>
  </div>
</template>
