<script setup lang="ts">
import { useChartColors } from '@/composable/charts/chart-colors';
import type { ChatDonutChartSpec } from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { buildDonutGeometry } from './chart-geometry';
import { formatVisualValue } from './format-visual-value';

const props = defineProps<{ spec: ChatDonutChartSpec }>();

const { t } = useI18n();
const colors = useChartColors();

const MAX_DONUT_SIZE = 180;
const DEFAULT_WIDTH = 480;
const DIMMED_OPACITY = 0.35;

const containerRef = ref<HTMLDivElement | null>(null);
const width = ref(DEFAULT_WIDTH);
const activeIndex = ref<number | null>(null);

useResizeObserver(containerRef, (entries) => {
  const measured = Math.floor(entries[0]?.contentRect.width ?? 0);
  if (measured > 0) width.value = measured;
});

const donutSize = computed(() => Math.min(MAX_DONUT_SIZE, width.value));

const geometry = computed(() =>
  buildDonutGeometry({
    slices: props.spec.slices,
    size: { width: donutSize.value, height: donutSize.value },
    othersLabel: t('chat.visuals.others'),
  }),
);

const formatValue = ({ value }: { value: number }) =>
  formatVisualValue({
    value,
    kind: props.spec.unit.kind,
    currencyCode: props.spec.unit.kind === 'money' ? props.spec.unit.currencyCode : undefined,
  });

const formatShare = ({ share }: { share: number }) => formatVisualValue({ value: share * 100, kind: 'percent' });

const center = computed(() => {
  const active = activeIndex.value === null ? undefined : geometry.value.slices[activeIndex.value];
  return active
    ? { label: active.label, value: formatValue({ value: active.value }) }
    : { label: t('common.labels.total'), value: formatValue({ value: geometry.value.total }) };
});

const opacityOf = ({ index }: { index: number }) =>
  activeIndex.value === null || activeIndex.value === index ? 1 : DIMMED_OPACITY;
</script>

<template>
  <div ref="containerRef" class="@container/chat-donut flex flex-col items-center gap-3 @md/chat-donut:flex-row">
    <div class="relative shrink-0" :style="{ width: `${donutSize}px`, height: `${donutSize}px` }">
      <svg :width="donutSize" :height="donutSize" role="img" :aria-label="spec.title" class="block">
        <g :transform="`translate(${geometry.cx},${geometry.cy})`">
          <path
            v-for="(slice, index) in geometry.slices"
            :key="index"
            data-testid="chart-slice"
            :d="slice.path"
            :fill="slice.color"
            :fill-opacity="opacityOf({ index })"
            :stroke="colors.card"
            stroke-width="1"
            class="transition-opacity"
            @pointerenter="activeIndex = index"
            @pointerleave="activeIndex = null"
          />
        </g>
      </svg>
      <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span class="text-muted-foreground max-w-full truncate text-xs">{{ center.label }}</span>
        <span class="max-w-full truncate text-sm font-semibold tabular-nums">{{ center.value }}</span>
      </div>
    </div>

    <ul data-testid="chart-legend" class="flex w-full min-w-0 flex-col gap-1 text-xs">
      <li
        v-for="(slice, index) in geometry.slices"
        :key="index"
        class="flex min-w-0 items-center gap-2"
        @pointerenter="activeIndex = index"
        @pointerleave="activeIndex = null"
      >
        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: slice.color }" />
        <span class="text-muted-foreground min-w-0 flex-1 truncate">{{ slice.label }}</span>
        <span class="shrink-0 font-medium tabular-nums">{{ formatValue({ value: slice.value }) }}</span>
        <span class="text-muted-foreground w-12 shrink-0 text-right tabular-nums">{{
          formatShare({ share: slice.share })
        }}</span>
      </li>
    </ul>
  </div>
</template>
