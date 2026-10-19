<script setup lang="ts">
import { getMonogramTextColor } from '@/common/utils/monogram-color';
import { DEFAULT_MONOGRAM_COLOR } from '@/components/common/logo-selection';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { cn } from '@/lib/utils';
import { PipetteIcon } from '@lucide/vue';
import { computed, useId } from 'vue';

const color = defineModel<string>({ required: true });

// Curated swatches (violet, gray, red, amber, green, teal, blue, pink, stone).
// Storage is plain hex either way, so this list can change freely.
const COLOR_PRESETS = [
  DEFAULT_MONOGRAM_COLOR,
  '#6b7280',
  '#dc2626',
  '#f59e0b',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#db2777',
  '#78716c',
];

const labelId = useId();
const isCustomColor = computed(() => !COLOR_PRESETS.includes(color.value));
const customSwatchStyle = computed(() => ({
  backgroundColor: color.value,
  color: getMonogramTextColor({ hex: color.value }),
}));

function handleCustomColor(event: Event) {
  color.value = (event.target as HTMLInputElement).value.toLowerCase();
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label :id="labelId" class="text-xs font-medium">{{ $t('common.logo.colorLabel') }}</Label>
    <div role="group" :aria-labelledby="labelId" class="flex flex-wrap items-center gap-2">
      <Button
        v-for="preset in COLOR_PRESETS"
        :key="preset"
        type="button"
        variant="ghost"
        size="icon-sm"
        :class="
          cn(
            'border-border size-7 rounded-full border p-0',
            color === preset && 'ring-primary ring-offset-background ring-2 ring-offset-2',
          )
        "
        :style="{ backgroundColor: preset }"
        :aria-label="$t('common.logo.colorSwatchAriaLabel', { color: preset })"
        :aria-pressed="color === preset"
        data-test="logo-color-swatch"
        @click="color = preset"
      />

      <!-- Native color input for anything outside the presets, layered
           invisibly over a swatch that mirrors the current pick. -->
      <label
        :class="
          cn(
            'border-border relative flex size-7 cursor-pointer items-center justify-center rounded-full border',
            isCustomColor && 'ring-primary ring-offset-background ring-2 ring-offset-2',
          )
        "
        :style="customSwatchStyle"
      >
        <PipetteIcon class="size-3.5" />
        <input
          type="color"
          :value="color"
          class="absolute inset-0 size-full cursor-pointer opacity-0"
          :aria-label="$t('common.logo.customColorAriaLabel')"
          data-test="logo-color-custom"
          @input="handleCustomColor"
        />
      </label>
    </div>
  </div>
</template>
