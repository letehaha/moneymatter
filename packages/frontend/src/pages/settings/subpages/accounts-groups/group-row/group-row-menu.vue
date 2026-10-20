<script setup lang="ts">
import type { AccountGroups } from '@/common/types/models';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Button } from '@/components/lib/ui/button';
import { goToConnectionDetails } from '@/routes/navigation';
import {
  EllipsisIcon,
  FolderInputIcon,
  FolderPlusIcon,
  ListPlusIcon,
  PencilIcon,
  Settings2Icon,
  Trash2Icon,
} from '@lucide/vue';
import { useRouter } from 'vue-router';

export type GroupRowAction = 'rename' | 'move' | 'subgroup' | 'add-accounts' | 'delete';

defineProps<{ group: AccountGroups; align: 'start' | 'end' }>();

const emit = defineEmits<{ action: [action: GroupRowAction] }>();

const router = useRouter();
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-7"
        :aria-label="$t('settings.accountGroups.tree.moreActions')"
        @click.stop
      >
        <EllipsisIcon class="size-4" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent :align="align" class="min-w-52">
      <DropdownMenuItem @select="emit('action', 'rename')">
        <PencilIcon class="size-4" />
        {{ $t('settings.accountGroups.tree.menu.rename') }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="emit('action', 'move')">
        <FolderInputIcon class="size-4" />
        {{ $t('settings.accountGroups.tree.menu.move') }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="emit('action', 'subgroup')">
        <FolderPlusIcon class="size-4" />
        {{ $t('settings.accountGroups.tree.menu.newSubgroup') }}
      </DropdownMenuItem>
      <DropdownMenuItem @select="emit('action', 'add-accounts')">
        <ListPlusIcon class="size-4" />
        {{ $t('settings.accountGroups.tree.menu.addAccounts') }}
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="group.bankDataProviderConnectionId"
        @select="
          goToConnectionDetails({
            router,
            connectionId: group.bankDataProviderConnectionId,
          })
        "
      >
        <Settings2Icon class="size-4" />
        {{ $t('settings.accountGroups.row.manageConnection') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        class="text-destructive-text hover:bg-destructive-text/10 focus:bg-destructive-text/10 focus:text-destructive-text"
        @select="emit('action', 'delete')"
      >
        <Trash2Icon class="size-4" />
        {{ $t('settings.accountGroups.tree.menu.delete') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
