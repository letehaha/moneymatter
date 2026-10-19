<template>
  <div class="flex items-center justify-end">
    <ResponsiveDialog :open="open" @update:open="$emit('update:open', $event)">
      <template #trigger>
        <UiButton variant="secondary" :size="size">
          {{ t('transactions.filters.filtersLabel') }}

          <div class="relative">
            <ListFilterIcon class="size-4" />

            <template v-if="isAnyFiltersApplied">
              <div class="bg-primary absolute -top-1 -right-1 size-2.5 rounded-full" />
            </template>
          </div>
        </UiButton>
      </template>

      <template #title>{{ t('transactions.filters.selectFilters') }}</template>

      <slot />
    </ResponsiveDialog>
  </div>
</template>

<script lang="ts" setup>
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import type { ButtonVariantProps } from '@/components/lib/ui/button';
import { ListFilterIcon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

withDefaults(defineProps<{ open: boolean; isAnyFiltersApplied: boolean; size?: ButtonVariantProps['size'] }>(), {
  size: 'default',
});

defineEmits(['update:open']);
</script>
