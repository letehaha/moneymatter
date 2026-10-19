<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import Button from '@/components/lib/ui/button/Button.vue';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { ROUTES_NAMES } from '@/routes';
import { BUDGET_STATUSES, type BudgetModel } from '@bt/shared/types';
import { ArchiveIcon, ArchiveRestoreIcon, CopyIcon, EllipsisIcon, ExternalLinkIcon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import DeleteTrackerDialog from './delete-tracker-dialog.vue';
import { useTrackerActions } from './use-tracker-actions';

const props = defineProps<{ budget: BudgetModel }>();

const router = useRouter();
const { isOwner, canManage } = useBudgetAccess(() => props.budget);
const { toggleArchive, duplicate } = useTrackerActions();

const isDeleteOpen = ref(false);
const isArchived = computed(() => props.budget.status === BUDGET_STATUSES.archived);

const openDetails = () => {
  router.push({ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: props.budget.id } });
};
</script>

<template>
  <div class="flex justify-center">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground size-9 @2xl/trackers:size-7"
          :aria-label="$t('budgets.list.menu.moreActions')"
          @click.stop
        >
          <EllipsisIcon class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-44">
        <DropdownMenuItem @select="openDetails">
          <ExternalLinkIcon class="size-4" />
          {{ $t('budgets.list.menu.open') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="isOwner"
          :disabled="duplicate.isPending.value"
          @select="duplicate.mutate({ budgetId: budget.id })"
        >
          <CopyIcon class="size-4" />
          {{ $t('budgets.list.menu.duplicate') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="canManage" @select="toggleArchive({ budget })">
          <component :is="isArchived ? ArchiveRestoreIcon : ArchiveIcon" class="size-4" />
          {{ isArchived ? $t('budgets.list.unarchive') : $t('budgets.list.archive') }}
        </DropdownMenuItem>
        <template v-if="isOwner">
          <DropdownMenuSeparator />
          <DropdownMenuItem
            class="text-destructive-text hover:bg-destructive-text/10 focus:bg-destructive-text/10 focus:text-destructive-text"
            @select="isDeleteOpen = true"
          >
            <Trash2Icon class="size-4" />
            {{ $t('budgets.list.delete') }}
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <DeleteTrackerDialog v-model:open="isDeleteOpen" :budget-id="budget.id" />
  </div>
</template>
