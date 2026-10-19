<script setup lang="ts">
import BrandLogo from '@/components/common/brand-logo.vue';
import { type LogoSelection, type LogoTab, toLogoDisplayProps } from '@/components/common/logo-selection';
import LogoSearch from '@/components/common/logo-search.vue';
import { Button } from '@/components/lib/ui/button';
import * as Popover from '@/components/lib/ui/popover';
import { cn } from '@/lib/utils';
import { ChevronDownIcon, XIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Chosen logo. null = let the backend auto-resolve from the name. */
  modelValue: LogoSelection | null;
  /** Entity name – drives the monogram preview and seeds the search query. */
  nameForSearch: string;
  disabled?: boolean;
  tabs?: LogoTab[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: LogoSelection | null): void;
}>();

const { t } = useI18n({ useScope: 'global' });

const isOpen = ref(false);

const logoDisplay = computed(() => toLogoDisplayProps({ selection: props.modelValue }));

const triggerLabel = computed(() => {
  const selection = props.modelValue;
  if (!selection) return t('common.logo.autoLabel');
  if (selection.kind === 'brand') return selection.domain;
  if (selection.kind === 'monogram') return t('common.logo.lettersSelectedLabel', { letters: selection.initials });
  return selection.kind === 'icon' ? t('common.logo.tabs.icon') : t('common.logo.tabs.custom');
});

function handleSelect(selection: LogoSelection) {
  emit('update:modelValue', selection);
  isOpen.value = false;
}

function clearSelection() {
  emit('update:modelValue', null);
}
</script>

<template>
  <Popover.Popover :open="isOpen" @update:open="(open: boolean) => (isOpen = open)">
    <Popover.PopoverTrigger as-child>
      <Button
        variant="outline"
        :disabled="disabled"
        :class="cn('border-input bg-input-background h-10 w-full justify-start gap-2 px-3 py-2 text-sm font-normal')"
        data-test="logo-field"
      >
        <BrandLogo v-bind="logoDisplay" :name="nameForSearch" class="size-6" />
        <span
          class="min-w-0 flex-1 truncate text-left"
          :class="modelValue ? 'text-foreground' : 'text-muted-foreground'"
        >
          {{ triggerLabel }}
        </span>
        <Button
          v-if="modelValue && !disabled"
          as="span"
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground hover:text-foreground shrink-0"
          :aria-label="t('common.actions.clear')"
          @click.stop="clearSelection"
        >
          <XIcon class="size-4" />
        </Button>
        <ChevronDownIcon class="text-muted-foreground size-4 shrink-0 opacity-70" />
      </Button>
    </Popover.PopoverTrigger>

    <Popover.PopoverContent class="w-(--reka-popover-trigger-width) p-0" align="start" :side-offset="4">
      <LogoSearch :selection="modelValue" :name-for-search="nameForSearch" :tabs="tabs" @select="handleSelect" />
    </Popover.PopoverContent>
  </Popover.Popover>
</template>
