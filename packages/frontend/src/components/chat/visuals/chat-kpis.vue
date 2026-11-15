<script setup lang="ts">
import StatCard from '@/components/lib/ui/stat-card/stat-card.vue';
import { cn } from '@/lib/utils';
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from '@lucide/vue';
import type { ChatKpiDelta, ChatKpiItem, ChatKpisSpec } from '@bt/shared/types';

import { formatVisualValue } from './format-visual-value';

defineProps<{ spec: ChatKpisSpec }>();

/** An upward move reads in the income color and a downward one in the expense color, whatever the KPI is. */
const DELTA_STYLES = {
  up: { textClass: 'text-app-income-color', icon: ArrowUpRightIcon, labelKey: 'chat.visuals.deltaUp' },
  down: { textClass: 'text-app-expense-color', icon: ArrowDownRightIcon, labelKey: 'chat.visuals.deltaDown' },
  flat: { textClass: 'text-muted-foreground', icon: MinusIcon, labelKey: 'chat.visuals.deltaFlat' },
} as const satisfies Record<ChatKpiDelta['direction'], object>;

const formatValue = ({ item }: { item: ChatKpiItem }) =>
  formatVisualValue({ value: item.value, kind: item.kind, currencyCode: item.currencyCode });

/** The direction is in the arrow, so the figure is the size of the move. */
const formatDelta = ({ item, delta }: { item: ChatKpiItem; delta: ChatKpiDelta }) =>
  formatVisualValue({
    value: Math.abs(delta.value),
    kind: delta.kind === 'money' ? 'money' : 'percent',
    currencyCode: item.currencyCode,
  });
</script>

<template>
  <div class="@container/chat-kpis">
    <div class="grid grid-cols-1 gap-2 @xs/chat-kpis:grid-cols-2 @xl/chat-kpis:grid-cols-3">
      <StatCard
        v-for="(item, index) in spec.items"
        :key="index"
        data-testid="kpi"
        :label="item.label"
        :value="formatValue({ item })"
      >
        <p class="text-foreground mt-1 text-2xl font-bold wrap-anywhere tabular-nums">
          {{ formatValue({ item }) }}
        </p>
        <p
          v-if="item.delta"
          data-testid="kpi-delta"
          :data-direction="item.delta.direction"
          :class="
            cn(
              'mt-1 flex items-center gap-1 text-xs font-medium tabular-nums',
              DELTA_STYLES[item.delta.direction].textClass,
            )
          "
        >
          <component :is="DELTA_STYLES[item.delta.direction].icon" class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ $t(DELTA_STYLES[item.delta.direction].labelKey) }}</span>
          {{ formatDelta({ item, delta: item.delta }) }}
        </p>
      </StatCard>
    </div>
  </div>
</template>
