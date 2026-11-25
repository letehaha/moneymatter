<script setup lang="ts">
import { formatShare } from '@/common/utils/percentage';
import { getSecurityLogoUrl, type SecurityLogoSource } from '@/common/utils/security-logo-url';
import { ChartTooltip, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import CurrencyIcon from '@/components/common/currency-icon.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { formatCompactUIAmount } from '@/js/helpers/formatters';
import {
  ALLOCATION_CASH_KEY,
  type PortfolioAllocationEntryModel,
  type PortfolioAllocationModel,
  type PortfolioAnalyticsHoldingModel,
  SECURITY_TYPE,
} from '@bt/shared/types/investments';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import { buildColorMap, getHoldingLabel, groupAllocationTail } from './analytics-derivations';

const props = defineProps<{
  allocation: PortfolioAllocationModel;
  holdings: PortfolioAnalyticsHoldingModel[];
  currencyCode: string;
  logoSources: Map<string, SecurityLogoSource>;
}>();

const { t } = useI18n();
const { formatMoney } = useHeroFormat({ currencyCode: () => props.currencyCode });

const TREEMAP_HEIGHT_PX = 320;
const NARROW_TREEMAP_HEIGHT_PX = 240;
const NARROW_TREEMAP_WIDTH_PX = 420;
const TILE_GAP_PX = 3;
const OTHER_MIN_WEIGHT = 0.02;
const OTHER_TILE_KEY = '__allocation-other__';
const COMPACT_AMOUNT_FROM = 1000;
const LABEL_MIN = { width: 48, height: 28 };
const DETAIL_MIN = { width: 96, height: 48 };

type Grouping = 'byHolding' | 'bySecurityType' | 'byCurrency';
const grouping = ref<Grouping>('byHolding');

const groupingItems = computed(() => [
  { value: 'byHolding', label: t('portfolioDetail.analytics.allocation.byHolding') },
  { value: 'bySecurityType', label: t('portfolioDetail.analytics.allocation.byType') },
  { value: 'byCurrency', label: t('portfolioDetail.analytics.allocation.byCurrency') },
]);

const securityTypeLabels = computed<Record<SECURITY_TYPE | typeof ALLOCATION_CASH_KEY, string>>(() => ({
  [SECURITY_TYPE.stock]: t('portfolioDetail.analytics.securityTypes.stock'),
  [SECURITY_TYPE.etf]: t('portfolioDetail.analytics.securityTypes.etf'),
  [SECURITY_TYPE.mutual_fund]: t('portfolioDetail.analytics.securityTypes.mutualFund'),
  [SECURITY_TYPE.bond]: t('portfolioDetail.analytics.securityTypes.bond'),
  [SECURITY_TYPE.crypto]: t('portfolioDetail.analytics.securityTypes.crypto'),
  [SECURITY_TYPE.option]: t('portfolioDetail.analytics.securityTypes.option'),
  [SECURITY_TYPE.other]: t('portfolioDetail.analytics.securityTypes.other'),
  [ALLOCATION_CASH_KEY]: t('portfolioDetail.analytics.securityTypes.cash'),
}));

const holdingNames = computed(() => new Map(props.holdings.map(({ securityId, name }) => [securityId, name])));

const labelFor = ({ entry }: { entry: PortfolioAllocationEntryModel }) => {
  if (grouping.value !== 'byHolding') return entry.key;
  return entry.key === ALLOCATION_CASH_KEY
    ? t('portfolioDetail.hero.stats.cash')
    : getHoldingLabel({ symbol: entry.label, name: holdingNames.value.get(entry.key) });
};

type TileIcon = { currencyCode: string } | { security: SecurityLogoSource };

const iconFor = ({ key }: { key: string }): TileIcon | undefined => {
  if (grouping.value === 'byCurrency') return { currencyCode: key };
  const security = grouping.value === 'byHolding' ? props.logoSources.get(key) : undefined;
  return security && getSecurityLogoUrl(security) ? { security } : undefined;
};

interface Tile {
  key: string;
  label: string;
  color: string;
  value: number;
  weight: number;
  icon?: TileIcon;
}

const tiles = computed<Tile[]>(() => {
  const entries: { key: string; label: string; value: string; weight: string }[] =
    grouping.value === 'bySecurityType'
      ? props.allocation.bySecurityType.map((entry) => ({ ...entry, label: securityTypeLabels.value[entry.key] }))
      : props.allocation[grouping.value].map((entry) => ({ ...entry, label: labelFor({ entry }) }));
  const colors = buildColorMap({ keys: entries.map(({ key }) => key) });

  // A treemap can't size a negative area, such as cash drawn below zero.
  const positive = entries
    .map((entry) => ({ ...entry, value: Number(entry.value), weight: Number(entry.weight) }))
    .filter(({ value }) => value > 0);
  const { kept, other } = groupAllocationTail({ entries: positive, minWeight: OTHER_MIN_WEIGHT });

  return [
    ...kept.map((entry) => ({
      ...entry,
      color: colors.get(entry.key) ?? OTHERS_SERIES_COLOR,
      icon: iconFor({ key: entry.key }),
    })),
    ...(other
      ? [
          {
            key: OTHER_TILE_KEY,
            label: t('portfolioDetail.analytics.allocation.other', { count: other.count }),
            color: OTHERS_SERIES_COLOR,
            value: other.value,
            weight: other.weight,
          },
        ]
      : []),
  ];
});

const containerRef = ref<HTMLDivElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const width = ref(0);
useResizeObserver(containerRef, ([entry]) => {
  width.value = entry?.contentRect.width ?? 0;
});
const treemapHeight = computed(() =>
  width.value > 0 && width.value < NARROW_TREEMAP_WIDTH_PX ? NARROW_TREEMAP_HEIGHT_PX : TREEMAP_HEIGHT_PX,
);

type TreemapNode = { children: Tile[] } | Tile;

const layout = computed(() => {
  if (width.value <= 0 || tiles.value.length === 0) return [];

  const root = d3
    .hierarchy<TreemapNode>({ children: tiles.value }, (node) => ('children' in node ? node.children : undefined))
    .sum((node) => ('children' in node ? 0 : node.value))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  return d3
    .treemap<TreemapNode>()
    .size([width.value, treemapHeight.value])
    .paddingInner(TILE_GAP_PX)
    .round(true)(root)
    .leaves()
    .map((leaf) => ({
      tile: leaf.data as Tile,
      left: leaf.x0,
      top: leaf.y0,
      width: leaf.x1 - leaf.x0,
      height: leaf.y1 - leaf.y0,
    }));
});

const fits = ({ box, min }: { box: { width: number; height: number }; min: { width: number; height: number } }) =>
  box.width >= min.width && box.height >= min.height;

// Mixed into the card color so the label stays readable on every hue in both themes.
const tileBackground = ({ tile }: { tile: Tile }) =>
  `color-mix(in srgb, ${tile.color} ${tile.key === OTHER_TILE_KEY ? 30 : 55}%, var(--color-card))`;

const tooltip = reactive({ visible: false, x: 0, y: 0, tile: null as Tile | null });
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const showTooltip = ({ event, tile }: { event: MouseEvent; tile: Tile }) => {
  tooltip.tile = tile;
  tooltip.visible = true;
  updateTooltipPosition(event);
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-base font-semibold">{{ $t('portfolioDetail.analytics.allocation.title') }}</h2>
      <PillTabs
        :model-value="grouping"
        :items="groupingItems"
        size="sm"
        @update:model-value="(value) => (grouping = value as Grouping)"
      />
    </div>

    <p v-if="tiles.length === 0" class="text-muted-foreground py-6 text-center text-sm">
      {{ $t('portfolioDetail.analytics.allocation.empty') }}
    </p>
    <div v-else ref="containerRef" class="relative w-full" :style="{ height: `${treemapHeight}px` }">
      <div
        v-for="box in layout"
        :key="box.tile.key"
        class="absolute overflow-hidden rounded-md px-2 py-1.5"
        :style="{
          left: `${box.left}px`,
          top: `${box.top}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: tileBackground({ tile: box.tile }),
        }"
        @mousemove="(event) => showTooltip({ event, tile: box.tile })"
        @mouseleave="tooltip.visible = false"
      >
        <template v-if="fits({ box, min: LABEL_MIN })">
          <p class="flex min-w-0 items-center gap-1.5 text-sm font-bold">
            <template v-if="box.tile.icon && fits({ box, min: DETAIL_MIN })">
              <CurrencyIcon v-if="'currencyCode' in box.tile.icon" :code="box.tile.icon.currencyCode" size="size-5" />
              <SecurityLogo v-else :security="box.tile.icon.security" class="size-5" />
            </template>
            <span class="truncate">{{ box.tile.label }}</span>
          </p>
          <p v-if="fits({ box, min: DETAIL_MIN })" class="truncate text-xs tabular-nums">
            {{ formatShare({ fraction: box.tile.weight }) }} ·
            {{ formatCompactUIAmount({ amount: box.tile.value, currency: currencyCode, from: COMPACT_AMOUNT_FROM }) }}
          </p>
        </template>
      </div>

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip v-if="tooltip.tile" class="min-w-48">
          <div class="mb-1.5 flex min-w-0 items-center gap-2 text-sm font-semibold">
            <template v-if="tooltip.tile.icon">
              <CurrencyIcon
                v-if="'currencyCode' in tooltip.tile.icon"
                :code="tooltip.tile.icon.currencyCode"
                size="size-5"
              />
              <SecurityLogo v-else :security="tooltip.tile.icon.security" class="size-5" />
            </template>
            <span class="truncate">{{ tooltip.tile.label }}</span>
          </div>
          <ChartTooltipRow
            :color="tooltip.tile.color"
            :label="$t('portfolioDetail.analytics.table.value')"
            :value="formatMoney({ amount: tooltip.tile.value })"
          />
          <ChartTooltipRow
            :label="$t('portfolioDetail.analytics.table.weight')"
            :value="formatShare({ fraction: tooltip.tile.weight })"
          />
        </ChartTooltip>
      </div>
    </div>
  </div>
</template>
