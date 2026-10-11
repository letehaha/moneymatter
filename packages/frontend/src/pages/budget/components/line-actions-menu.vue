<script setup lang="ts">
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ArchiveIcon, EllipsisIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { ref } from 'vue';

type LineAction = 'edit' | 'archive' | 'delete';

const emit = defineEmits<{ pick: [action: LineAction] }>();

const isOpen = ref(false);

const pick = ({ action }: { action: LineAction }) => {
  isOpen.value = false;
  emit('pick', action);
};
</script>

<template>
  <DesktopOnlyTooltip :content="$t('budgetPlans.grid.lineActions')">
    <span class="inline-flex">
      <ResponsiveMenu v-model:open="isOpen">
        <template #trigger>
          <Button variant="ghost" size="icon-sm" :aria-label="$t('budgetPlans.grid.lineActions')">
            <EllipsisIcon class="size-4" />
          </Button>
        </template>

        <Button variant="ghost" size="sm" class="w-full justify-start" @click="pick({ action: 'edit' })">
          <PencilIcon class="size-4" />
          {{ $t('budgetPlans.grid.editLine') }}
        </Button>
        <Button variant="ghost" size="sm" class="w-full justify-start" @click="pick({ action: 'archive' })">
          <ArchiveIcon class="size-4" />
          {{ $t('budgetPlans.grid.archiveLine') }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="text-destructive-text hover:text-destructive-text w-full justify-start"
          @click="pick({ action: 'delete' })"
        >
          <Trash2Icon class="size-4" />
          {{ $t('budgetPlans.grid.deleteLine') }}
        </Button>
      </ResponsiveMenu>
    </span>
  </DesktopOnlyTooltip>
</template>
