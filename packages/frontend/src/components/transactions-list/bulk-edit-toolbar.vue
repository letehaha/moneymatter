<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { SelectedTotals } from '@/composable/transaction-selection';
import type { TransactionsSummaryResponse } from '@bt/shared/types';
import {
  GroupIcon,
  ListOrderedIcon,
  PencilIcon,
  PlusIcon,
  ListPlusIcon,
  ChevronDownIcon,
  Trash2Icon,
} from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SelectionTotals from './selection-totals.vue';

const { t } = useI18n();

const props = defineProps<{
  selectedCount: number;
  isLoading: boolean;
  isAllSelected: boolean;
  /** Selection contains bank-connected transactions, which the backend refuses to delete. */
  hasExternalSelected?: boolean;
  selectedTotals: SelectedTotals;
  /** Totals of the whole filtered set, shown while nothing is selected. */
  matchingSummary?: TransactionsSummaryResponse;
  /** The selection covers rows that are not loaded, so grouping, which needs their ids, is off. */
  isGroupingBlocked?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  edit: [];
  delete: [];
  'create-group': [];
  'add-to-group': [];
  'select-all': [checked: boolean];
}>();

const hasSelection = computed(() => props.selectedCount > 0);

const handleSelectAllClick = () => {
  emit('select-all', !props.isAllSelected);
};

const handleCreateGroup = () => {
  emit('create-group');
};

const handleAddToGroup = () => {
  emit('add-to-group');
};

const handleEdit = () => {
  emit('edit');
};
</script>

<template>
  <div
    class="bg-card/95 @container/bulk-toolbar sticky top-0 z-10 flex flex-wrap items-center justify-between gap-1 border-b px-3 py-3 backdrop-blur sm:gap-4"
  >
    <div class="flex flex-wrap items-center gap-x-1 gap-y-1.5 sm:gap-x-4">
      <!-- Select all / deselect all checkbox -->
      <div class="flex cursor-pointer items-center gap-2 whitespace-nowrap" @click="handleSelectAllClick">
        <Checkbox :model-value="isAllSelected" />
        <span class="text-sm">{{ t('transactions.bulkEdit.selectAll') }}</span>
      </div>

      <SelectionTotals v-if="hasSelection" :totals="selectedTotals" :selected-count="selectedCount" />
      <SelectionTotals
        v-else-if="matchingSummary"
        :totals="matchingSummary"
        :selected-count="matchingSummary.count"
        matching
      />
    </div>

    <!-- Mobile: compact dropdown with all actions -->
    <div class="sm:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" :disabled="!hasSelection || isLoading">
            <ListOrderedIcon class="mr-1.5 size-4" />
            <ChevronDownIcon class="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          <DropdownMenuItem @select="handleEdit">
            <PencilIcon class="mr-2 size-4" />
            {{ t('transactions.bulkEdit.editButton') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="selectedCount < 2 || isGroupingBlocked" @select="handleCreateGroup">
            <PlusIcon class="mr-2 size-4" />
            {{ t('transactions.transactionGroups.bulkActions.createNewGroup') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="isGroupingBlocked" @select="handleAddToGroup">
            <ListPlusIcon class="mr-2 size-4" />
            {{ t('transactions.transactionGroups.bulkActions.addToExistingGroup') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="hasExternalSelected" class="text-destructive-text" @select="emit('delete')">
            <Trash2Icon class="mr-2 size-4" />
            {{ t('transactions.bulkDelete.button') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Desktop: full action buttons -->
    <div class="hidden items-center justify-center gap-2 sm:flex">
      <Button variant="outline" size="sm" :disabled="!hasSelection || isLoading" @click="emit('edit')">
        <PencilIcon class="size-4" />
        {{ t('transactions.bulkEdit.editButton') }}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" :disabled="!hasSelection || isLoading || isGroupingBlocked">
            <GroupIcon class="size-4" />
            {{ t('transactions.transactionGroups.bulkActions.groupButton') }}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          <DropdownMenuItem :disabled="selectedCount < 2" @select="handleCreateGroup">
            <PlusIcon class="mr-2 size-4" />
            {{ t('transactions.transactionGroups.bulkActions.createNewGroup') }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="handleAddToGroup">
            <ListPlusIcon class="mr-2 size-4" />
            {{ t('transactions.transactionGroups.bulkActions.addToExistingGroup') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DesktopOnlyTooltip
        :content="
          hasExternalSelected ? t('transactions.bulkDelete.externalTooltip') : t('transactions.bulkDelete.button')
        "
      >
        <span class="inline-flex">
          <Button
            variant="soft-destructive"
            size="sm"
            :disabled="!hasSelection || isLoading || hasExternalSelected"
            @click="emit('delete')"
          >
            <Trash2Icon class="size-4" />
            {{ t('transactions.bulkDelete.button') }}
          </Button>
        </span>
      </DesktopOnlyTooltip>
    </div>
  </div>
</template>
