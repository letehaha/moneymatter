<script setup lang="ts">
/**
 * BudgetBakers Wallet review step — CSV-style summary before importing. Shows stat cards
 * (transactions, transfers, out-of-wallet, duplicates skipped, will-import),
 * surfaces parse warnings, and lets the user un-mark detected duplicates via the
 * shared DuplicatesTable. Mirrors the CSV importer's review step.
 */
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { StatCard } from '@/components/lib/ui/stat-card';
import DuplicatesTable from '@/pages/import-export/components/review-duplicates-step/duplicates-table.vue';
import { useImportBudgetBakersWalletStore } from '@/stores/import-budget-bakers-wallet';
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const store = useImportBudgetBakersWalletStore();

// ---- Derived counts for the stat cards ----

const skippedAccounts = computed(() => new Set(store.skippedAccountNames));

/** Ordinary transaction rows that will be imported (transfers are separate). */
const importableTransactions = computed(() =>
  (store.parsedResult?.transactions ?? []).filter((tx) => !skippedAccounts.value.has(tx.accountName)),
);

const importableTransfers = computed(() =>
  (store.parsedResult?.transfers ?? []).filter(
    (xfer) =>
      !skippedAccounts.value.has(xfer.sourceAccountName) && !skippedAccounts.value.has(xfer.destinationAccountName),
  ),
);

const transactionsCount = computed(() => importableTransactions.value.length);

const transfersCount = computed(() => importableTransfers.value.length);

/** Unpaired transfer legs imported as out-of-wallet transactions. */
const outOfWalletCount = computed(() => importableTransactions.value.filter((tx) => tx.outOfWallet).length);

/** Detected duplicates the user left marked (will be skipped on import). */
const duplicatesSkippedCount = computed(() => store.skipDuplicateIndices.length);

/**
 * Rows that will actually be created: all transactions + transfers minus the
 * duplicates the user is skipping. Transfers count as one imported row each.
 */
const willImportCount = computed(() =>
  Math.max(0, transactionsCount.value + transfersCount.value - duplicatesSkippedCount.value),
);

// ---- Execute ----

const isExecuting = ref(false);

async function handleImport() {
  isExecuting.value = true;
  try {
    await store.execute();
  } catch {
    // Error captured in store.executeError and shown via Callout.
  } finally {
    isExecuting.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Detection loading skeleton -->
    <template v-if="store.isDetectingDuplicates">
      <div class="@container/stat-row">
        <div class="grid grid-cols-2 gap-3 @sm/stat-row:grid-cols-4">
          <div v-for="i in 4" :key="i" class="bg-muted/40 border-border h-16 animate-pulse rounded-lg border p-3" />
        </div>
      </div>
      <div class="bg-muted/40 border-border h-40 animate-pulse rounded-lg border" />
    </template>

    <!-- Detection error -->
    <Callout v-else-if="store.detectError" variant="destructive" role="alert">
      <p>{{ store.detectError }}</p>
    </Callout>

    <template v-else>
      <!-- Summary stat cards — container-query grid -->
      <div class="@container/stat-row">
        <div class="grid grid-cols-2 gap-3 @sm/stat-row:grid-cols-3 @lg/stat-row:grid-cols-5">
          <StatCard
            :label="$t('pages.importExport.budgetBakersWalletImport.review.transactions')"
            :value="transactionsCount"
            variant="neutral"
          />
          <StatCard
            :label="$t('pages.importExport.budgetBakersWalletImport.review.transfersDetected')"
            :value="transfersCount"
            variant="neutral"
          />
          <StatCard
            :label="$t('pages.importExport.budgetBakersWalletImport.review.outOfWallet')"
            :value="outOfWalletCount"
            variant="neutral"
          />
          <StatCard
            :label="$t('pages.importExport.budgetBakersWalletImport.review.duplicatesSkipped')"
            :value="duplicatesSkippedCount"
            variant="warning"
          />
          <StatCard
            :label="$t('pages.importExport.budgetBakersWalletImport.review.willImport')"
            :value="willImportCount"
            variant="success"
          />
        </div>
      </div>

      <!-- Parse warnings -->
      <Callout
        v-if="store.parsedResult && store.parsedResult.warnings.length > 0"
        variant="warning"
        :title="
          $t('pages.importExport.budgetBakersWalletImport.review.warningsTitle', {
            count: store.parsedResult.warnings.length,
          })
        "
      >
        <ul class="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          <li v-for="(warning, index) in store.parsedResult.warnings" :key="index">
            <span v-if="warning.rowIndex" class="text-muted-foreground">
              {{ $t('pages.importExport.budgetBakersWalletImport.review.rowPrefix', { rowIndex: warning.rowIndex }) }}
            </span>
            {{ warning.message }}
          </li>
        </ul>
      </Callout>

      <!-- Duplicates table -->
      <section v-if="store.duplicates.length > 0" aria-labelledby="budget-bakers-wallet-duplicates-heading">
        <h3 id="budget-bakers-wallet-duplicates-heading" class="text-warning-text mb-1 text-sm font-semibold">
          {{
            $t('pages.importExport.budgetBakersWalletImport.review.duplicatesTitle', {
              count: store.duplicates.length,
            })
          }}
        </h3>
        <p class="text-muted-foreground mb-3 text-xs">
          {{ $t('pages.importExport.budgetBakersWalletImport.review.duplicatesHint') }}
        </p>

        <DuplicatesTable
          :duplicates="store.duplicates"
          :unmarked-indices="store.unmarkedDuplicateIndices"
          @toggle="(rowIndex) => store.toggleDuplicateUnmark({ rowIndex })"
        />
      </section>

      <!-- Import error callout (execute API failure) -->
      <Callout v-if="store.executeError" variant="destructive" role="alert">
        <p>{{ store.executeError }}</p>
      </Callout>

      <!-- ==================== FOOTER ==================== -->
      <div class="flex items-center justify-between gap-3 pt-2">
        <UiButton variant="ghost" @click="store.goBack()">
          <ChevronLeftIcon class="size-4" />
          {{ $t('pages.importExport.budgetBakersWalletImport.review.back') }}
        </UiButton>

        <UiButton :disabled="isExecuting" @click="handleImport">
          <template v-if="isExecuting">
            <LoaderCircleIcon class="size-4 animate-spin" />
            {{ $t('pages.importExport.budgetBakersWalletImport.review.importing') }}
          </template>
          <template v-else>
            {{ $t('pages.importExport.budgetBakersWalletImport.review.importButton', { count: willImportCount }) }}
            <ChevronRightIcon class="size-4" />
          </template>
        </UiButton>
      </div>
    </template>
  </div>
</template>
