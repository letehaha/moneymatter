<script setup lang="ts">
import type { AiAllowanceTone } from '@/composable/use-ai-allowance';
import { cn } from '@/lib/utils';

defineProps<{
  usedPercent: number;
  tone: AiAllowanceTone;
}>();

const BAR_CLASS: Record<AiAllowanceTone, string> = {
  ok: 'bg-primary',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};
</script>

<template>
  <div
    class="bg-muted h-2 overflow-hidden rounded-full"
    role="progressbar"
    :aria-label="$t('aiUsage.title')"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="usedPercent"
  >
    <div :class="cn('h-full rounded-full', BAR_CLASS[tone])" :style="{ width: `${usedPercent}%` }" />
  </div>
</template>
