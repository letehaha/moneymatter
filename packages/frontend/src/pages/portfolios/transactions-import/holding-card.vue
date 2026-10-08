<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import SecuritySearchCell from '@/pages/portfolios/components/transactions-import/security-search-cell.vue';
import type { InvestmentImportHolding, InvestmentImportTransaction } from '@bt/shared/types/investments';
import { CircleDollarSignIcon, CoinsIcon, InfoIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue';

import HoldingTransactionsTable from './holding-transactions-table.vue';

const TOOLTIP_CLASS = 'max-w-xs';

type TransactionSide = InvestmentImportTransaction['side'];

defineProps<{
  holding: InvestmentImportHolding;
  blockedProviderSymbols: string[];
  currencyOptions: Array<{ value: string; label: string }>;
  sideOptions: Array<{ value: TransactionSide; label: string }>;
  skipTempIds: Set<string>;
  expanded: boolean;
  compact: boolean;
  isDuplicateSecurity: boolean;
  isValid: boolean;
  unskippedDuplicateCount: number;
  isTransactionValid: (tx: InvestmentImportTransaction) => boolean;
}>();

const emit = defineEmits<{
  (e: 'delete'): void;
  (e: 'toggle-expansion'): void;
  (e: 'toggle-skip-transaction', txTempId: string): void;
  (e: 'delete-transaction', txTempId: string): void;
}>();
</script>

<template>
  <Card
    :class="[
      'overflow-hidden p-0',
      !isValid || isDuplicateSecurity ? 'border-destructive-text/60 ring-destructive-text/20 ring-1' : '',
    ]"
  >
    <div
      class="grid grid-cols-1 gap-3 p-4 @md/import:grid-cols-[minmax(0,250px)_160px_minmax(0,1fr)_auto] @md/import:items-center"
    >
      <!-- Security cell (with label on mobile) -->
      <div class="@md/import:hidden">
        <label class="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase">
          <CoinsIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.security') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.security')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </label>
        <SecuritySearchCell
          :model-value="holding.resolvedSecurity"
          :parsed-symbol="holding.parsedSymbol"
          :blocked-provider-symbols="blockedProviderSymbols"
          @update:model-value="(val) => (holding.resolvedSecurity = val)"
        />
      </div>
      <div class="hidden @md/import:block">
        <SecuritySearchCell
          :model-value="holding.resolvedSecurity"
          :parsed-symbol="holding.parsedSymbol"
          :blocked-provider-symbols="blockedProviderSymbols"
          @update:model-value="(val) => (holding.resolvedSecurity = val)"
        />
      </div>

      <!-- Currency cell -->
      <div class="@md/import:hidden">
        <label class="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase">
          <CircleDollarSignIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.currency') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.currency')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </label>
        <SelectField
          :model-value="(holding.currencyCode && currencyOptions.find((o) => o.value === holding.currencyCode)) || null"
          :values="currencyOptions"
          with-search
          :placeholder="$t('investmentsImport.review.pickCurrency')"
          :class="[holding.currencyCode ? '' : '[&_button]:border-destructive-text']"
          @update:model-value="(opt) => (holding.currencyCode = opt?.value ?? null)"
        />
      </div>
      <div class="hidden @md/import:block">
        <SelectField
          :model-value="(holding.currencyCode && currencyOptions.find((o) => o.value === holding.currencyCode)) || null"
          :values="currencyOptions"
          with-search
          :placeholder="$t('investmentsImport.review.pickCurrency')"
          :class="[holding.currencyCode ? '' : '[&_button]:border-destructive-text']"
          @update:model-value="(opt) => (holding.currencyCode = opt?.value ?? null)"
        />
      </div>

      <!-- Txn count + dup warning -->
      <div class="flex items-center gap-2 @md/import:justify-end">
        <DesktopOnlyTooltip
          v-if="unskippedDuplicateCount > 0"
          :content="
            $t('investmentsImport.review.tooltips.parentRowDuplicates', unskippedDuplicateCount, {
              named: { count: unskippedDuplicateCount },
            })
          "
          :content-class-name="TOOLTIP_CLASS"
        >
          <span
            class="bg-warning/15 text-warning-text inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          >
            <TriangleAlertIcon class="size-3.5" />
            {{ unskippedDuplicateCount }}
          </span>
        </DesktopOnlyTooltip>
        <span class="text-muted-foreground text-sm whitespace-nowrap">
          {{
            $t('investmentsImport.review.txns', holding.transactions.length, {
              named: { count: holding.transactions.length },
            })
          }}
        </span>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" @click="emit('toggle-expansion')">
          {{ expanded ? $t('investmentsImport.review.collapse') : $t('investmentsImport.review.expand') }}
        </Button>
        <DesktopOnlyTooltip :content="$t('investmentsImport.review.deleteHolding')">
          <Button variant="ghost-destructive" size="icon-sm" @click="emit('delete')">
            <Trash2Icon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <!-- Status hints -->
    <div v-if="holding.hasExistingHolding || isDuplicateSecurity" class="border-t px-4 py-2 text-sm">
      <div v-if="holding.hasExistingHolding" class="text-muted-foreground">
        {{ $t('investmentsImport.review.willMerge') }}
      </div>
      <div v-if="isDuplicateSecurity" class="text-destructive-text">
        {{ $t('investmentsImport.review.duplicateSecurity') }}
      </div>
    </div>

    <HoldingTransactionsTable
      v-if="expanded"
      :transactions="holding.transactions"
      :skip-temp-ids="skipTempIds"
      :side-options="sideOptions"
      :is-transaction-valid="isTransactionValid"
      :compact="compact"
      @toggle-skip="(txTempId) => emit('toggle-skip-transaction', txTempId)"
      @delete-transaction="(txTempId) => emit('delete-transaction', txTempId)"
    />
  </Card>
</template>
