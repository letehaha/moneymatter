<template>
  <div class="w-full">
    <FieldLabel :label="fieldLabel" only-template>
      <Popover v-model:open="isOpen">
        <PopoverTrigger
          :disabled="disabled"
          :class="
            cn(
              'border-input bg-input-background ring-offset-background focus-visible:ring-ring flex h-10 w-full items-center gap-2 overflow-hidden rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none md:h-9',
              disabled && 'cursor-not-allowed opacity-50',
              triggerClass,
            )
          "
        >
          <MultiSelectTriggerContent
            :active="active"
            :label="label"
            :selected-label="selectedLabel"
            :hide-clear-button="hideClearButton"
            @clear="emit('clear')"
          >
            <template v-if="$slots.leading" #leading>
              <slot name="leading" />
            </template>
          </MultiSelectTriggerContent>
        </PopoverTrigger>

        <PopoverContent
          :class="cn('w-(--reka-popover-trigger-width) min-w-72 rounded-md p-0', contentClass)"
          :side-offset="4"
          align="start"
        >
          <div v-if="searchable" class="flex items-center gap-2 p-2 pb-0">
            <div
              class="border-input bg-input-background flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm"
            >
              <SearchIcon class="text-muted-foreground size-4 shrink-0" />
              <input
                v-model="searchTerm"
                type="text"
                class="min-w-0 flex-1 bg-transparent outline-none"
                :placeholder="searchPlaceholder"
              />
            </div>
            <Button v-if="active" variant="ghost" size="sm" class="shrink-0" @click="emit('clear')">
              {{ $t('common.actions.clear') }}
            </Button>
          </div>

          <slot :search-term="searchTerm" :is-open="isOpen" />
        </PopoverContent>
      </Popover>
    </FieldLabel>
    <FieldError :error-message="errorMessage" />
  </div>
</template>

<script setup lang="ts">
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import MultiSelectTriggerContent from '@/components/fields/multi-select-trigger-content.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { cn } from '@/lib/utils';
import { SearchIcon } from '@lucide/vue';
import { watch } from 'vue';

/**
 * Popover shell shared by the multi-select filter fields (categories / payees /
 * accounts). It owns everything that reads identically across them — the trigger
 * chrome, the searchable dropdown header, open state, and clearing —
 * and leaves only the entity-specific list body to the default slot. Each host
 * still owns its own data source and selection logic; this component takes no
 * opinion on how the list renders or how items are picked.
 *
 * The `#default` slot receives `{ searchTerm, isOpen }` and renders the list body
 * (including its own scroll container and empty state). The `#leading` slot is
 * forwarded into the trigger for per-entity chrome (e.g. a payee brand logo).
 */
withDefaults(
  defineProps<{
    /** True when a narrowing selection is active (vs. the wide-open default). Drives
     * the trigger's clear-vs-chevron affordance and the header clear button. */
    active: boolean;
    /** Label shown at the wide-open default, e.g. "All accounts". */
    label: string;
    /** Label shown while a selection is active, e.g. "3 selected". */
    selectedLabel: string;
    /** Placeholder for the in-dropdown search input. */
    searchPlaceholder?: string;
    /** Render the search header. Defaults on; disable for lists with no search. */
    searchable?: boolean;
    /** Suppress the in-trigger clear button for hosts that render their own remove
     * control next to the trigger (e.g. the Records filter toolbar chips). */
    hideClearButton?: boolean;
    /** Extra classes merged onto the trigger so a host can reshape it (e.g. the
     * Pivot Report renders it as a compact rounded filter pill). */
    triggerClass?: string;
    /** Extra classes merged onto the dropdown content, mainly to size its width. */
    contentClass?: string;
    disabled?: boolean;
    /** Optional form-field label rendered above the trigger. */
    fieldLabel?: string;
    /** Optional validation error rendered below the trigger. */
    errorMessage?: string;
  }>(),
  {
    searchPlaceholder: undefined,
    searchable: true,
    hideClearButton: false,
    triggerClass: undefined,
    contentClass: undefined,
    disabled: false,
    fieldLabel: undefined,
    errorMessage: undefined,
  },
);

const emit = defineEmits<{ clear: [] }>();

const isOpen = defineModel<boolean>('open', { default: false });
const searchTerm = defineModel<string>('searchTerm', { default: '' });

// Reopen clean: drop the previous query when the panel closes.
watch(isOpen, (open) => {
  if (!open) searchTerm.value = '';
});
</script>
