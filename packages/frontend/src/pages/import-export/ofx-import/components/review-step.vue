<script setup lang="ts">
import { formatShortDate } from '@/common/utils/date';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { StatCard } from '@/components/lib/ui/stat-card';
import DuplicatesTable from '@/pages/import-export/components/review-duplicates-step/duplicates-table.vue';
import { useImportOfxStore } from '@/stores/import-ofx';
import type { OfxParseWarning } from '@bt/shared/types';
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const store = useImportOfxStore();
const warningKeys: Record<OfxParseWarning['code'], string> = {
  'date-user-fallback': 'pages.importExport.ofxImport.review.warnings.dateUserFallback',
  'fitid-missing': 'pages.importExport.ofxImport.review.warnings.fitidMissing',
  'fitid-duplicate': 'pages.importExport.ofxImport.review.warnings.fitidDuplicate',
};
const includedTransactions = computed(() => {
  const skipped = new Set(store.skippedAccountKeys);
  return (store.parsedResult?.transactions ?? []).filter((row) => !skipped.has(row.sourceAccountKey));
});
const willImportCount = computed(() =>
  Math.max(0, includedTransactions.value.length - store.skipDuplicateIndices.length),
);
const dateRange = computed(() =>
  store.parsedResult?.dateRange
    ? { from: formatShortDate(store.parsedResult.dateRange.from), to: formatShortDate(store.parsedResult.dateRange.to) }
    : null,
);
async function handleImport() {
  await store.execute();
}
</script>
<template>
  <div class="space-y-6">
    <template v-if="store.isDetectingDuplicates"><div class="bg-muted/40 h-40 animate-pulse rounded-lg" /></template>
    <Callout v-else-if="store.detectError" variant="destructive">{{ store.detectError }}</Callout>
    <template v-else>
      <div class="grid grid-cols-2 gap-3 @sm/csv-wizard:grid-cols-4">
        <StatCard
          :label="$t('pages.importExport.ofxImport.review.transactions')"
          :value="includedTransactions.length"
        /><StatCard
          :label="$t('pages.importExport.ofxImport.review.accountsSkipped')"
          :value="store.skippedAccountKeys.length"
        /><StatCard
          :label="$t('pages.importExport.ofxImport.review.duplicatesSkipped')"
          :value="store.skipDuplicateIndices.length"
          variant="warning"
        /><StatCard
          :label="$t('pages.importExport.ofxImport.review.willImport')"
          :value="willImportCount"
          variant="success"
        />
      </div>
      <p v-if="dateRange" class="text-muted-foreground text-xs">
        {{ $t('pages.importExport.ofxImport.review.dateRange', dateRange) }}
      </p>
      <Callout
        v-if="store.parsedResult?.warnings.length"
        variant="warning"
        :title="$t('pages.importExport.ofxImport.review.warningsTitle')"
        ><p class="text-xs">{{ $t('pages.importExport.ofxImport.review.warningsHint') }}</p>
        <ul class="mt-2 list-disc pl-5 text-xs">
          <li v-for="warning in store.parsedResult.warnings" :key="warning.code">
            {{ $t(warningKeys[warning.code], { count: warning.count }) }}
          </li>
        </ul></Callout
      >
      <section v-if="store.duplicates.length">
        <h3 class="text-warning-text text-sm font-semibold">
          {{ $t('pages.importExport.ofxImport.review.duplicatesTitle', { count: store.duplicates.length }) }}
        </h3>
        <p class="text-muted-foreground mb-3 text-xs">{{ $t('pages.importExport.ofxImport.review.duplicatesHint') }}</p>
        <DuplicatesTable
          :duplicates="store.duplicates"
          :unmarked-indices="store.unmarkedDuplicateIndices"
          @toggle="(rowIndex) => store.toggleDuplicateUnmark({ rowIndex })"
        />
      </section>
      <Callout v-if="store.executeError" variant="destructive">{{ store.executeError }}</Callout>
      <div class="flex justify-between">
        <UiButton variant="ghost" @click="store.goBack()"
          ><ChevronLeftIcon class="size-4" />{{ $t('pages.importExport.ofxImport.review.back') }}</UiButton
        ><UiButton :disabled="store.isExecuting" @click="handleImport"
          ><LoaderCircleIcon v-if="store.isExecuting" class="size-4 animate-spin" />{{
            $t(
              store.isExecuting
                ? 'pages.importExport.ofxImport.review.importing'
                : 'pages.importExport.ofxImport.review.importButton',
              { count: willImportCount },
            )
          }}<ChevronRightIcon v-if="!store.isExecuting" class="size-4"
        /></UiButton>
      </div>
    </template>
  </div>
</template>
