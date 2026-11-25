<script setup lang="ts">
import { formatShare } from '@/common/utils/percentage';
import { Card } from '@/components/lib/ui/card';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { TrendingUpIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import type { BuyTiming } from './holding-derivations';

const props = defineProps<{ timing: BuyTiming; currencyCode: string }>();

const { format } = useDateLocale();
const { formatMoney } = useHeroFormat({ currencyCode: () => props.currencyCode });
</script>

<template>
  <Card class="flex items-start gap-3.5 p-4">
    <div class="bg-primary/10 flex size-9 shrink-0 items-center justify-center rounded-lg">
      <TrendingUpIcon class="text-primary-text size-4.5" />
    </div>
    <div class="flex min-w-0 flex-col gap-1">
      <h2 class="font-semibold">{{ $t('portfolioHolding.timing.title') }}</h2>
      <i18n-t
        :keypath="timing.difference <= 0 ? 'portfolioHolding.timing.below' : 'portfolioHolding.timing.above'"
        tag="p"
        class="text-muted-foreground text-sm leading-relaxed"
      >
        <template #averageBuyPrice>
          <span class="text-foreground font-semibold tabular-nums">{{
            formatMoney({ amount: timing.averageBuyPrice })
          }}</span>
        </template>
        <template #difference>
          <span :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: -timing.difference }))">
            {{ formatShare({ fraction: Math.abs(timing.difference) }) }}
          </span>
        </template>
        <template #averageClose>
          <span class="text-foreground font-semibold tabular-nums">{{
            formatMoney({ amount: timing.averageClose })
          }}</span>
        </template>
        <template #firstBuyDate>
          <span class="tabular-nums">{{ format(parseISO(timing.firstBuyDate), 'MMM d, yyyy') }}</span>
        </template>
      </i18n-t>
    </div>
  </Card>
</template>
