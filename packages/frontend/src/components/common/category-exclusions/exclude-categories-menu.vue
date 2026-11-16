<template>
  <Popover v-model:open="isPopoverOpen">
    <PopoverTrigger as-child>
      <Button size="icon-sm" variant="ghost" :data-testid="`${testIdPrefix}-settings-btn`">
        <SettingsIcon class="text-muted-foreground size-4" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-72 overflow-hidden p-0" align="end">
      <header class="border-b px-3 py-2 text-sm font-medium">{{ $t('common.actions.settings') }}</header>
      <div class="flex flex-col p-2">
        <button
          type="button"
          class="hover:bg-hover flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors"
          :data-testid="`${testIdPrefix}-exclude-categories-btn`"
          @click="openDialog"
        >
          <CircleOffIcon class="text-muted-foreground size-4" />
          {{ $t('dialogs.categoryExclusions.menuItem') }}
        </button>
      </div>
      <template v-if="$slots.default">
        <Separator />
        <!-- Extra widget-specific rows rendered below the shared exclusions entry. -->
        <div class="flex flex-col p-2">
          <slot />
        </div>
      </template>
    </PopoverContent>
  </Popover>

  <ExcludeCategoriesDialog
    v-model:open="isDialogOpen"
    :excluded-category-ids="excludedCategoryIds"
    @save="emit('save', $event)"
  />
</template>

<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Separator } from '@/components/lib/ui/separator';
import { CircleOffIcon, SettingsIcon } from '@lucide/vue';
import { ref } from 'vue';

import ExcludeCategoriesDialog from './exclude-categories-dialog.vue';

defineProps<{
  excludedCategoryIds: string[];
  /** Namespaces the data-testid attributes so two widgets on one page stay addressable. */
  testIdPrefix: string;
}>();

const emit = defineEmits<{
  save: [payload: { categoryIds: string[] }];
}>();

const isPopoverOpen = ref(false);
const isDialogOpen = ref(false);

const openDialog = () => {
  isPopoverOpen.value = false;
  isDialogOpen.value = true;
};
</script>
