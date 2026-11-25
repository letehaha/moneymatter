<script setup lang="ts">
import { formatShare } from '@/common/utils/percentage';
import { Card } from '@/components/lib/ui/card';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalNumber } from '@/js/helpers';
import { cn } from '@/lib/utils';
import type { HoldingModel } from '@bt/shared/types/investments';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { toOptionalNumber, useHeroFormat } from '../portfolio-hero/use-hero-format';

const props = defineProps<{
  holding: HoldingModel;
  /** Fraction of the portfolio's holdings value; null when the holding has no base-currency value. */
  weight: number | null;
  portfolioName?: string;
  /** Null while the lots are unknown. */
  openLotsCount: number | null;
  firstPurchaseDate: string | null;
  averageCost: number | null;
}>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatMoney, formatSignedMoney, formatPercent } = useHeroFormat({
  currencyCode: () => props.holding.currencyCode,
});

const cells = computed(() => {
  const { holding } = props;
  const quantity = Number(holding.quantity);
  const costBasis = Number(holding.costBasis);
  const unrealized = toOptionalNumber({ value: holding.unrealizedGainValue });
  const unrealizedPct = toOptionalNumber({ value: holding.unrealizedGainPercent });
  const realized = toOptionalNumber({ value: holding.realizedGainValue });

  return [
    {
      key: 'shares',
      label: t('portfolioDetail.holdingsTable.headers.shares'),
      value: toLocalNumber(quantity, { maximumFractionDigits: 8 }),
      hint:
        props.openLotsCount === null
          ? undefined
          : t('portfolioHolding.stats.openLotsCount', { count: props.openLotsCount }, props.openLotsCount),
    },
    {
      key: 'averageCost',
      label: t('portfolioHolding.stats.averageCost'),
      value: formatMoney({ amount: props.averageCost }),
    },
    { key: 'costBasis', label: t('portfolioDetail.hero.stats.costBasis'), value: formatMoney({ amount: costBasis }) },
    {
      key: 'unrealized',
      label: t('portfolioDetail.hero.stats.unrealized'),
      value: formatSignedMoney({ amount: unrealized }),
      valueClass: getGainColorClass({ gainValue: unrealized ?? 0 }),
      hint: unrealizedPct === null ? undefined : formatPercent({ fraction: unrealizedPct / 100 }),
    },
    {
      key: 'realized',
      label: t('portfolioDetail.hero.stats.realized'),
      value: formatSignedMoney({ amount: realized }),
      valueClass: getGainColorClass({ gainValue: realized ?? 0 }),
    },
    {
      key: 'dividends',
      label: t('portfolioHolding.stats.dividends'),
      value: formatMoney({ amount: toOptionalNumber({ value: holding.dividendIncome }) }),
    },
    {
      key: 'weight',
      label: t('portfolioDetail.holdingsTable.headers.weight'),
      value: formatShare({ fraction: props.weight }),
      hint: props.portfolioName ? t('portfolioHolding.stats.weightOf', { portfolio: props.portfolioName }) : undefined,
    },
    {
      key: 'firstPurchase',
      label: t('portfolioHolding.stats.firstPurchase'),
      value: props.firstPurchaseDate ? format(parseISO(props.firstPurchaseDate), 'MMM d, yyyy') : '—',
    },
  ];
});
</script>

<template>
  <Card class="@container/holding-stats overflow-hidden">
    <div class="-mr-px -mb-px grid grid-cols-1 @md/holding-stats:grid-cols-4">
      <div
        v-for="cell in cells"
        :key="cell.key"
        class="border-border flex min-w-0 items-baseline justify-between gap-3 border-r border-b px-3 py-2 @md/holding-stats:block @md/holding-stats:px-4 @md/holding-stats:py-3"
      >
        <div
          class="text-muted-foreground min-w-0 truncate text-sm font-medium @md/holding-stats:tracking-wide @md/holding-stats:uppercase"
        >
          {{ cell.label }}
        </div>
        <div
          class="flex min-w-0 flex-wrap items-baseline justify-end gap-x-1.5 tabular-nums @md/holding-stats:mt-0.5 @md/holding-stats:justify-start"
        >
          <span :class="cn('text-base font-bold whitespace-nowrap @md/holding-stats:text-lg', cell.valueClass)">{{
            cell.value
          }}</span>
          <span
            v-if="cell.hint"
            :class="cn('text-muted-foreground min-w-0 truncate text-xs font-medium', cell.valueClass)"
          >
            {{ cell.hint }}
          </span>
        </div>
      </div>
    </div>
  </Card>
</template>
