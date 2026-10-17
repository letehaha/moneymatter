<script setup lang="ts">
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import type { AI_FEATURE } from '@bt/shared/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AiUsageDialog from './ai-usage-dialog.vue';

const props = defineProps<{
  /** Omit for AI use that isn't a configurable feature, so only the allowance decides. */
  feature?: AI_FEATURE;
}>();

const { t } = useI18n();
const { allowance, usedPercent, tone, showBadge } = useAiAllowance();
const isDialogOpen = ref(false);

const isReachedState = computed(() => allowance.value?.state === 'reached');
const label = computed(() =>
  isReachedState.value ? t('aiUsage.badge.reached') : t('aiUsage.badge.used', { percent: usedPercent.value }),
);
</script>

<template>
  <template v-if="showBadge({ feature: props.feature })">
    <!-- `.stop` keeps the click from also reaching a surrounding trigger -->
    <button
      type="button"
      aria-haspopup="dialog"
      :aria-label="`${$t('aiUsage.title')}: ${label}`"
      class="focus-visible:ring-ring inline-flex rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:outline-hidden"
      @click.stop="isDialogOpen = true"
    >
      <StatusBadge :variant="tone === 'danger' ? 'destructive' : 'warning'">{{ label }}</StatusBadge>
    </button>
    <AiUsageDialog v-model:open="isDialogOpen" />
  </template>
</template>
