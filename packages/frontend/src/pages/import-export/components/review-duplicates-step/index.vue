<template>
  <div class="space-y-6">
    <!-- Detection loading skeleton -->
    <template v-if="store.isDetectingDuplicates">
      <div class="@container/stat-row grid gap-3">
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
      <!-- Summary stat cards — 4-up, container-query grid -->
      <div class="@container/stat-row">
        <div class="grid grid-cols-2 gap-3 @sm/stat-row:grid-cols-4">
          <StatCard
            :label="$t('pages.importExport.csvImport.review.totalRows')"
            :value="store.importSummary.totalRows"
            variant="neutral"
          />
          <StatCard
            :label="$t('pages.importExport.csvImport.review.validRows')"
            :value="store.importSummary.validRows"
            variant="success"
          />
          <StatCard
            :label="$t('pages.importExport.csvImport.review.invalidRows')"
            :value="store.importSummary.invalidRows"
            variant="destructive"
          />
          <StatCard
            :label="$t('pages.importExport.csvImport.review.duplicates')"
            :value="store.importSummary.duplicates"
            variant="warning"
          />
        </div>
      </div>

      <BankSeamSkippedCallout :count="store.skippedAfterBankSeam" :accounts="store.seamTargets.seamAccounts" />

      <!-- A seam account's balance is owned by its bank feed, so the toggle does nothing when every target is one. -->
      <RecalculateBalanceToggle
        v-if="!store.seamTargets.isEveryTargetSeam"
        v-model="store.recalculateBalance"
        :settings-loading="store.recalculateBalanceSettingLoading"
        :settings-load-failed="store.recalculateBalanceSettingLoadFailed"
      />
      <p
        v-if="store.seamTargets.seamAccounts.length > 0"
        :class="cn('text-muted-foreground', store.seamTargets.isEveryTargetSeam ? 'text-sm' : '-mt-3 text-xs')"
      >
        {{
          store.seamTargets.isEveryTargetSeam
            ? $t('pages.importExport.csvImport.bankSeamRecalculateAllHint')
            : $t('pages.importExport.csvImport.bankSeamRecalculateHint')
        }}
      </p>

      <!-- Invalid rows table -->
      <section v-if="store.invalidRows.length > 0" aria-labelledby="invalid-rows-heading">
        <h3 id="invalid-rows-heading" class="text-destructive-text mb-3 text-sm font-semibold">
          {{ $t('pages.importExport.csvImport.review.invalidRowsTitle') }}
        </h3>
        <MappingTable :columns="invalidRowsColumns" :items="store.invalidRows" :row-key="(row) => row.rowIndex">
          <template #cell:row="{ item }">
            <span class="text-muted-foreground font-mono text-xs">#{{ item.rowIndex }}</span>
          </template>

          <template #cell:problem="{ item }">
            <div class="flex flex-col gap-1">
              <div v-for="(err, idx) in item.errors" :key="idx" class="flex items-start gap-1.5">
                <StatusIndicator status="invalid" size="xs" class="mt-px shrink-0" />
                <span class="text-destructive-text text-xs leading-snug">{{ err }}</span>
              </div>
            </div>
          </template>

          <template #cell:data="{ item, index }">
            <div class="min-w-0 text-xs">
              <!-- Compact summary: description + amount side by side -->
              <p class="text-muted-foreground truncate">
                {{ compactRowSummary(item.rawData) }}
              </p>
              <!-- Expand toggle -->
              <button
                type="button"
                class="text-primary-text/80 hover:text-primary-text mt-1 text-xs underline-offset-2 hover:underline"
                @click="toggleExpand(index)"
              >
                {{
                  expandedRows.has(index)
                    ? $t('pages.importExport.csvImport.review.collapse')
                    : $t('pages.importExport.csvImport.review.expand')
                }}
              </button>
              <!-- Full raw data (expanded) -->
              <pre
                v-if="expandedRows.has(index)"
                class="bg-muted/40 border-border mt-2 overflow-x-auto rounded border p-2 text-xs leading-relaxed break-all whitespace-pre-wrap"
                >{{ JSON.stringify(item.rawData, null, 2) }}</pre
              >
            </div>
          </template>

          <template #empty>
            {{ $t('pages.importExport.csvImport.review.noInvalidRows') }}
          </template>
        </MappingTable>
      </section>

      <!-- Duplicates table -->
      <section v-if="store.duplicates.length > 0" aria-labelledby="duplicates-heading">
        <h3 id="duplicates-heading" class="text-warning-text mb-1 text-sm font-semibold">
          {{
            $t('pages.importExport.csvImport.review.duplicatesTitle', {
              count: store.duplicates.length,
            })
          }}
        </h3>
        <p class="text-muted-foreground mb-3 text-xs">
          {{ $t('pages.importExport.csvImport.review.duplicatesHint') }}
          <DocsLink path="/import/import-from-csv/#how-duplicates-are-detected" />
        </p>

        <DuplicatesTable
          :duplicates="store.duplicates"
          :unmarked-indices="store.unmarkedDuplicateIndices"
          @toggle="store.toggleDuplicateUnmark"
        />
      </section>

      <!-- Unpriceable rows callout -->
      <section v-if="store.unpriceableRows.length > 0" aria-labelledby="unpriceable-heading">
        <Callout variant="warning" role="alert">
          <div class="flex-1 space-y-3">
            <div>
              <p id="unpriceable-heading" class="font-medium">
                {{
                  $t('pages.importExport.csvImport.review.unpriceableTitle', {
                    count: store.unpriceableRows.length,
                  })
                }}
              </p>
              <p class="mt-1 text-xs opacity-80">
                {{ $t('pages.importExport.csvImport.review.unpriceableDescription') }}
              </p>
            </div>

            <!-- Compact currency list -->
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="row in store.unpriceableRows"
                :key="row.rowIndex"
                class="bg-warning/10 border-warning/20 text-warning-text rounded border px-2 py-0.5 font-mono text-xs"
              >
                #{{ row.rowIndex }} · {{ row.currencyCode }}
              </span>
            </div>

            <!-- Skip-or-abort choice inline with the callout -->
            <div class="flex flex-wrap gap-2">
              <UiButton variant="default" size="sm" :disabled="store.isExecuting" @click="handleSkipAndImport">
                {{ $t('pages.importExport.csvImport.review.skipAndImport') }}
              </UiButton>
              <UiButton variant="outline" size="sm" @click="store.goBack()">
                {{ $t('pages.importExport.csvImport.review.cancelImport') }}
              </UiButton>
            </div>
          </div>
        </Callout>
      </section>

      <!-- Import summary line -->
      <div
        v-if="store.unpriceableRows.length === 0"
        class="bg-muted/30 border-border rounded-lg border px-4 py-3"
        aria-live="polite"
      >
        <p class="text-sm">
          <span class="text-success-text font-semibold">{{ store.importSummary.willImport }}</span>
          {{ $t('pages.importExport.csvImport.review.willBeImported') }}

          <template v-if="store.importSummary.invalidRows > 0">
            · <span class="text-destructive-text font-semibold">{{ store.importSummary.invalidRows }}</span>
            {{ $t('pages.importExport.csvImport.review.invalidWillBeSkipped') }}
          </template>

          <template v-if="store.importSummary.duplicates > 0">
            · <span class="text-warning-text font-semibold">{{ store.importSummary.duplicates }}</span>
            {{ $t('pages.importExport.csvImport.review.duplicatesWillBeSkipped') }}
          </template>
        </p>
      </div>

      <!-- Import error callout (execute-import enqueue failure) -->
      <Callout v-if="store.executeError" variant="destructive" role="alert">
        <p>{{ store.executeError }}</p>
      </Callout>

      <!-- Footer actions — hidden when the unpriceable consent panel is active (it has its own buttons) -->
      <div v-if="store.unpriceableRows.length === 0" class="flex items-center justify-between gap-3 pt-2">
        <UiButton variant="ghost" @click="store.goBack()">
          <ChevronLeftIcon class="size-4" />
          {{ $t('pages.importExport.csvImport.review.backToMapping') }}
        </UiButton>

        <UiButton :disabled="store.importSummary.willImport === 0 || store.isExecuting" @click="handleExecuteImport">
          <template v-if="store.isExecuting">
            <LoaderCircleIcon class="size-4 animate-spin" />
            {{ $t('pages.importExport.csvImport.review.importing') }}
          </template>
          <template v-else>
            {{
              $t('pages.importExport.csvImport.review.importButton', {
                count: store.importSummary.willImport,
              })
            }}
            <ChevronRightIcon class="size-4" />
          </template>
        </UiButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import DocsLink from '@/components/common/docs-link.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { MappingTable, type MappingTableColumn } from '@/components/lib/ui/mapping-table';
