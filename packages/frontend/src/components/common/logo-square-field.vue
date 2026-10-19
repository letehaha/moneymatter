<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { type LogoSelection, type LogoTab, toLogoDisplayProps } from '@/components/common/logo-selection';
import LogoSearch from '@/components/common/logo-search.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import { PencilIcon, RotateCcwIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

const props = defineProps<{
  /** Chosen logo. null = nothing chosen; the fallback depends on the entity. */
  modelValue: LogoSelection | null;
  /** Entity name – drives the monogram preview and seeds the search query. */
  nameForSearch: string;
  disabled?: boolean;
  /** Visual size class applied to the square (Tailwind size-* utility). */
  sizeClass?: string;
  /** Clear-button label. The default wording is only accurate for entities with auto-resolution. */
  resetLabel?: string;
  /** 'with-labeled-field' pushes the square down past a sibling field's caption so both line up on the input row. */
  align?: 'default' | 'with-labeled-field';
  tabs?: LogoTab[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: LogoSelection | null): void;
}>();

/** Empty-state tile for entities that never render BrandLogo's first-letter monogram. */
defineSlots<{ placeholder?: () => unknown }>();

/** Height of a FieldLabel caption: a 16px line box plus its 5px bottom margin. */
const LABELED_FIELD_OFFSET = 'mt-[21px]';

const isOpen = ref(false);

const logoDisplay = computed(() => toLogoDisplayProps({ selection: props.modelValue }));

function handleSelect(selection: LogoSelection) {
  emit('update:modelValue', selection);
  isOpen.value = false;
}

function handleReset() {
  emit('update:modelValue', null);
  isOpen.value = false;
}
</script>

<template>
  <div :class="cn('group relative shrink-0', align === 'with-labeled-field' && LABELED_FIELD_OFFSET)">
    <slot v-if="!modelValue && $slots.placeholder" name="placeholder" />
    <BrandLogo v-else v-bind="logoDisplay" :name="nameForSearch" :class="cn('size-10 text-base', sizeClass)" />
    <Button
      type="button"
      variant="ghost"
      size="icon"
      :disabled="disabled"
      :class="
        cn(
          'bg-background/80 hover:bg-background absolute inset-0 size-full rounded-[inherit] opacity-0 backdrop-blur-sm transition-opacity',
          !disabled && 'group-focus-within:opacity-100 group-hover:opacity-100',
        )
      "
      :aria-label="$t('common.logo.editAriaLabel')"
      data-test="logo-square-field"
      @click="isOpen = true"
    >
      <PencilIcon class="size-4" />
    </Button>

    <ResponsiveDialog v-model:open="isOpen">
      <template #title>{{ $t('common.logo.dialogTitle') }}</template>
      <template #description>{{ $t('common.logo.domainHint') }}</template>

      <template #default>
        <div class="flex flex-col gap-4">
          <div class="border-input min-h-86 flex-1 overflow-hidden rounded-md border">
            <LogoSearch :selection="modelValue" :name-for-search="nameForSearch" :tabs="tabs" @select="handleSelect" />
          </div>

          <div class="flex items-center justify-between gap-2 border-t pt-2">
            <Button variant="ghost" size="sm" :disabled="!modelValue" @click="handleReset">
              <RotateCcwIcon class="size-4" />
              {{ resetLabel ?? $t('common.logo.resetToAuto') }}
            </Button>
            <Button variant="ghost" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
          </div>
        </div>
      </template>
    </ResponsiveDialog>
  </div>
</template>
