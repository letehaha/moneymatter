<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { formatUIAmount } from '@/js/helpers';
import { useAccountsStore } from '@/stores';
import type { TransactionModel, BulkTransferScanItem, BulkTransferScanMatch } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { useLocalStorage } from '@vueuse/core';
import { format } from 'date-fns';
import { ArrowDownIcon, ArrowRightIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import SuggestionMatchRow from './suggestion-match-row.vue';

const SKIP_DIALOG_SUPPRESSED_KEY = 'optimizations-skip-dialog-suppressed';

const props = defineProps<{
  selectedItem: BulkTransferScanItem | null;
  isLinking: boolean;
  isSkipping: boolean;
}>();

const emit = defineEmits<{
  link: [{ expenseId: string; incomeId: string }];
  skip: [{ expenseId: string; incomeId: string }];
  'record-click': [value: TransactionModel, oppositeTx: TransactionModel | undefined];
}>();

const { accountsRecord } = storeToRefs(useAccountsStore());

// Link confirmation
const confirmDialogOpen = ref(false);
const selectedMatch = ref<BulkTransferScanMatch | null>(null);

function handleLinkClick(match: BulkTransferScanMatch) {
  selectedMatch.value = match;
  confirmDialogOpen.value = true;
}

function handleConfirmLink() {
  if (!props.selectedItem || !selectedMatch.value) return;
  emit('link', {
    expenseId: props.selectedItem.expense.id,
    incomeId: selectedMatch.value.transaction.id,
  });
  confirmDialogOpen.value = false;
  selectedMatch.value = null;
}

// Skip confirmation
const skipDialogOpen = ref(false);
const matchToSkip = ref<BulkTransferScanMatch | null>(null);
const skipDialogSuppressed = useLocalStorage(SKIP_DIALOG_SUPPRESSED_KEY, false);
const dontShowSkipAgain = ref(false);

function handleSkipClick(match: BulkTransferScanMatch) {
  if (skipDialogSuppressed.value) {
    executeSkip(match);
    return;
  }
  matchToSkip.value = match;
  dontShowSkipAgain.value = false;
  skipDialogOpen.value = true;
}

function executeSkip(match: BulkTransferScanMatch) {
  if (!props.selectedItem) return;
  emit('skip', {
    expenseId: props.selectedItem.expense.id,
    incomeId: match.transaction.id,
  });
}

function handleConfirmSkip() {
  if (!matchToSkip.value) return;
  if (dontShowSkipAgain.value) {
    skipDialogSuppressed.value = true;
  }
  executeSkip(matchToSkip.value);
  skipDialogOpen.value = false;
  matchToSkip.value = null;
}

function handleTransactionRecordClick([tx, oppositeTx]: [TransactionModel, TransactionModel | undefined]) {
  emit('record-click', tx, oppositeTx);
}

function handleMatchRecordClick(tx: TransactionModel, oppositeTx: TransactionModel | undefined) {
  emit('record-click', tx, oppositeTx);
}

// Transfer preview data for the link confirmation dialog
const previewExpenseAccount = computed(
  () => props.selectedItem && accountsRecord.value[props.selectedItem.expense.accountId],
);
const previewIncomeAccount = computed(
  () => selectedMatch.value && accountsRecord.value[selectedMatch.value.transaction.accountId],
);
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <template v-if="selectedItem">
      <div class="xs:px-4 border-b px-2 py-3">
        <div class="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
          {{ $t('optimizations.transferSuggestions.suggestionsFor') }}
        </div>
        <TransactionRecord
          :key="selectedItem.expense.id"
          class="max-w-100"
          :tx="selectedItem.expense as TransactionModel"
          @record-click="handleTransactionRecordClick"
        />
      </div>

      <ScrollArea class="min-h-0 flex-1">
        <div class="max-xs:px-2 grid gap-2 p-4">
          <SuggestionMatchRow
            v-for="match in selectedItem.matches"
            :key="match.transaction.id"
            :match="match"
            :is-linking="isLinking"
            :is-skipping="isSkipping"
            @link="handleLinkClick(match)"
            @skip="handleSkipClick(match)"
            @record-click="handleMatchRecordClick"
          />
        </div>
      </ScrollArea>
    </template>

    <template v-else>
      <div class="text-muted-foreground flex flex-1 items-center justify-center p-8 text-center text-sm">
        {{ $t('optimizations.transferSuggestions.selectExpense') }}
      </div>
    </template>
  </div>

  <!-- Link confirmation dialog -->
  <ResponsiveAlertDialog
    v-model:open="confirmDialogOpen"
    :confirm-label="$t('common.actions.link')"
    :confirm-disabled="isLinking"
    @confirm="handleConfirmLink"
  >
    <template #title>{{ $t('optimizations.transferSuggestions.confirmLink.title') }}</template>
    <template #description>
      <p class="text-muted-foreground text-sm">
        {{ $t('optimizations.transferSuggestions.confirmLink.description') }}
      </p>
      <div v-if="selectedItem && selectedMatch" class="mt-3 grid gap-2">
        <!-- Expense -->
        <div class="bg-muted/50 rounded-md border p-1">
          <TransactionRecord
            :key="`confirm-expense-${selectedItem.expense.id}`"
            :tx="selectedItem.expense as TransactionModel"
            :as-button="false"
          />
        </div>

        <!-- Plus sign -->
        <div class="text-muted-foreground text-center text-sm font-medium">+</div>

        <!-- Income -->
        <div class="bg-muted/50 rounded-md border p-1">
          <TransactionRecord
            :key="`confirm-income-${selectedMatch.transaction.id}`"
            :tx="selectedMatch.transaction as TransactionModel"
            :as-button="false"
          />
        </div>

        <!-- Arrow down -->
        <div class="flex justify-center">
          <ArrowDownIcon class="text-muted-foreground size-5" />
        </div>

        <!-- Preview: resulting transfer -->
        <div class="bg-muted/50 rounded-md border px-3 py-2">
          <div class="flex items-center gap-2 text-sm">
            <span class="text-app-transfer-color font-medium">
              {{ previewExpenseAccount?.name }}
            </span>
            <ArrowRightIcon class="text-muted-foreground size-3.5 shrink-0" />
            <span class="text-app-transfer-color font-medium">
              {{ previewIncomeAccount?.name }}
            </span>
          </div>
          <div class="mt-1 flex items-center gap-3 text-sm">
            <span class="text-app-expense-color">
              {{
                formatUIAmount(-Math.abs(selectedItem.expense.amount), {
                  currency: selectedItem.expense.currencyCode,
                })
              }}
            </span>
            <ArrowRightIcon class="text-muted-foreground size-3 shrink-0" />
            <span class="text-app-income-color">
              {{
                formatUIAmount(Math.abs(selectedMatch.transaction.amount), {
                  currency: selectedMatch.transaction.currencyCode,
                })
              }}
            </span>
            <span class="text-muted-foreground ml-auto text-xs">
              {{ format(new Date(selectedItem.expense.time), 'd MMM y') }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </ResponsiveAlertDialog>

  <!-- Skip confirmation dialog -->
  <ResponsiveAlertDialog
    v-model:open="skipDialogOpen"
    :confirm-label="$t('optimizations.transferSuggestions.skip.action')"
    @confirm="handleConfirmSkip"
  >
    <template #title>{{ $t('optimizations.transferSuggestions.skip.title') }}</template>
    <template #description>
      <p class="text-muted-foreground text-sm">
        {{ $t('optimizations.transferSuggestions.skip.description') }}
      </p>
      <label class="mt-4 flex cursor-pointer items-center gap-2">
        <Checkbox v-model="dontShowSkipAgain" />
        <span class="text-sm">{{ $t('optimizations.transferSuggestions.skip.dontShowAgain') }}</span>
      </label>
    </template>
  </ResponsiveAlertDialog>
</template>
