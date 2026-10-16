<template>
  <Tooltip.TooltipProvider>
    <Tooltip.Tooltip>
      <Tooltip.TooltipTrigger as-child>
        <span
          v-if="isSubscription"
          class="bg-success/10 text-success-text inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
        >
          {{ $t('settings.ai.modelSelector.badges.subscription') }}
          <InfoIcon class="size-3" />
        </span>
        <span
          v-else-if="usingUserKey"
          class="bg-success/10 text-success-text inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
        >
          {{ $t('settings.ai.modelSelector.badges.yourKey') }}
          <InfoIcon class="size-3" />
        </span>
        <span
          v-else
          class="bg-primary/10 text-primary-text inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap"
        >
          {{ $t('settings.ai.modelSelector.badges.server') }}
          <InfoIcon class="size-3" />
        </span>
      </Tooltip.TooltipTrigger>
      <Tooltip.TooltipContent class="max-w-70 p-3">
        <p class="text-sm">
          {{ tooltipText }}
        </p>
      </Tooltip.TooltipContent>
    </Tooltip.Tooltip>
  </Tooltip.TooltipProvider>
</template>

<script setup lang="ts">
import * as Tooltip from '@/components/lib/ui/tooltip';
import { InfoIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  usingUserKey: boolean;
  /** The answering connection runs on the owner's subscription rather than a per-token key. */
  isSubscription?: boolean;
}>();

const { t } = useI18n();

const tooltipText = computed(() => {
  if (props.isSubscription) return t('settings.ai.modelSelector.badges.subscriptionTooltip');
  return props.usingUserKey
    ? t('settings.ai.modelSelector.badges.yourKeyTooltip')
    : t('settings.ai.modelSelector.badges.serverTooltip');
});
</script>
