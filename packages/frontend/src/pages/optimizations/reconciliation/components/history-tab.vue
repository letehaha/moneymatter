<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useDateLocale } from '@/composable/use-date-locale';
import type { RecordId } from '@bt/shared/types';
import type { ReconciliationHistoryEvent } from '@bt/shared/types/endpoints';
import { HistoryIcon, Loader2Icon, TriangleAlertIcon, Undo2Icon } from '@lucide/vue';
import { ref } from 'vue';

import { useReconciliationActions, useReconciliationHistory } from '../use-reconciliation';
import RestoreDialog from './restore-dialog.vue';

const SKELETON_ROW_COUNT = 4;
const EVENT_DATE_FORMAT = 'd MMM yyyy, HH:mm';

const { format } = useDateLocale();
const { data: events, isFetched, isError, refetch } = useReconciliationHistory();
const { restore } = useReconciliationActions();

const isRestoringEvent = ({ event }: { event: ReconciliationHistoryEvent }) =>
  restore.isPending.value && restore.variables.value?.transactionIds[0] === event.transactions[0]?.id;

const restoreTargetIds = ref<RecordId[]>([]);
const isRestoreOpen = ref(false);
const openRestore = ({ event }: { event: ReconciliationHistoryEvent }) => {
  restoreTargetIds.value = event.transactions.map((tx) => tx.id);
  isRestoreOpen.value = true;
};
const confirmRestore = () =>
  restore.mutate({ transactionIds: restoreTargetIds.value }, { onSuccess: () => (isRestoreOpen.value = false) });
</script>

<template>
  <div class="flex min-h-0 w-full max-w-5xl flex-1 flex-col">
    <Card v-if="isError" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <TriangleAlertIcon class="text-destructive-text size-8" />
      <p class="text-destructive-text text-sm">{{ $t('optimizations.reconciliation.history.loadError') }}</p>
      <Button variant="outline" size="sm" @click="refetch()">{{ $t('common.actions.retry') }}</Button>
    </Card>

    <Card v-else-if="!isFetched" class="flex flex-col gap-2 p-3">
      <div v-for="index in SKELETON_ROW_COUNT" :key="index" class="bg-muted h-24 animate-pulse rounded-md" />
    </Card>

    <Card v-else-if="!events?.length" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div class="bg-muted flex size-12 items-center justify-center rounded-full">
        <HistoryIcon class="text-muted-foreground size-6" />
      </div>
      <p class="font-medium">{{ $t('optimizations.reconciliation.history.emptyTitle') }}</p>
      <p class="text-muted-foreground max-w-sm text-sm">
        {{ $t('optimizations.reconciliation.history.emptyDescription') }}
      </p>
    </Card>

    <ScrollArea v-else class="min-h-0 flex-1">
      <div class="flex flex-col gap-4">
        <Card v-for="event in events" :key="event.removedAt" class="overflow-hidden">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div class="flex min-w-0 items-center gap-2">
              <StatusBadge :variant="event.type === 'merge' ? 'info' : 'destructive'">
                {{ $t(`optimizations.reconciliation.history.type.${event.type}`) }}
              </StatusBadge>
              <span class="text-muted-foreground truncate text-sm tabular-nums">
                {{ format(event.removedAt, EVENT_DATE_FORMAT) }}
              </span>
            </div>
            <Button variant="outline" size="sm" :disabled="restore.isPending.value" @click="openRestore({ event })">
              <Loader2Icon v-if="isRestoringEvent({ event })" class="size-4 animate-spin" />
              <Undo2Icon v-else class="size-4" />
              {{ $t('optimizations.reconciliation.history.restore') }}
            </Button>
          </div>

          <div class="flex flex-col gap-3 px-4 py-3">
            <div v-if="event.survivor">
              <p class="text-muted-foreground mb-1 text-xs font-medium">
                {{ $t('optimizations.reconciliation.history.kept') }}
              </p>
              <TransactionRecord :tx="event.survivor" :as-button="false" />
            </div>
            <div>
              <p class="text-muted-foreground mb-1 text-xs font-medium">
                {{
                  $t(
                    'optimizations.reconciliation.history.removedRows',
                    { count: event.transactions.length },
                    event.transactions.length,
                  )
                }}
              </p>
              <TransactionRecord
                v-for="tx in event.transactions"
                :key="tx.id"
                :tx="tx"
                :as-button="false"
                class="opacity-70"
              />
            </div>
          </div>
        </Card>
      </div>
    </ScrollArea>

    <RestoreDialog
      v-model:open="isRestoreOpen"
      :transaction-ids="restoreTargetIds"
      :pending="restore.isPending.value"
      @confirm="confirmRestore"
    />
  </div>
</template>
