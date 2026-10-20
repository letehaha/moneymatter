<script setup lang="ts">
import { updateAccountGroup } from '@/api/account-groups';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { AccountGroups } from '@/common/types/models';
import CreateAccountGroupDialog from '@/components/dialogs/account-groups/create-account-group-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import { useAccountGroupsQuery } from '@/composable/data-queries/account-groups';
import { extractApiErrorMessage } from '@/js/errors';
import { cn } from '@/lib/utils';
import {
  ChevronDownIcon,
  GripVerticalIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from '@lucide/vue';
import { useQueryClient } from '@tanstack/vue-query';
import { useMediaQuery } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  type PendingGroupMove,
  applyPendingMoves,
  netMoves,
  replayMoves,
  sanitizeMoves,
} from './apply-pending-group-moves';
import { buildAccountGroupList, flattenGroups, listTreeRows } from './build-account-group-list';
import { type GroupDropError, groupDropError } from './can-drop-group';
import AddAccountsDialog from './dialogs/add-accounts-dialog.vue';
import DeleteGroupDialog from './dialogs/delete-group-dialog.vue';
import MoveGroupDialog from './dialogs/move-group-dialog.vue';
import RenameGroupDialog from './dialogs/rename-group-dialog.vue';
import GroupListRow from './group-list-row.vue';
import type { GroupRowAction } from './group-row/group-row-menu.vue';
import GroupAccountRow from './group-row/group-account-row.vue';

const SKELETON_ROWS = 4;

const { t } = useI18n();
const queryClient = useQueryClient();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();

const { data: accountGroups, isPending, isError, isFetching, refetch } = useAccountGroupsQuery();

const groups = computed(() => accountGroups.value ?? []);
const groupById = computed(() => new Map(flattenGroups({ groups: groups.value }).map((group) => [group.id, group])));

const pendingMoves = ref<PendingGroupMove[]>([]);
const previewGroups = computed(() => applyPendingMoves({ groups: groups.value, moves: pendingMoves.value }));
const groupsList = computed(() => buildAccountGroupList({ groups: previewGroups.value }));

const isOrganizing = ref(false);
// Native HTML5 drag never fires from touch input, so coarse-pointer devices skip Organize mode.
const isTouchPointer = useMediaQuery('(pointer: coarse)');

const expandedIds = ref(new Set<string>());

const toggleExpanded = ({ id }: { id: string }) => {
  if (!expandedIds.value.delete(id)) expandedIds.value.add(id);
};

const rows = computed(() =>
  listTreeRows({
    items: groupsList.value,
    isExpanded: ({ id }) => isOrganizing.value || expandedIds.value.has(id),
    includeAccounts: !isOrganizing.value,
  }),
);

const dialog = reactive<{
  action: GroupRowAction | null;
  groupId: string | null;
}>({ action: null, groupId: null });
const dialogGroup = computed(() => (dialog.groupId ? groupById.value.get(dialog.groupId) : undefined));

const openDialog = ({ action, group }: { action: GroupRowAction; group: AccountGroups }) => {
  dialog.groupId = group.id;
  dialog.action = action;
};

const closeDialog = ({ open }: { open: boolean }) => {
  if (!open) dialog.action = null;
};

const queuedMoves = computed(() =>
  netMoves({ moves: pendingMoves.value, groups: groups.value }).map((move) => ({
    ...move,
    name: groupById.value.get(move.groupId)?.name ?? '',
    destinationName: move.parentGroupId
      ? (groupById.value.get(move.parentGroupId)?.name ?? '')
      : t('settings.accountGroups.organize.topLevel'),
  })),
);
const movedIds = computed(() => new Set(queuedMoves.value.map((move) => move.groupId)));
const queuePopoverOpen = ref(false);
const isSavingMoves = ref(false);

// A refetch can delete a queued group or its target, or re-parent something under it.
// Skipped while saving: the queue is replaced with the unsaved remainder once the refetch lands.
watch(groups, () => {
  if (!pendingMoves.value.length || isSavingMoves.value) return;

  const sanitized = sanitizeMoves({ groups: groups.value, moves: pendingMoves.value });
  const dropped = pendingMoves.value.length - sanitized.length;
  if (dropped > 0) {
    addErrorNotification(t('settings.accountGroups.organize.staleMovesRemoved', dropped));
  }
  pendingMoves.value = sanitized;
  if (!sanitized.length) queuePopoverOpen.value = false;
});

