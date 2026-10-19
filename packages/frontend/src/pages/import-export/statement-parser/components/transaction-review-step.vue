<template>
  <div class="space-y-6">
    <!-- Loading State -->
    <div v-if="store.isDetectingDuplicates" class="flex items-center justify-center gap-2 py-8">
      <Loader2Icon class="text-primary-text size-6 animate-spin" />
      <span>{{ $t('pages.statementParser.transactionReview.checkingDuplicates') }}</span>
    </div>

    <template v-else>
      <!-- A failed check and a clean statement both show zero duplicates, so say which one it is. -->
      <Callout v-if="store.duplicateDetectionError" variant="warning">
        {{ $t('pages.statementParser.transactionReview.duplicateCheckFailed') }}
      </Callout>

      <!-- Summary Stats -->
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.transactionReview.extractedLabel') }}</span>
          <span class="font-semibold">{{ store.importSummary.total }}</span>
          <span v-if="showSources" class="text-muted-foreground">
            {{ $t('pages.statementParser.transactionReview.fromFiles', { count: store.importSummary.files }) }}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.transactionReview.duplicatesLabel') }}</span>
          <span class="text-warning-text font-semibold">{{ store.importSummary.duplicates }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground">{{ $t('pages.statementParser.transactionReview.willImportLabel') }}</span>
          <span class="text-app-income-color font-semibold">{{ store.importSummary.toImport }}</span>
        </div>
        <div v-if="existingTransactionsCount > 0" class="flex items-center gap-2">
          <span class="text-muted-foreground">{{
            $t('pages.statementParser.transactionReview.alreadyInAccountLabel')
          }}</span>
          <span class="text-muted-foreground font-semibold">{{ existingTransactionsCount }}</span>
        </div>
      </div>

      <!-- Transaction Timeline -->
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <h3 class="text-sm font-medium">{{ $t('pages.statementParser.transactionReview.timelineTitle') }}</h3>
          <div class="flex items-center gap-3 text-xs">
            <div class="flex items-center gap-1">
              <div class="bg-success/30 ring-success-text size-2 rounded-full ring-1"></div>
              <span class="text-muted-foreground">{{ $t('pages.statementParser.transactionReview.legendNew') }}</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="bg-warning/30 ring-warning size-2 rounded-full ring-1"></div>
              <span class="text-muted-foreground">{{
                $t('pages.statementParser.transactionReview.legendDuplicate')
              }}</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="bg-muted ring-border size-2 rounded-full ring-1"></div>
              <span class="text-muted-foreground">{{
                $t('pages.statementParser.transactionReview.legendExisting')
              }}</span>
            </div>
          </div>
        </div>
        <p class="text-muted-foreground pb-2 text-xs">
          {{ $t('pages.statementParser.transactionReview.toggleInfo') }}
        </p>

        <ScrollArea class="max-h-80 rounded-lg border" viewport-class="max-h-80" with-horizontal-scrollbar>
          <div class="min-w-max">
            <div
              v-for="(item, index) in timelineItems"
              :key="`${item.type}-${index}`"
              class="border-b last:border-b-0"
              :class="[
                item.type === 'new' && !item.isExcluded && 'bg-success/10',
                item.type === 'duplicate' && !item.isOverridden && 'bg-warning/10',
                item.type === 'duplicate' && item.isOverridden && 'bg-success/10',
                item.type === 'existing' && 'bg-muted/50',
                item.isExcluded && 'opacity-50',
                item.type !== 'existing' && 'hover:bg-muted/30 cursor-pointer',
              ]"
              @click="handleRowClick(item)"
            >
              <div class="flex items-center gap-2 px-2 py-1.5">
                <!-- Stop propagation so a direct checkbox click toggles once rather than also firing the row's @click. -->
                <span class="inline-flex w-4 shrink-0" @click.stop>
                  <Checkbox
                    v-if="item.type !== 'existing'"
                    :model-value="item.type === 'new' ? !item.isExcluded : item.isOverridden"
                    :aria-label="item.description"
                    @update:model-value="handleRowClick(item)"
                  />
                </span>

                <!-- Status Indicator -->
                <div
                  class="size-2 shrink-0 rounded-full ring-1"
                  :class="{
                    'ring-success-text bg-success/30':
                      item.type === 'new' || (item.type === 'duplicate' && item.isOverridden),
                    'bg-warning/30 ring-warning': item.type === 'duplicate' && !item.isOverridden,
                    'bg-muted ring-border': item.type === 'existing',
                  }"
                ></div>

                <!-- Date -->
                <span class="text-muted-foreground w-20 shrink-0 text-xs">{{ item.date }}</span>

                <!-- Type Badge -->
                <span
                  class="w-16 shrink-0 rounded px-1 py-0.5 text-center text-xs"
                  :class="{
                    'text-success-text bg-success/40': item.txType === 'income',
                    'bg-destructive/20 text-destructive-text': item.txType === 'expense',
                  }"
                >
                  {{ item.txType }}
                </span>

                <!-- Description -->
                <span class="max-w-75 min-w-0 flex-1 truncate text-xs">{{ item.description }}</span>

                <!-- Source statement -->
                <span
                  v-if="showSources"
                  class="text-muted-foreground w-32 shrink-0 truncate text-xs"
                  :title="item.sourceFile"
                >
                  {{ item.sourceFile }}
                </span>

                <!-- Status Badge -->
                <span
                  v-if="item.type === 'duplicate' && !item.isOverridden"
                  class="bg-warning/20 text-warning-text shrink-0 rounded px-1 py-0.5 text-xs"
                >
                  {{ $t('pages.statementParser.transactionReview.statusDup') }}
                </span>
                <span
                  v-else-if="item.type === 'duplicate' && item.isOverridden"
                  class="text-success-text bg-success/30 shrink-0 rounded px-1 py-0.5 text-xs"
                >
                  {{ $t('pages.statementParser.transactionReview.statusImport') }}
                </span>
                <span
                  v-else-if="item.type === 'existing'"
                  class="bg-muted text-muted-foreground shrink-0 rounded px-1 py-0.5 text-xs"
                >
                  {{ $t('pages.statementParser.transactionReview.statusExists') }}
                </span>

                <!-- Amount -->
                <span
                  class="ml-auto w-24 shrink-0 text-right font-mono text-xs font-medium"
                  :class="item.txType === 'expense' ? 'text-app-expense-color' : 'text-app-income-color'"
                >
                  {{ item.txType === 'expense' ? '-' : '+' }}{{ item.amount.toFixed(2) }}
                  <span v-if="item.originalAmount" class="text-muted-foreground block text-[10px] font-normal">
                    {{ item.originalAmount }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <!-- Duplicate Action Info -->
      <div v-if="store.duplicates.length > 0" class="bg-muted/50 rounded-lg p-4 text-sm">
        <p class="text-muted-foreground">
          {{
            $t('pages.statementParser.transactionReview.duplicateInfoSkipped', {
              count: store.importSummary.duplicates - store.importSummary.overridden,
            })
          }}
          <span v-if="store.importSummary.overridden > 0">
            {{
              $t('pages.statementParser.transactionReview.duplicateInfoOverridden', {
                count: store.importSummary.overridden,
              })
            }}
          </span>
        </p>
      </div>

      <!-- Navigation Buttons -->
      <div class="flex gap-3">
        <Button variant="outline" @click="handleBack">
          <ArrowLeftIcon class="size-4" />
          {{ $t('pages.statementParser.transactionReview.backButton') }}
        </Button>
        <Button class="flex-1" @click="handleProceed" :disabled="store.importSummary.toImport === 0">
          {{ $t('pages.statementParser.transactionReview.continueButton') }}
          <span class="max-sm:hidden">
            {{
              $t('pages.statementParser.transactionReview.transactionCount', { count: store.importSummary.toImport })
            }}
          </span>
        </Button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useStatementParserStore } from '@/stores/statement-parser';
