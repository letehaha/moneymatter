<template>
  <div class="space-y-6">
    <div v-if="!progress">
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.msMoneyImport.execute.starting') }}
      </p>
    </div>

    <div v-else class="space-y-4">
      <div>
        <div class="mb-1 flex items-baseline justify-between text-sm">
          <span class="font-medium">{{ statusLabel }}</span>
          <span class="text-muted-foreground">
            {{
              $t('pages.importExport.msMoneyImport.execute.progressCount', {
                processed: progress.processedCount,
                total: progress.totalCount || '?',
              })
            }}
          </span>
        </div>
        <div class="bg-muted h-2 w-full overflow-hidden rounded-full">
          <div class="bg-primary h-full transition-[width] duration-300" :style="{ width: progressPercent + '%' }" />
        </div>
      </div>

      <Callout v-if="progress.status === 'failed'" variant="destructive" role="alert">
        {{ $t('pages.importExport.msMoneyImport.execute.failed') }}
        <p class="mt-2 text-xs opacity-80">
          {{ $t('pages.importExport.msMoneyImport.execute.partialImportNote') }}
        </p>
      </Callout>

      <!-- Watchdog gave up tracking the job (expired / lost contact): the poll
           loop sets `executeError` without flipping `progress.status` to failed,
           so surface it here too or the bar stalls with no explanation. -->
      <Callout v-if="executeError" variant="destructive" role="alert">
        <p>{{ executeError }}</p>
      </Callout>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { useImportMsMoneyStore } from '@/stores/import-ms-money';
import type { MsMoneyImportJobStatus } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

/** Shown before the worker reports a total, so the bar visibly starts moving. */
const KICKOFF_PROGRESS_PERCENT = 5;

const STATUS_LABEL_KEYS: Record<MsMoneyImportJobStatus, string> = {
  queued: 'pages.importExport.msMoneyImport.execute.statusQueued',
  running: 'pages.importExport.msMoneyImport.execute.statusRunning',
  completed: 'pages.importExport.msMoneyImport.execute.statusCompleted',
  failed: 'pages.importExport.msMoneyImport.execute.statusFailed',
};

const { t } = useI18n();
const store = useImportMsMoneyStore();
const { progress, executeError } = storeToRefs(store);

const progressPercent = computed(() => {
  if (!progress.value) return 0;
  if (!progress.value.totalCount) {
    return progress.value.status === 'completed' ? 100 : KICKOFF_PROGRESS_PERCENT;
  }
  return Math.min(100, Math.round((progress.value.processedCount / progress.value.totalCount) * 100));
});

const statusLabel = computed(() => (progress.value ? t(STATUS_LABEL_KEYS[progress.value.status]) : ''));
</script>
