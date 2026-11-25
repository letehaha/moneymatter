<script setup lang="ts">
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalNumber } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { LayersIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import type { OpenLot } from './holding-derivations';

const props = defineProps<{ lots: OpenLot[]; currencyCode: string }>();

const { format } = useDateLocale();
const { formatMoney, formatSignedMoney, formatPercent } = useHeroFormat({ currencyCode: () => props.currencyCode });

const headCell = 'bg-table-header px-3 py-2 text-xs font-medium tracking-wider uppercase';
</script>

<template>
  <div v-if="lots.length === 0" class="flex flex-col items-center py-10 text-center">
    <div class="bg-muted mb-3 flex size-10 items-center justify-center rounded-full">
      <LayersIcon class="text-muted-foreground size-5" />
    </div>
    <h3 class="mb-1 font-semibold">{{ $t('portfolioHolding.lots.empty') }}</h3>
    <p class="text-muted-foreground max-w-md text-sm">{{ $t('portfolioHolding.lots.emptyDescription') }}</p>
  </div>

  <div v-else>
    <p class="text-muted-foreground px-3 pb-2 text-sm">{{ $t('portfolioHolding.lots.fifoHint') }}</p>
    <ScrollArea viewport-class="overscroll-x-none" with-horizontal-scrollbar>
      <div class="pb-2.5">
        <table class="w-full min-w-150 tabular-nums">
          <thead class="text-muted-foreground">
            <tr>
              <th :class="cn(headCell, 'text-left')">{{ $t('portfolioHolding.lots.date') }}</th>
              <th :class="cn(headCell, 'text-right')">{{ $t('portfolioDetail.holdingsTable.headers.shares') }}</th>
              <th :class="cn(headCell, 'text-right')">{{ $t('portfolioHolding.lots.costPerShare') }}</th>
              <th :class="cn(headCell, 'text-right')">{{ $t('portfolioHolding.lots.currentValue') }}</th>
              <th :class="cn(headCell, 'text-right')">{{ $t('portfolioHolding.lots.gain') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lot in lots" :key="lot.id" class="hover:bg-hover border-t text-sm">
              <td class="px-3 py-2.5">{{ format(parseISO(lot.date), 'MMM d, yyyy') }}</td>
              <td class="px-3 py-2.5 text-right">{{ toLocalNumber(lot.quantity, { maximumFractionDigits: 8 }) }}</td>
              <td class="px-3 py-2.5 text-right">{{ formatMoney({ amount: lot.costPerShare }) }}</td>
              <td class="px-3 py-2.5 text-right">{{ formatMoney({ amount: lot.marketValue }) }}</td>
              <td :class="cn('px-3 py-2.5 text-right', getGainColorClass({ gainValue: lot.gain ?? 0 }))">
                <div class="font-semibold">{{ formatSignedMoney({ amount: lot.gain }) }}</div>
                <div class="text-xs">{{ formatPercent({ fraction: lot.gainPct }) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </ScrollArea>
  </div>
</template>
