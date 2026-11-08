<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { useUserStore } from '@/stores';
import { TRANSACTION_TRASH_RETENTION_DAYS, type RecordId, type TrashEntry } from '@bt/shared/types';
import { ClockIcon, Trash2Icon } from '@lucide/vue';
import { useElementSize, useNow } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';

import TrashEntryDetails from './components/trash-entry-details.vue';
import TrashRow from './components/trash-row.vue';
import { getExpiringSummary, getTrashDaysLeft } from './helpers';
import { useTransactionsTrash, useTrashActions, useTrashEntryDisplay } from './use-transactions-trash';

const SKELETON_ROW_COUNT = 5;
/** Below this content width the list and the detail panel no longer fit side by side. */
const SPLIT_LAYOUT_MIN_WIDTH = 740;
const NOW_REFRESH_MS = 60 * 60 * 1000;

const { isDemo } = storeToRefs(useUserStore());
const { data: entries, isFetched, isError, refetch } = useTransactionsTrash();
const { restore, remove } = useTrashActions();
const describeEntry = useTrashEntryDisplay();
const now = useNow({ interval: NOW_REFRESH_MS });

const rootRef = ref<HTMLElement | null>(null);
const { width } = useElementSize(rootRef);
const isSplitLayout = computed(() => width.value >= SPLIT_LAYOUT_MIN_WIDTH);

const rows = computed(() =>
  (entries.value ?? []).map((entry) => ({
    entry,
    display: describeEntry({ entry }),
    daysLeft: getTrashDaysLeft({ expiresAt: entry.expiresAt, now: now.value }),
  })),
);
const expiring = computed(() => getExpiringSummary({ entries: entries.value ?? [], now: now.value }));

const selectedId = ref<RecordId | null>(null);
const isSheetOpen = ref(false);
const selectedRow = computed(
  () =>
    rows.value.find((row) => row.entry.id === selectedId.value) ?? (isSplitLayout.value ? rows.value[0] : undefined),
);

watch(selectedRow, (row) => {
  if (!row) isSheetOpen.value = false;
});
watch(isSplitLayout, (isSplit) => {
  if (isSplit) isSheetOpen.value = false;
});

const selectEntry = ({ entry }: { entry: TrashEntry }) => {
  selectedId.value = entry.id;
  if (!isSplitLayout.value) isSheetOpen.value = true;
};

const isDeleteConfirmOpen = ref(false);

const restoreSelected = () => {
  if (!selectedRow.value) return;
  restore.mutate({ transactionIds: [selectedRow.value.entry.id] });
};

const deleteSelected = () => {
  if (!selectedRow.value) return;
  remove.mutate(
    { transactionIds: [selectedRow.value.entry.id] },
    { onSuccess: () => (isDeleteConfirmOpen.value = false) },
  );
};
</script>

<template>
  <div ref="rootRef" class="@container/trash flex max-w-275 flex-col gap-5 p-4">
    <div class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold tracking-tight">{{ $t('transactions.trashPage.title') }}</h1>
      <p class="text-muted-foreground text-sm">
        {{ $t('transactions.trashPage.description', { days: TRANSACTION_TRASH_RETENTION_DAYS }) }}
      </p>
    </div>

    <Callout v-if="expiring" variant="warning" :icon="ClockIcon" role="status">
      <i18n-t keypath="transactions.trashPage.expiringBanner" tag="span">
        <template #count>
          <b>
            {{ $t('transactions.trashPage.expiringCount', { count: expiring.count }, expiring.count) }}
          </b>
        </template>
        <template #days>
          {{ $t('transactions.trashPage.expiringDays', { count: expiring.withinDays }, expiring.withinDays) }}
        </template>
      </i18n-t>
    </Callout>

    <Card v-if="isError && !entries">
      <ErrorState :message="$t('transactions.trashPage.loadError')" @retry="refetch()" />
    </Card>

    <Card v-else-if="!isFetched" class="flex flex-col gap-2 p-3">
      <div v-for="index in SKELETON_ROW_COUNT" :key="index" class="bg-muted h-14 animate-pulse rounded-md" />
    </Card>

    <Card v-else-if="!rows.length" class="flex flex-col items-center py-12 text-center">
      <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
        <Trash2Icon class="text-muted-foreground size-6" />
      </div>
      <h3 class="mb-2 text-lg font-semibold">{{ $t('transactions.trashPage.emptyTitle') }}</h3>
      <p class="text-muted-foreground max-w-md text-sm">
        {{ $t('transactions.trashPage.emptyDescription', { days: TRANSACTION_TRASH_RETENTION_DAYS }) }}
      </p>
    </Card>

    <div v-else class="flex items-start gap-5">
      <Card class="divide-border min-w-0 flex-[3_1_400px] divide-y overflow-hidden rounded-xl">
        <TrashRow
          v-for="row in rows"
          :key="row.entry.id"
          :entry="row.entry"
          :display="row.display"
          :days-left="row.daysLeft"
          :selected="isSplitLayout ? row.entry.id === selectedRow?.entry.id : undefined"
          @select="selectEntry({ entry: row.entry })"
        />
      </Card>

      <Card v-if="isSplitLayout && selectedRow" class="sticky top-4 min-w-0 flex-[2_1_320px] rounded-xl p-5">
        <TrashEntryDetails
          :entry="selectedRow.entry"
          :display="selectedRow.display"
          :days-left="selectedRow.daysLeft"
          :readonly="isDemo"
          :is-restoring="restore.isPending.value"
          :is-deleting="remove.isPending.value"
          @restore="restoreSelected"
          @delete="isDeleteConfirmOpen = true"
        />
      </Card>
    </div>

    <ResponsiveDialog v-if="!isSplitLayout" v-model:open="isSheetOpen" sr-only-header>
      <template #title>{{ selectedRow?.display.title }}</template>
      <TrashEntryDetails
        v-if="selectedRow"
        :entry="selectedRow.entry"
        :display="selectedRow.display"
        :days-left="selectedRow.daysLeft"
        :readonly="isDemo"
        :is-restoring="restore.isPending.value"
        :is-deleting="remove.isPending.value"
        stacked
        class="pt-2 pb-2"
        @restore="restoreSelected"
        @delete="isDeleteConfirmOpen = true"
      />
    </ResponsiveDialog>

    <ResponsiveAlertDialog
      v-model:open="isDeleteConfirmOpen"
      :confirm-label="$t('transactions.trashPage.deletePermanently')"
      confirm-variant="destructive"
      :confirm-disabled="remove.isPending.value"
      @confirm="deleteSelected"
    >
      <template #title>{{ $t('transactions.trashPage.deleteConfirmTitle') }}</template>
      <template #description>{{ $t('transactions.trashPage.deleteConfirmDescription') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
