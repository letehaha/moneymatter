<template>
  <div class="color-select-field">
    <FieldLabel :label="label" only-template>
      <div :class="cn($slots['field-right'] && 'flex items-stretch')">
        <label
          :class="
            cn(
              'border-input bg-input-background ring-offset-background focus-within:ring-ring relative flex w-full cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-offset-2',
              controlHeight[size],
              $slots['field-right'] && 'min-w-0 flex-1 rounded-r-none border-r-0',
            )
          "
        >
          <div class="size-5 shrink-0 rounded-full border" :style="{ backgroundColor: modelValue }" />
          <span class="text-muted-foreground flex-1 truncate">
            {{ modelValue }}
          </span>
          <input
            type="color"
            :value="modelValue"
            class="absolute left-2 size-6 cursor-pointer opacity-0"
            @input="handleColorChange"
          />
        </label>

        <slot name="field-right" />
      </div>
    </FieldLabel>
  </div>
</template>

<script setup lang="ts">
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';

import FieldLabel from './components/field-label.vue';

withDefaults(
  defineProps<{
    label?: string;
    modelValue: string;
    size?: ControlSize;
  }>(),
  { label: undefined, size: 'default' },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const handleColorChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit('update:modelValue', target.value);
};
</script>
