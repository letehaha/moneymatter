<template>
  <div v-if="summary" class="@container/ynab-done space-y-6">
    <Callout variant="success" :title="$t('pages.importExport.ynabImport.done.successTitle')">
      <p class="text-sm opacity-80">
        {{ $t('pages.importExport.ynabImport.done.successDescription') }}
      </p>
    </Callout>

    <div class="grid grid-cols-2 gap-3 @sm/ynab-done:grid-cols-3 @lg/ynab-done:grid-cols-4">
      <SummaryStat :label="$t('pages.importExport.ynabImport.done.accountsCreated')" :value="summary.accountsCreated" />
      <SummaryStat
        v-if="summary.accountsSkipped"
        :label="$t('pages.importExport.ynabImport.done.accountsSkipped')"
        :value="summary.accountsSkipped"
      />
      <SummaryStat
        :label="$t('pages.importExport.ynabImport.done.categoriesCreated')"
        :value="summary.categoriesCreated"
      />
      <SummaryStat :label="$t('pages.importExport.ynabImport.done.payeesCreated')" :value="summary.payeesCreated" />
      <SummaryStat :label="$t('pages.importExport.ynabImport.done.tagsCreated')" :value="summary.tagsCreated" />
      <SummaryStat
        :label="$t('pages.importExport.ynabImport.done.transactionsImported')"
        :value="summary.transactionsImported"
      />
      <SummaryStat
        :label="$t('pages.importExport.ynabImport.done.transfersImported')"
        :value="summary.transfersImported"
      />
      <SummaryStat
        v-if="summary.splitsDetected > 0"
        :label="$t('pages.importExport.ynabImport.done.splitsDetected')"
        :value="summary.splitsDetected"
      />
    </div>

    <Callout v-if="summary.errors.length > 0" variant="warning">
      <p class="text-sm font-medium">
        {{ $t('pages.importExport.ynabImport.done.errorsTitle', { count: summary.errors.length }) }}
      </p>
      <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
        <li v-for="(e, i) in summary.errors.slice(0, MAX_ERRORS_SHOWN)" :key="i">
          <span v-if="e.rowIndex >= 0" class="text-muted-foreground">{{
            $t('pages.importExport.ynabImport.preview.rowPrefix', { rowIndex: e.rowIndex })
          }}</span>
          {{ errorText(e) }}
        </li>
      </ul>
    </Callout>

    <div class="flex flex-wrap items-center gap-3">
      <UiButton @click="goToTransactions">
        {{ $t('pages.importExport.ynabImport.done.viewTransactions') }}
      </UiButton>
      <UiButton variant="ghost" @click="store.reset()">
        {{ $t('pages.importExport.ynabImport.done.importAnother') }}
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { ROUTES_NAMES } from '@/routes';
import { useImportYnabStore } from '@/stores/import-ynab';
import type { YnabImportError } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import SummaryStat from './summary-stat.vue';

const MAX_ERRORS_SHOWN = 10;

const { t } = useI18n();
const router = useRouter();
const store = useImportYnabStore();
const { progress } = storeToRefs(store);

const summary = computed(() => (progress.value?.status === 'completed' ? progress.value.summary : null));

function errorText(e: YnabImportError): string {
  if (e.code === 'payee-create-failed') {
    return t('pages.importExport.ynabImport.done.errors.payeeCreateFailed', { payeeName: e.payeeName });
  }
  return t('pages.importExport.ynabImport.done.errors.rowImportFailed');
}

function goToTransactions() {
  store.reset();
  router.push({ name: ROUTES_NAMES.transactions });
}
</script>
