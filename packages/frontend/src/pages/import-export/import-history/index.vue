<template>
  <div class="flex flex-col gap-0">
    <!-- Page header -->
    <div class="mb-6">
      <RouterLink
        :to="{ name: ROUTES_NAMES.settingsDataManagementImport }"
        class="text-muted-foreground hover:text-foreground mb-3 inline-flex w-fit items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeftIcon class="size-4" />
        {{ $t('settings.dataManagement.import.back') }}
      </RouterLink>
      <h2 class="mb-2 text-2xl font-semibold text-balance">
        {{ $t('pages.importExport.importHistory.pageTitle') }}
      </h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.importHistory.pageDescription') }}
      </p>
    </div>

    <Card class="flex flex-col overflow-hidden">
      <div v-if="isLoadingError" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <TriangleAlertIcon class="text-destructive-text size-8" />
        <p class="text-destructive-text text-sm">{{ $t('pages.importExport.importHistory.loadError') }}</p>
        <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
      </div>

      <div v-else-if="!isFetched" class="flex flex-col gap-2 p-3">
        <div v-for="index in SKELETON_ROW_COUNT" :key="index" class="bg-muted h-14 animate-pulse rounded-md" />
      </div>

      <div
        v-else-if="batches.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div class="bg-muted flex size-12 items-center justify-center rounded-full">
          <HistoryIcon class="text-muted-foreground size-6" />
        </div>
        <p class="font-medium">{{ $t('pages.importExport.importHistory.emptyTitle') }}</p>
        <p class="text-muted-foreground max-w-sm text-sm">
          {{ $t('pages.importExport.importHistory.emptyDescription') }}
        </p>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: ROUTES_NAMES.settingsDataManagementImport }">
            {{ $t('pages.importExport.importHistory.emptyAction') }}
          </RouterLink>
        </Button>
      </div>

      <ScrollArea v-else>
        <ul class="divide-y">
          <li v-for="batch in batches" :key="batch.batchId" class="relative">
            <Button
              variant="ghost"
              class="h-auto w-full justify-between gap-3 rounded-none px-4 py-3 aria-disabled:cursor-default aria-disabled:hover:bg-transparent"
              :aria-disabled="batch.transactionCount === 0"
              @click="batch.transactionCount > 0 && openBatch(batch)"
            >
              <span class="flex min-w-0 flex-col items-start gap-0.5">
                <span class="flex max-w-full min-w-0 items-center gap-2">
                  <span class="min-w-0 truncate text-sm font-medium">
                    {{ formatBatchDate({ importedAt: batch.importedAt }) }}
                  </span>
                  <span class="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs">
                    {{ sourceLabel(batch.source) }}
                  </span>
                </span>
                <span class="text-muted-foreground text-xs tabular-nums">
                  {{
                    $t(
                      'pages.importExport.importHistory.transactionCount',
                      { count: batch.transactionCount.toLocaleString() },
                      batch.transactionCount,
                    )
                  }}
                  ·
                  {{
                    $t(
                      'pages.importExport.importHistory.accountCount',
                      { count: batch.accountIds.length },
                      batch.accountIds.length,
                    )
                  }}
                </span>
              </span>
              <span class="flex shrink-0 items-center gap-3">
                <!-- Reserves the slot the absolutely-positioned delete button overlays. -->
                <span class="size-10" aria-hidden="true" />
                <ChevronRightIcon
                  :class="cn('text-muted-foreground size-4', batch.transactionCount === 0 && 'invisible')"
                />
              </span>
            </Button>
            <DesktopOnlyTooltip :content="$t('pages.importExport.importHistory.deleteButton')">
              <Button
                variant="ghost-destructive"
                size="icon"
                class="absolute top-1/2 right-11 -translate-y-1/2"
                :aria-label="$t('pages.importExport.importHistory.deleteButton')"
                @click="confirmDeleteBatch(batch)"
              >
                <Trash2Icon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </li>
        </ul>

        <div v-if="hasNextPage" ref="sentinelRef" class="flex justify-center p-3">
          <Loader2Icon v-if="isFetchingNextPage" class="text-muted-foreground size-4 animate-spin" />
        </div>
      </ScrollArea>
    </Card>

    <ResponsiveAlertDialog
      v-model:open="isDeleteDialogOpen"
      :confirm-label="$t('pages.importExport.importHistory.deleteButton')"
      confirm-variant="destructive"
      :confirm-disabled="deleteBatchMutation.isPending.value"
      @confirm="handleDeleteConfirm"
    >
      <template #title>{{ $t('pages.importExport.importHistory.deleteConfirmTitle') }}</template>
      <template #description>
        <template v-if="isPendingBatchEmpty">
          {{ $t('pages.importExport.importHistory.deleteConfirmDescriptionNoTransactions') }}
        </template>
        <template v-else-if="batchPendingDelete">
          {{
            $t(
              'pages.importExport.importHistory.deleteConfirmDescription',
              { count: batchPendingDelete.transactionCount },
              batchPendingDelete.transactionCount,
            )
          }}
        </template>
        <p v-if="batchPendingDelete?.createdAccountCount" class="mt-2">
          {{ $t('pages.importExport.importHistory.deleteConfirmCreatedAccountsNote') }}
        </p>
      </template>

      <Callout
        v-if="!isPendingBatchEmpty"
        variant="warning"
        :title="$t('pages.importExport.importHistory.deleteLinkedTransfersWarningTitle')"
      >
        <p class="text-muted-foreground text-xs">
          {{ $t('pages.importExport.importHistory.deleteLinkedTransfersDescription') }}
        </p>
        <label class="text-foreground mt-3 flex cursor-pointer items-start gap-2">
          <Checkbox
            class="mt-0.5"
            :model-value="deleteLinkedTransfers"
            @update:model-value="(val) => (deleteLinkedTransfers = !!val)"
          />
          <span>{{ $t('pages.importExport.importHistory.deleteLinkedTransfersCheckbox') }}</span>
        </label>
      </Callout>
    </ResponsiveAlertDialog>

    <ResponsiveAlertDialog
      v-model:open="isConfirmLinkedTransfersOpen"
      :confirm-label="$t('pages.importExport.importHistory.deleteButton')"
      confirm-variant="destructive"
      :confirm-disabled="deleteBatchMutation.isPending.value"
      @confirm="handleConfirmLinkedTransfersDelete"
    >
      <template #title>{{ $t('pages.importExport.importHistory.deleteLinkedTransfersConfirmTitle') }}</template>
      <template #description>
        {{ $t('pages.importExport.importHistory.deleteLinkedTransfersConfirmDescription') }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>

<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card } from '@/components/lib/ui/card';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HistoryIcon,
  Loader2Icon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@lucide/vue';