import { StatCard } from '@/components/lib/ui/stat-card';
import { StatusIndicator } from '@/components/lib/ui/status-indicator';
import { cn } from '@/lib/utils';
import BankSeamSkippedCallout from '@/pages/import-export/components/bank-seam-skipped-callout.vue';
import RecalculateBalanceToggle from '@/pages/import-export/components/recalculate-balance-toggle.vue';
import { useImportExportStore } from '@/stores/import-export';
import type { InvalidRow } from '@bt/shared/types';
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import DuplicatesTable from './duplicates-table.vue';

const { t } = useI18n();

const store = useImportExportStore();

// Trigger detection on mount when results haven't been computed yet.
// detectDuplicates() also advances to 'review' on success — if we're already
// here (re-render) and data exists, skip the call.
onMounted(async () => {
  const hasData =
    store.validRows.length > 0 ||
    store.invalidRows.length > 0 ||
    store.duplicates.length > 0 ||
    store.skippedAfterBankSeam > 0;

  if (!hasData && !store.isDetectingDuplicates) {
    try {
      await store.detectDuplicates();
    } catch {
      // Error is stored in store.detectError and rendered via Callout.
    }
  }
});

// --- Expanded row state for invalid rows ---
const expandedRows = ref<Set<number>>(new Set());

