<template>
  <div v-if="summary" class="@container/ms-money-done space-y-6">
    <!-- Banner variant driven by import outcome, not just job status -->
    <Callout
      v-if="importOutcome === 'success'"
      variant="success"
      :title="$t('pages.importExport.msMoneyImport.done.successTitle')"
    >
      <p class="text-sm opacity-80">{{ $t('pages.importExport.msMoneyImport.done.successDescription') }}</p>
    </Callout>
    <Callout
      v-else-if="importOutcome === 'partial'"
      variant="warning"
      :title="$t('pages.importExport.msMoneyImport.done.partialTitle', { count: summary.errors.length })"
    >
      <p class="text-sm opacity-80">{{ $t('pages.importExport.msMoneyImport.done.partialDescription') }}</p>
    </Callout>
    <Callout
      v-else-if="importOutcome === 'empty'"
      variant="info"
      :title="$t('pages.importExport.msMoneyImport.done.emptyTitle')"
    >
      <p class="text-sm opacity-80">{{ $t('pages.importExport.msMoneyImport.done.emptyDescription') }}</p>
    </Callout>
    <Callout v-else variant="warning" :title="$t('pages.importExport.msMoneyImport.done.allFailedTitle')">
      <p class="text-sm opacity-80">{{ $t('pages.importExport.msMoneyImport.done.allFailedDescription') }}</p>
    </Callout>

    <div class="grid grid-cols-2 gap-3 @sm/ms-money-done:grid-cols-3 @lg/ms-money-done:grid-cols-4">
      <StatCard :label="$t('pages.importExport.msMoneyImport.done.accountsCreated')" :value="summary.accountsCreated" />
      <StatCard :label="$t('pages.importExport.msMoneyImport.done.accountsLinked')" :value="summary.accountsLinked" />
      <StatCard
        v-if="summary.accountsSkipped > 0"
        :label="$t('pages.importExport.msMoneyImport.done.accountsSkipped')"
        :value="summary.accountsSkipped"
      />
      <StatCard
        :label="$t('pages.importExport.msMoneyImport.done.categoriesCreated')"
        :value="summary.categoriesCreated"
      />
      <StatCard :label="$t('pages.importExport.msMoneyImport.done.payeesCreated')" :value="summary.payeesCreated" />
      <StatCard
        :label="$t('pages.importExport.msMoneyImport.done.transactionsImported')"
        :value="summary.transactionsImported"
      />
      <StatCard
        :label="$t('pages.importExport.msMoneyImport.done.transfersImported')"
        :value="summary.transfersImported"
      />
      <StatCard
        v-if="summary.outOfWalletImported > 0"
        :label="$t('pages.importExport.msMoneyImport.done.outOfWalletImported')"
        :value="summary.outOfWalletImported"
      />
      <StatCard
        v-if="(summary.voidedImported ?? 0) > 0"
        :label="$t('pages.importExport.msMoneyImport.done.voidedImported')"
        :value="summary.voidedImported ?? 0"
      />
      <StatCard
        v-if="(summary.merged ?? 0) > 0"
        :label="$t('pages.importExport.msMoneyImport.done.mergedIntoPlanned')"
        :value="summary.merged ?? 0"
      />
      <StatCard
        v-if="summary.duplicatesSkipped > 0"
        :label="$t('pages.importExport.msMoneyImport.done.duplicatesSkipped')"
        :value="summary.duplicatesSkipped"
      />
    </div>

    <!-- Per-account balance changes (only present when the import touched balances) -->
    <AccountBalanceChangesTable :changes="summary.accountBalanceChanges ?? []" />

    <!-- Balance-desync callout: account balances could not be restored after import -->
    <BalanceDesyncCallout
      :errors="summary.errors"
      :title="$t('pages.importExport.msMoneyImport.done.balanceWarningTitle')"
      :body="$t('pages.importExport.msMoneyImport.done.balanceWarningBody')"
    />

    <Callout v-if="summary.errors.length > 0" variant="warning">
      <p class="text-sm font-medium">
        {{ $t('pages.importExport.msMoneyImport.done.errorsTitle', { count: summary.errors.length }) }}
      </p>
      <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
        <li v-for="(e, i) in summary.errors.slice(0, MAX_ERRORS_SHOWN)" :key="i">
          <!--
            rowIndex is null for account-level errors (e.g. balance-restore failures)
            that have no associated row; only prefix with "Row N:" when the index is known.
          -->
          <template v-if="e.rowIndex != null">
            <span class="text-muted-foreground">
              {{ $t('pages.importExport.msMoneyImport.done.rowPrefix', { rowIndex: e.rowIndex }) }}
            </span>
          </template>
          {{ errorText(e) }}
        </li>
      </ul>
      <!-- Overflow indicator when the error list is truncated -->
      <p v-if="summary.errors.length > MAX_ERRORS_SHOWN" class="text-muted-foreground mt-1 text-xs">
        {{
          $t('pages.importExport.msMoneyImport.done.errorsOverflow', {
            count: summary.errors.length - MAX_ERRORS_SHOWN,
          })
        }}
      </p>
    </Callout>

    <div class="flex flex-wrap items-center gap-3">
      <UiButton @click="goToTransactions">
        {{ $t('pages.importExport.msMoneyImport.done.viewTransactions') }}
      </UiButton>
      <UiButton variant="ghost" @click="store.reset()">
        {{ $t('pages.importExport.msMoneyImport.done.importAnother') }}
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { StatCard } from '@/components/lib/ui/stat-card';
import AccountBalanceChangesTable from '@/pages/import-export/components/account-balance-changes-table.vue';
import BalanceDesyncCallout from '@/pages/import-export/components/balance-desync-callout.vue';
import { deriveImportOutcome } from '@/pages/import-export/ms-money-import/utils/import-outcome';
import { ROUTES_NAMES } from '@/routes';
import { useImportMsMoneyStore } from '@/stores/import-ms-money';
import type { MsMoneyImportError } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const MAX_ERRORS_SHOWN = 10;

const { t } = useI18n();
const router = useRouter();
const store = useImportMsMoneyStore();
const { progress } = storeToRefs(store);

const summary = computed(() => (progress.value?.status === 'completed' ? progress.value.summary : null));

const importOutcome = computed(() => (summary.value ? deriveImportOutcome({ summary: summary.value }) : null));

function errorText(e: MsMoneyImportError): string {
  const prefix = 'pages.importExport.msMoneyImport.done.errors';
  if (e.code === 'rows-suppressed') return t(`${prefix}.rowsSuppressed`, e.params, e.params.count);
  if (e.code === 'account-balance-desync') return t(`${prefix}.accountBalanceDesync`);
  return t(`${prefix}.rowImportFailed`);
}

function goToTransactions() {
  store.reset();
  router.push({ name: ROUTES_NAMES.transactions });
}
</script>