import { useIntersectionObserver } from '@vueuse/core';
import { computed, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';

import { ImportSource, type ImportBatchSummary } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';

import { useBatchesHistory } from './use-batches-history';
import { useDeleteImportBatch } from './use-delete-import-batch';

defineOptions({
  name: 'import-history',
});

const SKELETON_ROW_COUNT = 6;
const BATCH_DATE_FORMAT = 'd MMM yyyy, HH:mm';

// Reuses the import hub's own source titles instead of duplicating source
// names under a second i18n namespace.
const SOURCE_ID_MAP: Record<ImportSource, string> = {
  [ImportSource.csv]: 'csv',
  [ImportSource.ynab]: 'ynab',
  [ImportSource.statementParser]: 'textSource',
  [ImportSource.budgetBakersWallet]: 'budget-bakers-wallet',
  [ImportSource.msMoney]: 'ms-money',
  [ImportSource.ofx]: 'ofx',
};

const router = useRouter();
const { t } = useI18n();
const { format } = useDateLocale();
const { batches, isFetched, isLoadingError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
  useBatchesHistory();

const formatBatchDate = ({ importedAt }: { importedAt: string }) => format(importedAt, BATCH_DATE_FORMAT);
const sourceLabel = (source: ImportSource) => t(`settings.dataManagement.${SOURCE_ID_MAP[source] ?? 'csv'}.title`);

const openBatch = (batch: ImportBatchSummary) => {
  router.push({ name: ROUTES_NAMES.transactions, query: { batchId: batch.batchId } });
};

const isDeleteDialogOpen = ref(false);
const isConfirmLinkedTransfersOpen = ref(false);
const batchPendingDelete = ref<ImportBatchSummary | null>(null);
const deleteLinkedTransfers = ref(false);
const isPendingBatchEmpty = computed(() => batchPendingDelete.value?.transactionCount === 0);

const deleteBatchMutation = useDeleteImportBatch({
  onSuccess: () => {
    isDeleteDialogOpen.value = false;
    isConfirmLinkedTransfersOpen.value = false;
  },
});

const confirmDeleteBatch = (batch: ImportBatchSummary) => {
  batchPendingDelete.value = batch;
  deleteLinkedTransfers.value = false;
  isDeleteDialogOpen.value = true;
};

const handleDeleteConfirm = () => {
  if (!batchPendingDelete.value) return;
  // Checking the box gates the actual delete behind a second, explicit confirmation —
  // it's easy to tick accidentally, and this path also destroys a linked transaction
  // outside the batch.
  if (deleteLinkedTransfers.value) {
    isDeleteDialogOpen.value = false;
    isConfirmLinkedTransfersOpen.value = true;
    return;
  }
  deleteBatchMutation.mutate({ batchId: batchPendingDelete.value.batchId, deleteLinkedTransfers: false });
};

const handleConfirmLinkedTransfersDelete = () => {
  if (!batchPendingDelete.value) return;
  deleteBatchMutation.mutate({ batchId: batchPendingDelete.value.batchId, deleteLinkedTransfers: true });
};

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && hasNextPage.value && !isFetchingNextPage.value) fetchNextPage();
});
</script>
