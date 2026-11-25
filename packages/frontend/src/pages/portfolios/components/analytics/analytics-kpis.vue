<script setup lang="ts">
import { formatFractionAsPercent, formatSignedPercent } from '@/common/utils/percentage';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { PortfolioAnalyticsKpisModel } from '@bt/shared/types/investments';
import { isSameYear, parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';

const props = defineProps<{ kpis: PortfolioAnalyticsKpisModel; currencyCode: string }>();

const { t } = useI18n();
const { formatMoney } = useHeroFormat({ currencyCode: () => props.currencyCode });
const { format } = useDateLocale();

const formatDay = ({ date }: { date: string }) => {
  const parsed = parseISO(date);
  return format(parsed, isSameYear(parsed, new Date()) ? 'MMM d' : 'MMM d, yyyy');
};

const timeWeighted = computed(() => Number(props.kpis.timeWeightedReturn));
const moneyWeighted = computed(() =>
  props.kpis.moneyWeightedReturn === null ? null : Number(props.kpis.moneyWeightedReturn),
);

const drawdownRange = computed(() => {
  const { maxDrawdown } = props.kpis;
  if (!maxDrawdown) return null;
  const range = {
    peak: formatDay({ date: maxDrawdown.peakDate }),
    trough: formatDay({ date: maxDrawdown.troughDate }),
  };
  return maxDrawdown.recoveredDate
    ? t('portfolioDetail.analytics.kpis.drawdownRecovered', {
        ...range,
        date: formatDay({ date: maxDrawdown.recoveredDate }),
      })
    : t('portfolioDetail.analytics.kpis.drawdownNotRecovered', range);
});
</script>

<template>
  <dl class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
    <div class="flex items-baseline gap-1.5">
      <dt class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.timeWeightedLabel') }}</dt>
      <dd :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: timeWeighted }))">
        {{ formatSignedPercent({ fraction: timeWeighted }) }}
      </dd>
    </div>

    <div class="flex flex-wrap items-baseline gap-x-1.5">
      <dt class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.maxDrawdownLabel') }}</dt>
      <template v-if="kpis.maxDrawdown">
        <dd class="text-destructive-text font-semibold tabular-nums">
          {{ formatSignedPercent({ fraction: Number(kpis.maxDrawdown.value) }) }}
        </dd>
        <dd class="text-muted-foreground">{{ drawdownRange }}</dd>
      </template>
      <dd v-else>{{ $t('portfolioDetail.analytics.kpis.noDrawdown') }}</dd>
    </div>

    <div class="flex flex-wrap items-baseline gap-x-1.5">
      <dt class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.moneyWeightedLabel') }}</dt>
      <template v-if="moneyWeighted !== null">
        <dd :class="cn('font-semibold tabular-nums', getGainColorClass({ gainValue: moneyWeighted }))">
          {{ formatSignedPercent({ fraction: moneyWeighted }) }}
        </dd>
        <dd class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.annualizedSinceFirstDeposit') }}</dd>
      </template>
      <dd v-else class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.moneyWeightedUnavailable') }}</dd>
    </div>

    <div class="flex flex-wrap items-baseline gap-x-1.5">
      <dt class="text-muted-foreground">{{ $t('portfolioDetail.analytics.kpis.feesPaidLabel') }}</dt>
      <dd class="font-semibold tabular-nums">{{ formatMoney({ amount: Number(kpis.feesPaid.amount) }) }}</dd>
      <dd v-if="kpis.feesPaid.shareOfBuys !== null" class="text-muted-foreground">
        {{
          $t('portfolioDetail.analytics.kpis.feesShareOfBuys', {
            share: formatFractionAsPercent(kpis.feesPaid.shareOfBuys),
          })
        }}
      </dd>
    </div>
  </dl>
</template>