const cancelOrganizing = () => {
  pendingMoves.value = [];
  queuePopoverOpen.value = false;
  isOrganizing.value = false;
};

const draggedGroup = ref<AccountGroups | null>(null);
const dragOverId = ref<string | null>(null);
const dragHoverError = ref<string | null>(null);
const isTopLevelZoneActive = ref(false);

const DROP_ERROR_MESSAGE_KEYS: Record<GroupDropError, string | null> = {
  self: null,
  'current-parent': 'settings.accountGroups.organize.dropErrors.currentParent',
  'inside-itself': 'settings.accountGroups.organize.dropErrors.insideItself',
  'already-top-level': null,
};

const rowDropError = ({ group }: { group: AccountGroups }) =>
  draggedGroup.value ? groupDropError({ dragged: draggedGroup.value, target: group }) : null;

const canDropOnTopLevel = computed(
  () => !!draggedGroup.value && groupDropError({ dragged: draggedGroup.value, target: null }) === null,
);

const handleDragStart = ({ group, event }: { group: AccountGroups; event: DragEvent }) => {
  if (isSavingMoves.value) {
    event.preventDefault();
    return;
  }
  if (event.dataTransfer) {
    event.dataTransfer.setData('text/plain', group.id);
    event.dataTransfer.effectAllowed = 'move';
  }
  // Deferred: Chromium cancels a drag whose source re-renders while dragstart is still being processed.
  window.setTimeout(() => {
    draggedGroup.value = group;
  });
};

const handleDragEnd = () => {
  draggedGroup.value = null;
  dragOverId.value = null;
  dragHoverError.value = null;
  isTopLevelZoneActive.value = false;
};

const handleRowDragOver = ({ group, event }: { group: AccountGroups; event: DragEvent }) => {
  if (!draggedGroup.value) return;

  const reason = rowDropError({ group });
  if (reason === null) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverId.value = group.id;
    dragHoverError.value = null;
    return;
  }

  dragOverId.value = null;
  const key = DROP_ERROR_MESSAGE_KEYS[reason];
  dragHoverError.value = key ? t(key) : null;
};

const handleRowDragLeave = ({ group, event }: { group: AccountGroups; event: DragEvent }) => {
  const nextTarget = event.relatedTarget as Node | null;
  if (nextTarget && (event.currentTarget as HTMLElement).contains(nextTarget)) return;

  if (dragOverId.value === group.id) dragOverId.value = null;
  dragHoverError.value = null;
};

const handleTopLevelDragOver = ({ event }: { event: DragEvent }) => {
  if (!canDropOnTopLevel.value) return;

  event.preventDefault();
  isTopLevelZoneActive.value = true;
};

const queueMove = ({ parentGroupId }: { parentGroupId: string | null }) => {
  const dragged = draggedGroup.value;
  handleDragEnd();
  if (dragged && !isSavingMoves.value) pendingMoves.value.push({ groupId: dragged.id, parentGroupId });
};

const handleRowDrop = ({ group }: { group: AccountGroups }) => {
  if (draggedGroup.value && rowDropError({ group }) === null) queueMove({ parentGroupId: group.id });
  else handleDragEnd();
};

const handleDropOnTopLevel = () => {
  if (canDropOnTopLevel.value) queueMove({ parentGroupId: null });
};