const toggleExpand = (index: number) => {
  if (expandedRows.value.has(index)) {
    expandedRows.value.delete(index);
  } else {
    expandedRows.value.add(index);
  }
};

// --- Column definitions ---
const invalidRowsColumns: MappingTableColumn[] = [
  { key: 'row', label: t('pages.importExport.csvImport.review.rowNumber'), width: '48px' },
  { key: 'problem', label: t('pages.importExport.csvImport.review.errors'), width: 'minmax(0,1.4fr)' },
  { key: 'data', label: t('pages.importExport.csvImport.review.rawData'), width: 'minmax(0,2fr)' },
];

/**
 * Builds a compact one-line summary from a raw CSV row for the invalid-rows
 * table Data cell. Shows description, amount, and date if present; falls back
 * to the first few key→value pairs.
 */
const compactRowSummary = (rawData: InvalidRow['rawData']): string => {
  const PREFERRED_KEYS = ['description', 'desc', 'note', 'memo', 'amount', 'date', 'transaction_date'];
  const parts: string[] = [];

  for (const key of PREFERRED_KEYS) {
    const val = rawData[key];
    if (val != null && val !== '') {
      parts.push(val);
      if (parts.length >= 3) break;
    }
  }

  if (parts.length === 0) {
    // No preferred keys found — use first few available values
    for (const val of Object.values(rawData)) {
      if (val != null && val !== '') {
        parts.push(val);
        if (parts.length >= 3) break;
      }
    }
  }

  return parts.join(' · ') || '—';
};

// --- Actions ---

// executeImport enqueues the async job and resolves once it's accepted (or sets
// store.executeError and returns on enqueue failure), so no try/catch is needed:
// any error surfaces via the executeError callout below.
const handleExecuteImport = async () => {
  await store.executeImport();
};

const handleSkipAndImport = async () => {
  const skipUnpriceableIndices = store.unpriceableRows.map((r) => r.rowIndex);
  await store.executeImport({ skipUnpriceableIndices });
};
</script>
