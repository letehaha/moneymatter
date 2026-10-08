<script setup lang="ts">
import AlertDialog from '@/components/common/alert-dialog.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import Button from '@/components/lib/ui/button/Button.vue';
import { ArchiveIcon, ArchiveRestoreIcon, MoreVerticalIcon, PencilIcon, Trash2Icon } from '@lucide/vue';

defineProps<{
  budgetId: string;
  isArchived?: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
  archive: [];
}>();
</script>

<template>
  <div class="absolute top-0 right-0 z-10">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="size-8" @click.stop>
          <MoreVerticalIcon class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem @click.stop="emit('edit')">
          <PencilIcon class="mr-2 size-4" />
          {{ $t('budgets.list.edit') }}
        </DropdownMenuItem>
        <DropdownMenuItem @click.stop="emit('archive')">
          <component :is="isArchived ? ArchiveRestoreIcon : ArchiveIcon" class="mr-2 size-4" />
          {{ isArchived ? $t('budgets.list.unarchive') : $t('budgets.list.archive') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <AlertDialog
          :title="$t('budgets.list.deleteDialog.title')"
          accept-variant="destructive"
          @accept="emit('delete')"
        >
          <template #description>
            {{ $t('budgets.list.deleteDialog.description') }}
          </template>
          <template #trigger>
            <DropdownMenuItem
              class="text-destructive-text focus:bg-destructive-text/10 focus:text-destructive-text"
              @select.prevent
              @click.stop
            >
              <Trash2Icon class="mr-2 size-4" />
              {{ $t('budgets.list.delete') }}
            </DropdownMenuItem>
          </template>
        </AlertDialog>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