import { ArrowLeftIcon, Loader2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStatementParserStore();

// Count existing transactions that are not duplicates
const existingTransactionsCount = computed(() => {
  const duplicateExistingIds = new Set(store.duplicates.map((d) => d.existingTransaction.id));
  return store.existingTransactions.filter((tx) => !duplicateExistingIds.has(tx.id)).length;
});

interface TimelineItem {
  type: 'new' | 'duplicate' | 'existing';
  transactionIndex: number;
  /** For existing transactions, this is the actual transaction ID */
  existingId?: string;
  date: string;
  description: string;
  amount: number;
  txType: 'income' | 'expense';
  /** e.g. "12.99 USD" when the purchase was made in another currency */
  originalAmount?: string;
  /** Statement the row was extracted from. Unset for single-file imports and for existing rows. */
  sourceFile?: string;
  existingNote?: string;
  isExcluded?: boolean;
  isOverridden?: boolean;
}

const showSources = computed(() => store.importSummary.files > 1);

const timelineItems = computed((): TimelineItem[] => {
  if (!store.mergedTransactions.length) return [];

  const items: TimelineItem[] = [];
  const duplicateMap = new Map(store.duplicates.map((d) => [d.transactionIndex, d]));

  // Get the set of existing transaction IDs that are matched as duplicates
  // to avoid showing them twice (once as duplicate, once as existing)
  const duplicateExistingIds = new Set(store.duplicates.map((d) => d.existingTransaction.id));

  // Add extracted transactions (new and duplicates). `index` is a position in the
  // merged list — the same index space the store's duplicate/exclusion sets and
  // the backend's `transactionIndex` use, so it can be passed straight through.
  store.mergedTransactions.forEach((tx, index) => {
    const duplicate = duplicateMap.get(index);
    const isExcluded = store.excludedTransactionIndices.has(index);
    const isOverridden = store.overriddenDuplicateIndices.has(index);
    const sourceFile = showSources.value ? store.transactionSources[index] : undefined;
    const originalAmount =
      tx.originalAmount !== undefined && tx.originalCurrencyCode
        ? `${tx.originalAmount.toFixed(2)} ${tx.originalCurrencyCode}`
        : undefined;

    if (duplicate) {
      items.push({
        type: 'duplicate',
        transactionIndex: index,
        date: tx.date.split(' ')[0]!,
        description: tx.description,
        amount: tx.amount,
        txType: tx.type,
        originalAmount,
        sourceFile,
        existingNote: duplicate.existingTransaction.note,
        isOverridden,
      });
    } else {
      items.push({
        type: 'new',
        transactionIndex: index,
        date: tx.date.split(' ')[0]!,
        description: tx.description,
        amount: tx.amount,
        txType: tx.type,
        originalAmount,
        sourceFile,
        isExcluded,
      });
    }
  });

  // Add existing transactions from the account (excluding those already shown as duplicates)
  store.existingTransactions.forEach((tx) => {
    // Skip if this existing transaction is already shown as a duplicate match
    if (duplicateExistingIds.has(tx.id)) return;

    const txDate = new Date(tx.time);
    const dateStr = txDate.toISOString().split('T')[0]!;

    items.push({
      type: 'existing',
      transactionIndex: -1, // Not applicable for existing transactions
      existingId: tx.id,
      date: dateStr,
      description: tx.note || t('pages.statementParser.transactionReview.noDescription'),
      amount: Math.abs(tx.amount),
      txType: tx.transactionType,
    });
  });

  // Sort by date (newest first)
  items.sort((a, b) => b.date.localeCompare(a.date));

  return items;
});

function handleRowClick(item: TimelineItem) {
  if (item.type === 'new') {
    store.toggleTransactionExclusion({ transactionIndex: item.transactionIndex });
  } else if (item.type === 'duplicate') {
    store.toggleDuplicateOverride({ transactionIndex: item.transactionIndex });
  }
}

function handleBack() {
  store.goBack();
}

function handleProceed() {
  store.proceedToImport();
}
</script>
