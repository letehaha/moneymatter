<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { StatCard } from '@/components/lib/ui/stat-card';
import AccountBalanceChangesTable from '@/pages/import-export/components/account-balance-changes-table.vue';
import BalanceDesyncCallout from '@/pages/import-export/components/balance-desync-callout.vue';
import { ROUTES_NAMES } from '@/routes';
import { useImportOfxStore } from '@/stores/import-ofx';
import type { ImportError } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
const store = useImportOfxStore();
const router = useRouter();
const { t } = useI18n();
const summary = computed(() => (store.progress?.status === 'completed' ? store.progress.summary : null));
const outcome = computed(() =>
  !summary.value
    ? null
    : summary.value.transactionsImported + summary.value.merged === 0
      ? summary.value.errors.length
        ? 'failed'
        : 'empty'
      : summary.value.errors.length
        ? 'partial'
        : 'success',
);
const outcomeCopy = computed(() => {
  if (outcome.value === 'success')
    return {
      title: t('pages.importExport.ofxImport.done.successTitle'),
      description: t('pages.importExport.ofxImport.done.successDescription'),
    };
  if (outcome.value === 'partial')
    return {
      title: t('pages.importExport.ofxImport.done.partialTitle', { count: summary.value?.errors.length ?? 0 }),
      description: t('pages.importExport.ofxImport.done.partialDescription'),
    };
  if (outcome.value === 'empty')
    return {
      title: t('pages.importExport.ofxImport.done.emptyTitle'),
      description: t('pages.importExport.ofxImport.done.emptyDescription'),
    };
  return {
    title: t('pages.importExport.ofxImport.done.failedTitle'),
    description: t('pages.importExport.ofxImport.done.failedDescription'),
  };
});
function errorText(error: ImportError): string {
  const prefix = 'pages.importExport.ofxImport.done.errors';
  if (error.code === 'rows-suppressed') return t(`${prefix}.rowsSuppressed`, error.params, error.params.count);
  if (error.code === 'account-balance-desync') return t(`${prefix}.accountBalanceDesync`);
  return t(`${prefix}.rowImportFailed`);
}
function viewTransactions() {
  if (!summary.value) return;
  const batchId = summary.value.batchId;
  store.reset();
  router.push({ name: ROUTES_NAMES.transactions, query: { batchId } });
}
</script>
<template>
  <div v-if="summary" class="space-y-6">
    <Callout
      :variant="
        outcome === 'success'
          ? 'success'
          : outcome === 'partial'
            ? 'warning'
            : outcome === 'empty'
              ? 'info'
              : 'destructive'
      "
      :title="outcomeCopy.title"
      ><p>{{ outcomeCopy.description }}</p></Callout
    >
    <div class="grid grid-cols-2 gap-3 @sm/csv-wizard:grid-cols-3 @lg/csv-wizard:grid-cols-4">
      <StatCard
        :label="$t('pages.importExport.ofxImport.done.accountsCreated')"
        :value="summary.accountsCreated"
      /><StatCard
        :label="$t('pages.importExport.ofxImport.done.accountsLinked')"
        :value="summary.accountsLinked"
      /><StatCard
        v-if="summary.accountsSkipped"
        :label="$t('pages.importExport.ofxImport.done.accountsSkipped')"
        :value="summary.accountsSkipped"
      /><StatCard
        :label="$t('pages.importExport.ofxImport.done.payeesCreated')"
        :value="summary.payeesCreated"
      /><StatCard
        :label="$t('pages.importExport.ofxImport.done.transactionsImported')"
        :value="summary.transactionsImported"
      /><StatCard
        v-if="summary.duplicatesSkipped"
        :label="$t('pages.importExport.ofxImport.done.duplicatesSkipped')"
        :value="summary.duplicatesSkipped"
      /><StatCard
        v-if="summary.merged"
        :label="$t('pages.importExport.ofxImport.done.mergedIntoPlanned')"
        :value="summary.merged"
      />
    </div>
    <AccountBalanceChangesTable :changes="summary.accountBalanceChanges ?? []" />
    <BalanceDesyncCallout
      :errors="summary.errors"
      :title="$t('pages.importExport.ofxImport.done.balanceWarningTitle')"
      :body="$t('pages.importExport.ofxImport.done.balanceWarningBody')"
    />
    <Callout
      v-if="summary.errors.length"
      variant="warning"
      :title="$t('pages.importExport.ofxImport.done.errorsTitle', { count: summary.errors.length })"
      ><ul class="list-disc pl-5 text-xs">
        <li v-for="(error, index) in summary.errors.slice(0, 10)" :key="index">
          <span v-if="error.rowIndex != null">{{
            $t('pages.importExport.ofxImport.done.rowPrefix', { rowIndex: error.rowIndex })
          }}</span>
          {{ errorText(error) }}
        </li>
      </ul>
      <p v-if="summary.errors.length > 10" class="text-muted-foreground mt-1 text-xs">
        {{ $t('pages.importExport.ofxImport.done.errorsOverflow', { count: summary.errors.length - 10 }) }}
      </p></Callout
    >
    <div class="flex gap-3">
      <UiButton @click="viewTransactions">{{ $t('pages.importExport.ofxImport.done.viewTransactions') }}</UiButton
      ><UiButton variant="ghost" @click="store.reset()">{{
        $t('pages.importExport.ofxImport.done.importAnother')
      }}</UiButton>
    </div>
  </div>
</template>
