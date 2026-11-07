<template>
  <div class="flex flex-col gap-1.5" data-testid="tool-count-bar">
    <div class="flex items-baseline justify-between gap-2 text-sm">
      <span class="font-medium">
        {{ $t('oauth.authorize.toolsets.selected', { count: selection.selectedCount }, selection.selectedCount) }}
      </span>
      <span class="text-muted-foreground text-xs">
        {{ $t('oauth.authorize.toolsets.of_total', { total: selection.totalCount }) }}
      </span>
    </div>

    <div
      class="bg-muted relative h-2 rounded-full"
      role="progressbar"
      :aria-label="$t('oauth.authorize.toolsets.counter_label')"
      :aria-valuemin="0"
      :aria-valuemax="selection.totalCount"
      :aria-valuenow="selection.selectedCount"
    >
      <div
        :class="cn('h-full rounded-full transition-all', selection.overCap ? 'bg-warning' : 'bg-primary')"
        :style="{ width: `${selection.selectedPercent}%` }"
      />
      <!-- Marks the client tool cap on the bar -->
      <div
        v-if="selection.capPercent !== null"
        class="bg-foreground absolute -top-1 h-4 w-0.5 rounded-full"
        :style="{ left: `${selection.capPercent}%` }"
        data-testid="tool-cap-marker"
      />
    </div>

    <p :class="cn('text-xs', selection.overCap ? 'text-warning-text' : 'text-muted-foreground')">
      {{
        selection.overCap
          ? $t('oauth.authorize.toolsets.over_cap', { cap })
          : $t('oauth.authorize.toolsets.fits_cap', { cap })
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { cn } from '@/lib/utils';

import type { ToolSelection } from './toolset-selection';

defineProps<{
  selection: ToolSelection;
  cap: number;
}>();
</script>