const savePendingMoves = async () => {
  if (!queuedMoves.value.length || isSavingMoves.value) return;

  isSavingMoves.value = true;

  try {
    const { remaining, lastError } = await replayMoves({
      moves: netMoves({ moves: pendingMoves.value, groups: groups.value }),
      apply: ({ move }) =>
        updateAccountGroup({
          groupId: move.groupId,
          updates: { parentGroupId: move.parentGroupId },
        }),
    });

    try {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: VUE_QUERY_CACHE_KEYS.accountGroups,
        }),
        queryClient.invalidateQueries({
          queryKey: VUE_QUERY_CACHE_KEYS.accountGroupForAccount,
        }),
      ]);
    } finally {
      pendingMoves.value = remaining;

      if (remaining.length) {
        addErrorNotification(
          extractApiErrorMessage(lastError) ||
            t('settings.accountGroups.organize.saveFailed', { count: remaining.length }, remaining.length),
        );
      } else {
        addSuccessNotification(t('settings.accountGroups.organize.saveSuccess'));
        queuePopoverOpen.value = false;
        isOrganizing.value = false;
      }
    }
  } finally {
    isSavingMoves.value = false;
  }
};
</script>

<template>
  <div>
    <div v-if="isPending" class="border-border/60 bg-card overflow-hidden rounded-xl border py-1">
      <div v-for="i in SKELETON_ROWS" :key="i" class="flex h-10 items-center gap-2 px-3">
        <div class="bg-muted size-4 shrink-0 animate-pulse rounded" />
        <div class="bg-muted size-5 shrink-0 animate-pulse rounded-md" />
        <div class="bg-muted h-4 w-40 animate-pulse rounded" />
        <div class="bg-muted ml-auto h-4 w-20 animate-pulse rounded" />
      </div>
    </div>

    <!-- Sits ahead of the empty state: without it a failed fetch renders "no groups yet"
    and invites the user to recreate groups they already have. -->
    <div v-else-if="isError" class="flex flex-col items-center gap-1 py-10 text-center">
      <TriangleAlertIcon class="text-destructive-text mb-1 size-8" aria-hidden="true" />
      <p class="text-sm font-medium">
        {{ $t('settings.accountGroups.loadError.title') }}
      </p>
      <p class="text-muted-foreground max-w-sm text-xs">
        {{ $t('settings.accountGroups.loadError.description') }}
      </p>

      <Button type="button" variant="outline" size="sm" class="mt-3" :disabled="isFetching" @click="refetch()">
        <RotateCwIcon class="size-4" />
        {{ $t('settings.accountGroups.loadError.retry') }}
      </Button>
    </div>

    <template v-else-if="groupsList.length">
      <!-- Sticky while organizing so it stays reachable as a drop zone. A single non-wrapping
      row with truncating text: its height must not change mid-drag or the tree shifts. -->
      <div
        :class="
          cn(
            'mb-3 flex min-h-12 items-center gap-3 transition-colors',
            isOrganizing && 'bg-card sticky top-0 z-10 rounded-md border px-3 py-2',
            canDropOnTopLevel && 'border-primary bg-primary/10 border-dashed',
            isTopLevelZoneActive && 'ring-primary ring-2 ring-inset',
          )
        "
        @dragover="handleTopLevelDragOver({ event: $event })"
        @dragleave="isTopLevelZoneActive = false"
        @drop.prevent="handleDropOnTopLevel"
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <template v-if="draggedGroup">
            <span v-if="dragHoverError" class="text-warning-text truncate text-sm">{{ dragHoverError }}</span>
            <span v-else-if="canDropOnTopLevel" class="text-primary-text truncate text-sm">
              {{
                $t('settings.accountGroups.organize.dropToTopLevel', {
                  name: draggedGroup.name,
                })
              }}
            </span>
            <span v-else class="text-muted-foreground truncate text-sm">
              {{ $t('settings.accountGroups.organize.dropErrors.alreadyTopLevel') }}
            </span>
          </template>

          <template v-else-if="isOrganizing">
            <Popover v-if="queuedMoves.length" v-model:open="queuePopoverOpen">
              <PopoverTrigger as-child>
                <Button variant="soft-primary" size="sm" class="shrink-0">
                  {{
                    $t('settings.accountGroups.organize.movesCount', { count: queuedMoves.length }, queuedMoves.length)
                  }}
                  <ChevronDownIcon class="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-80 p-1">
                <ScrollArea class="max-h-64" viewport-class="max-h-64">
                  <div
                    v-for="move in queuedMoves"
                    :key="move.groupId"
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  >
                    <span class="truncate">{{ move.name }}</span>
                    <span class="text-muted-foreground truncate">→ {{ move.destinationName }}</span>
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <span v-else class="text-muted-foreground truncate text-sm">
              {{ $t('settings.accountGroups.organize.hint') }}
            </span>
          </template>

          <span v-else class="text-muted-foreground truncate text-sm">
            {{ $t('settings.accountGroups.tree.groupsCount', { count: groupById.size }, groupById.size) }}
          </span>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <template v-if="isOrganizing">
            <Button variant="ghost" size="sm" :disabled="isSavingMoves" @click="cancelOrganizing">
              {{ $t('common.actions.cancel') }}
            </Button>
            <Button size="sm" :disabled="!queuedMoves.length || isSavingMoves" @click="savePendingMoves">
              <LoaderCircleIcon v-if="isSavingMoves" class="size-4 animate-spin" />
              {{ $t('settings.accountGroups.organize.save') }}
            </Button>
          </template>
          <Button v-else-if="!isTouchPointer" variant="outline" size="sm" @click="isOrganizing = true">
            <GripVerticalIcon class="size-4" />
            {{ $t('settings.accountGroups.organize.button') }}
          </Button>
        </div>
      </div>

      <div class="border-border/60 bg-card overflow-hidden rounded-xl border py-1">
        <template
          v-for="row in rows"
          :key="row.type === 'group' ? row.item.group.id : `${row.groupId}:${row.account.id}`"
        >
          <GroupListRow
            v-if="row.type === 'group'"
            :item="row.item"
            :depth="row.depth"
            :expanded="isOrganizing || expandedIds.has(row.item.group.id)"
            :organizing="isOrganizing"
            :touch="isTouchPointer"
            :drag-disabled="isSavingMoves"
            :moved="movedIds.has(row.item.group.id)"
            :dimmed="!!draggedGroup && rowDropError({ group: row.item.group }) !== null"
            :drop-target="!!draggedGroup && dragOverId === row.item.group.id"
            @toggle="toggleExpanded({ id: row.item.group.id })"
            @action="(action) => openDialog({ action, group: row.item.group })"
            @dragstart="handleDragStart({ group: row.item.group, event: $event })"
            @dragend="handleDragEnd"
            @dragover="handleRowDragOver({ group: row.item.group, event: $event })"
            @dragleave="handleRowDragLeave({ group: row.item.group, event: $event })"
            @drop.prevent="handleRowDrop({ group: row.item.group })"
          />
          <GroupAccountRow
            v-else
            :account="row.account"
            :group-id="row.groupId"
            :depth="row.depth"
            :touch="isTouchPointer"
          />
        </template>
      </div>
    </template>

    <div v-else class="flex flex-col items-center gap-1 py-10 text-center">
      <LayersIcon class="text-muted-foreground/60 mb-1 size-8" aria-hidden="true" />
      <p class="text-sm font-medium">
        {{ $t('settings.accountGroups.empty.title') }}
      </p>
      <p class="text-muted-foreground max-w-sm text-xs">
        {{ $t('settings.accountGroups.empty.description') }}
      </p>

      <CreateAccountGroupDialog>
        <Button type="button" size="sm" class="mt-3">
          <PlusIcon class="size-4" />
          {{ $t('settings.accountGroups.page.addButton') }}
        </Button>
      </CreateAccountGroupDialog>
    </div>

    <template v-if="dialogGroup">
      <RenameGroupDialog
        :open="dialog.action === 'rename'"
        :group="dialogGroup"
        @update:open="(open) => closeDialog({ open })"
      />
      <MoveGroupDialog
        :open="dialog.action === 'move'"
        :group="dialogGroup"
        @update:open="(open) => closeDialog({ open })"
      />
      <AddAccountsDialog
        :open="dialog.action === 'add-accounts'"
        :group="dialogGroup"
        @update:open="(open) => closeDialog({ open })"
      />
      <DeleteGroupDialog
        :open="dialog.action === 'delete'"
        :group="dialogGroup"
        @update:open="(open) => closeDialog({ open })"
      />
      <CreateAccountGroupDialog
        :open="dialog.action === 'subgroup'"
        :parent-group="dialogGroup"
        @update:open="(open) => closeDialog({ open })"
      />
    </template>
  </div>
</template>
