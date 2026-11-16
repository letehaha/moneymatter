<script setup lang="ts">
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import { cn } from '@/lib/utils';
import { Loader2Icon } from '@lucide/vue';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui';
import { computed, ref, watch } from 'vue';

import FieldLabel from './components/field-label.vue';
import { filterAutocompleteSuggestions } from './utils/autocomplete-suggestions';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    suggestions: string[];
    label: string;
    placeholder: string;
    /** Shown when there are no suggestions at all */
    emptyText: string;
    /** Shown when suggestions exist but none match what was typed */
    noMatchText: string;
    loading?: boolean;
    disabled?: boolean;
    maxlength?: number;
    size?: ControlSize;
  }>(),
  {
    loading: false,
    disabled: false,
    maxlength: undefined,
    size: 'default',
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const isOpen = ref(false);
// Filters by what was typed since the list opened, so opening a filled field still shows every option.
const query = ref('');

watch(isOpen, (open) => {
  if (!open) query.value = '';
});

const items = computed(() => filterAutocompleteSuggestions({ suggestions: props.suggestions, query: query.value }));

const handleInput = (value: string) => {
  query.value = value;
  emit('update:modelValue', value);
};

const handlePick = (value: unknown) => {
  if (typeof value === 'string') emit('update:modelValue', value);
};
</script>

<template>
  <div>
    <FieldLabel :label="label">
      <ComboboxRoot
        v-model:open="isOpen"
        :model-value="modelValue"
        :disabled="disabled"
        :reset-search-term-on-blur="false"
        :reset-search-term-on-select="false"
        open-on-click
        ignore-filter
        @update:model-value="handlePick"
      >
        <ComboboxAnchor class="relative">
          <ComboboxInput
            :model-value="modelValue"
            :placeholder="placeholder"
            :maxlength="maxlength"
            :class="
              cn(
                'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
                controlHeight[size],
                loading && 'pr-9',
              )
            "
            @update:model-value="handleInput"
          />
          <Loader2Icon
            v-if="loading"
            class="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin"
          />
        </ComboboxAnchor>

        <ComboboxPortal>
          <ComboboxContent
            position="popper"
            :side-offset="4"
            class="bg-popover text-popover-foreground z-(--z-dialog) w-(--reka-combobox-trigger-width) overflow-hidden rounded-md border shadow-md"
          >
            <ComboboxViewport class="max-h-64 p-1">
              <template v-if="!items.length">
                <div v-if="loading" class="flex justify-center py-2">
                  <Loader2Icon class="text-muted-foreground size-4 animate-spin" />
                </div>
                <p v-else class="text-muted-foreground px-2 py-1.5 text-sm">
                  {{ suggestions.length ? noMatchText : emptyText }}
                </p>
              </template>
              <ComboboxItem
                v-for="item in items"
                :key="item"
                :value="item"
                class="data-highlighted:bg-hover data-highlighted:text-accent-foreground cursor-default truncate rounded-sm px-2 py-1.5 text-sm outline-none select-none"
              >
                {{ item }}
              </ComboboxItem>
            </ComboboxViewport>
          </ComboboxContent>
        </ComboboxPortal>
      </ComboboxRoot>
    </FieldLabel>
  </div>
</template>
