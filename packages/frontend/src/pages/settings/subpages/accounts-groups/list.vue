<script setup lang="ts">
import CreateAccountGroupDialog from '@/components/dialogs/account-groups/create-account-group-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useAccountGroupsQuery } from '@/composable/data-queries/account-groups';
import { LayersIcon, PlusIcon, RotateCwIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { buildAccountGroupList } from './build-account-group-list';
import GroupListRow from './group-list-row.vue';

const SKELETON_ROWS = 3;

const { data: accountGroups, isPending, isError, isFetching, refetch } = useAccountGroupsQuery();

const groupsList = computed(() => buildAccountGroupList({ groups: accountGroups.value ?? [] }));

// Single-open accordion: expanding a row collapses whichever other row was open.
const expandedGroupId = ref<string | null>(null);

const toggleExpanded = ({ id }: { id: string }) => {
  expandedGroupId.value = expandedGroupId.value === id ? null : id;
};
</script>

<template>
  <div>
    <div v-if="isPending" class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
      <div v-for="i in SKELETON_ROWS" :key="i" class="flex items-center gap-3 px-4 py-3">
        <div class="bg-muted size-9 shrink-0 animate-pulse rounded-lg" />
        <div class="flex-1 space-y-2">
          <div class="bg-muted h-4 w-40 animate-pulse rounded" />
          <div class="bg-muted h-3 w-20 animate-pulse rounded" />
        </div>
        <div class="bg-muted h-4 w-16 animate-pulse rounded" />
      </div>
    </div>

    <!-- Sits ahead of the empty state: without it a failed fetch renders "no groups yet"
    and invites the user to recreate groups they already have. -->
    <div v-else-if="isError" class="flex flex-col items-center gap-1 py-10 text-center">
      <TriangleAlertIcon class="text-destructive-text mb-1 size-8" aria-hidden="true" />
      <p class="text-sm font-medium">{{ $t('settings.accountGroups.loadError.title') }}</p>
      <p class="text-muted-foreground max-w-sm text-xs">{{ $t('settings.accountGroups.loadError.description') }}</p>

      <Button type="button" variant="outline" size="sm" class="mt-3" :disabled="isFetching" @click="refetch()">
        <RotateCwIcon class="size-4" />
        {{ $t('settings.accountGroups.loadError.retry') }}
      </Button>
    </div>

    <div
      v-else-if="groupsList.length"
      class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border"
    >
      <GroupListRow
        v-for="item in groupsList"
        :key="item.group.id"
        :item="item"
        :expanded-group-id="expandedGroupId"
        @toggle="(id) => toggleExpanded({ id })"
      />
    </div>

    <div v-else class="flex flex-col items-center gap-1 py-10 text-center">
      <LayersIcon class="text-muted-foreground/60 mb-1 size-8" aria-hidden="true" />
      <p class="text-sm font-medium">{{ $t('settings.accountGroups.empty.title') }}</p>
      <p class="text-muted-foreground max-w-sm text-xs">{{ $t('settings.accountGroups.empty.description') }}</p>

      <CreateAccountGroupDialog>
        <Button type="button" size="sm" class="mt-3">
          <PlusIcon class="size-4" />
          {{ $t('settings.accountGroups.page.addButton') }}
        </Button>
      </CreateAccountGroupDialog>
    </div>
  </div>
</template>
