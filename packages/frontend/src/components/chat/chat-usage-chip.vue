<script setup lang="ts">
import { getCurrentLocale } from '@/i18n';
import type { ChatUsage } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ usage: ChatUsage }>();

const { t } = useI18n();

const totalTokens = computed(() => props.usage.inputTokens + props.usage.outputTokens);

const compact = computed(() =>
  new Intl.NumberFormat(getCurrentLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(
    totalTokens.value,
  ),
);

const tooltip = computed(() => {
  const format = new Intl.NumberFormat(getCurrentLocale());
  return t('chat.usage.tooltip', {
    input: format.format(props.usage.inputTokens),
    output: format.format(props.usage.outputTokens),
    cached: format.format(props.usage.cachedInputTokens),
  });
});
</script>

<template>
  <span
    v-if="totalTokens > 0"
    class="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
    :title="tooltip"
    :aria-label="$t('chat.usage.label')"
  >
    {{ $t('chat.usage.chip', { count: compact }) }}
  </span>
</template>
