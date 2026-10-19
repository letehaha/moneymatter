<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { useImportOfxStore } from '@/stores/import-ofx';
import type { OfxImportJobStatus } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const store = useImportOfxStore();
const { progress, executeError } = storeToRefs(store);
const statusKeys: Record<OfxImportJobStatus, string> = {
  queued: 'pages.importExport.ofxImport.execute.statusQueued',
  running: 'pages.importExport.ofxImport.execute.statusRunning',
  completed: 'pages.importExport.ofxImport.execute.statusCompleted',
  failed: 'pages.importExport.ofxImport.execute.statusFailed',
};
const percent = computed(() =>
  progress.value?.totalCount
    ? Math.min(100, Math.round((progress.value.processedCount / progress.value.totalCount) * 100))
    : progress.value?.status === 'completed'
      ? 100
      : 5,
);
const isFailed = computed(() => progress.value?.status === 'failed');
</script>
<template>
  <div class="space-y-6">
    <p v-if="!progress" class="text-muted-foreground text-sm">
      {{ $t('pages.importExport.ofxImport.execute.starting') }}
    </p>
    <div v-else class="space-y-4">
      <div>
        <div class="mb-1 flex justify-between text-sm">
          <span class="font-medium">{{ $t(statusKeys[progress.status]) }}</span
          ><span class="text-muted-foreground">{{
            $t('pages.importExport.ofxImport.execute.progressCount', {
              processed: progress.processedCount,
              total: progress.totalCount || '?',
            })
          }}</span>
        </div>
        <div class="bg-muted h-2 overflow-hidden rounded-full">
          <div class="bg-primary h-full transition-[width]" :style="{ width: percent + '%' }" />
        </div>
      </div>
      <Callout v-if="isFailed" variant="destructive" role="alert"
        >{{ $t('pages.importExport.ofxImport.execute.failed') }}
        <p class="mt-2 text-xs">{{ $t('pages.importExport.ofxImport.execute.partialImportNote') }}</p></Callout
      >
      <Callout v-if="executeError" variant="destructive" role="alert">{{ executeError }}</Callout>
    </div>
  </div>
</template>
