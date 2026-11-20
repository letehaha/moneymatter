<script lang="ts" setup>
import { type Period } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import { useI18n } from 'vue-i18n';

import { type DateSelectorPreset } from './types';

const props = defineProps<{
  presets: DateSelectorPreset[];
  currentPeriod: Period;
  horizontal?: boolean;
}>();

const emit = defineEmits<{
  apply: [value: Period];
}>();

const { t } = useI18n();

function isPresetActive(preset: DateSelectorPreset): boolean {
  const presetValue = preset.getValue();
  return (
    props.currentPeriod.from.getTime() === presetValue.from.getTime() &&
    props.currentPeriod.to.getTime() === presetValue.to.getTime()
  );
}
</script>

<template>
  <div :class="cn('flex gap-1', horizontal ? 'flex-wrap' : 'flex-col')">
    <div v-if="!horizontal" class="text-muted-foreground mb-1 text-xs font-semibold">
      {{ t('common.dateSelector.quickSelect') }}
    </div>
    <button
      v-for="preset in presets"
      :key="preset.label"
      type="button"
      :class="
        cn(
          'text-muted-foreground hover:bg-hover hover:text-foreground rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap transition-colors',
          isPresetActive(preset) && 'bg-accent hover:bg-accent text-foreground font-medium',
        )
      "
      @click="emit('apply', preset.getValue())"
    >
      {{ preset.label }}
    </button>
  </div>
</template>
