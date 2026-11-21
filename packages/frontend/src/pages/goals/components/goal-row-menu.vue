<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import Button from '@/components/lib/ui/button/Button.vue';
import { useUpdateGoal } from '@/composable/data-queries/goals';
import type { GoalModel, GoalStatus } from '@bt/shared/types';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EllipsisIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from '@lucide/vue';
import { computed, ref } from 'vue';

import { getGoalDisplayKind } from '../helpers';
import DeleteGoalDialog from './delete-goal-dialog.vue';

/** `header` leaves out what the detail page shows as its own button (Edit, or Unarchive when archived) and Pause once reached. */
const props = withDefaults(defineProps<{ goal: GoalModel; variant?: 'row' | 'header' }>(), { variant: 'row' });
const emit = defineEmits<{ edit: []; deleted: [] }>();

const update = useUpdateGoal();
const isDeleteOpen = ref(false);

const isHeader = computed(() => props.variant === 'header');
const isArchived = computed(() => props.goal.status === 'archived');
const isPaused = computed(() => props.goal.status === 'paused');
const isReached = computed(() => getGoalDisplayKind({ goal: props.goal }) === 'reached');

const showEdit = computed(() => !isHeader.value || isArchived.value || isReached.value);
const showPause = computed(() => !isArchived.value && !(isHeader.value && isReached.value));
const showArchiveToggle = computed(() => !(isHeader.value && isArchived.value));

const setStatus = ({ status }: { status: GoalStatus }) => update.mutate({ goalId: props.goal.id, payload: { status } });
</script>

<template>
  <div class="flex justify-center">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button v-if="isHeader" variant="ghost" size="icon-sm" :aria-label="$t('goals.details.actions.more')">
          <EllipsisIcon class="size-4" />
        </Button>
        <Button
          v-else
          variant="ghost"
          size="icon-sm"
          class="text-muted-foreground size-9 @2xl/goals:size-7"
          :aria-label="$t('goals.list.menu.moreActions', { name: goal.name })"
          @click.stop
        >
          <EllipsisIcon class="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="min-w-44">
        <DropdownMenuItem v-if="showEdit" @select="emit('edit')">
          <PencilIcon class="size-4" />
          {{ $t('goals.actions.edit') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="showPause"
          :disabled="update.isPending.value"
          @select="setStatus({ status: isPaused ? 'active' : 'paused' })"
        >
          <component :is="isPaused ? PlayIcon : PauseIcon" class="size-4" />
          {{ isPaused ? $t('goals.actions.resume') : $t('goals.actions.pause') }}
        </DropdownMenuItem>
        <DropdownMenuItem
          v-if="showArchiveToggle"
          :disabled="update.isPending.value"
          @select="setStatus({ status: isArchived ? 'active' : 'archived' })"
        >
          <component :is="isArchived ? ArchiveRestoreIcon : ArchiveIcon" class="size-4" />
          {{ isArchived ? $t('goals.actions.unarchive') : $t('goals.actions.archive') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          class="text-destructive-text hover:bg-destructive-text/10 focus:bg-destructive-text/10 focus:text-destructive-text"
          @select="isDeleteOpen = true"
        >
          <Trash2Icon class="size-4" />
          {{ $t('goals.actions.delete') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <DeleteGoalDialog v-model:open="isDeleteOpen" :goal-id="goal.id" @deleted="emit('deleted')" />
  </div>
</template>
