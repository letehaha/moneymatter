<script setup lang="ts">
import { executeInvestmentImport } from '@/api/investment-transactions-import';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useAllCurrencies } from '@/composable/data-queries/currencies';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { extractApiErrorMessage } from '@/js/errors';
import {
  type InvestmentImportHolding,
  type InvestmentImportTransaction,
  type InvestmentImportWarning,
  isCashInCategory,
} from '@bt/shared/types/investments';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { CircleDollarSignIcon, CoinsIcon, InfoIcon, Loader2Icon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import HoldingCard from './holding-card.vue';
import { formatInvestmentImportWarning } from './import-warning-message';

const TOOLTIP_CLASS = 'max-w-xs';

const props = defineProps<{
  portfolioId: string;
  initialHoldings: InvestmentImportHolding[];
  initialWarnings: InvestmentImportWarning[];
}>();

const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'imported'): void;
}>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const queryClient = useQueryClient();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const holdings = ref<InvestmentImportHolding[]>(
  props.initialHoldings.map((h) => ({ ...h, transactions: h.transactions.map((tx) => ({ ...tx })) })),
);
const warningMessages = computed(() =>
  props.initialWarnings.map((warning) => formatInvestmentImportWarning({ warning, t })),
);
const skipTempIds = ref<Set<string>>(new Set());
const expandedHoldings = ref<Set<string>>(new Set());

const { data: allCurrencies } = useAllCurrencies();

const currencyOptions = computed(() => {
  const list = allCurrencies.value ?? [];
  return list.map((c) => ({ value: c.code, label: c.code }));
});

type TransactionSide = InvestmentImportTransaction['side'];
const sideOptions = computed<Array<{ value: TransactionSide; label: string }>>(() => [
  { value: 'buy', label: t('investmentsImport.review.buy') },
  { value: 'sell', label: t('investmentsImport.review.sell') },
  { value: 'dividend', label: t('investmentsImport.categories.dividend') },
]);

function blockedProviderSymbolsForHolding(currentTempId: string): string[] {
  return holdings.value
    .filter((h) => h.tempId !== currentTempId && h.resolvedSecurity)
    .map((h) => h.resolvedSecurity!.providerSymbol);
}

function isTransactionValid(tx: InvestmentImportTransaction): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) return false;
  const qty = Number(tx.quantity);
  const price = Number(tx.price);
  const fees = Number(tx.fees);
  if (!Number.isFinite(qty) || qty <= 0) return false;
  // Zero price is legitimate for staking rewards, airdrops, balance adjustments,
  // burns/lost-token writeoffs — they are real position changes with no cash
  // consideration. The source's BUY/SELL classification is authoritative.
  if (!Number.isFinite(price) || price < 0) return false;
  if (!Number.isFinite(fees) || fees < 0) return false;
  if (isCashInCategory({ category: tx.side }) && fees > qty * price) return false;
  return tx.side === 'buy' || tx.side === 'sell' || tx.side === 'dividend';
}

function isHoldingValid(h: InvestmentImportHolding): boolean {
  if (!h.resolvedSecurity) return false;
  if (!h.currencyCode) return false;
  if (!h.portfolioId) return false;
  if (h.transactions.length === 0) return false;
  return h.transactions.every(isTransactionValid);
}

const duplicateSecurityRows = computed(() => {
  const counts = new Map<string, string[]>();
  for (const h of holdings.value) {
    const key = h.resolvedSecurity?.providerSymbol;
    if (!key) continue;
    const list = counts.get(key);
    if (list) list.push(h.tempId);
    else counts.set(key, [h.tempId]);
  }
  const offending = new Set<string>();
  for (const list of counts.values()) {
    if (list.length > 1) for (const id of list) offending.add(id);
  }
  return offending;
});

const allValid = computed(
  () => holdings.value.length > 0 && holdings.value.every(isHoldingValid) && duplicateSecurityRows.value.size === 0,
);

function computeAmount(tx: InvestmentImportTransaction): string {
  const qty = Number(tx.quantity || '0');
  const price = Number(tx.price || '0');
  const fees = Number(tx.fees || '0');
  if (!Number.isFinite(qty) || !Number.isFinite(price) || !Number.isFinite(fees)) return '0';
  return (isCashInCategory({ category: tx.side }) ? qty * price - fees : qty * price + fees).toFixed(10);
}

watch(
  holdings,
  (list) => {
    for (const h of list) {
      for (const tx of h.transactions) tx.amount = computeAmount(tx);
    }
  },
  { deep: true },
);

function deleteHolding(tempId: string) {
  holdings.value = holdings.value.filter((h) => h.tempId !== tempId);
}

function deleteTransaction(holdingTempId: string, txTempId: string) {
  const holding = holdings.value.find((h) => h.tempId === holdingTempId);
  if (!holding) return;
  holding.transactions = holding.transactions.filter((tx) => tx.tempId !== txTempId);
  if (holding.transactions.length === 0) deleteHolding(holdingTempId);
}

function toggleSkipDuplicate(tempId: string) {
  const next = new Set(skipTempIds.value);
  if (next.has(tempId)) next.delete(tempId);
  else next.add(tempId);
  skipTempIds.value = next;
}

function toggleHoldingExpansion(tempId: string) {
  const next = new Set(expandedHoldings.value);
  if (next.has(tempId)) next.delete(tempId);
  else next.add(tempId);
  expandedHoldings.value = next;
}

function unskippedDuplicateCount(h: InvestmentImportHolding): number {
  let count = 0;
  for (const tx of h.transactions) {
    if (tx.possibleDuplicateOf && !skipTempIds.value.has(tx.tempId)) count += 1;
  }
  return count;
}

const execute = useMutation({
  mutationFn: () =>
    executeInvestmentImport({
      holdings: holdings.value,
      skipTempIds: Array.from(skipTempIds.value),
    }),
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.holdingsList });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioInvestmentTransactions });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummary });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.portfolioBalances });
    addNotification({
      text: t('investmentsImport.notifications.imported', { count: result.createdTransactions }),
      type: NotificationType.success,
    });

    // Surface the partial-import counters and warnings the backend already
    // builds. Without this the toast says "Imported N transactions" while
    // silently dropping N skippedHoldings / failedTransactions / warning
    // strings, leaving the user to wonder why their import shrank.
    const hadIssues = result.skippedHoldings > 0 || result.failedTransactions > 0 || (result.warnings?.length ?? 0) > 0;
    if (hadIssues) {
      const lines: string[] = [];
      if (result.skippedHoldings > 0) {
        lines.push(t('investmentsImport.notifications.skippedHoldings', { count: result.skippedHoldings }));
      }
      if (result.failedTransactions > 0) {
        lines.push(t('investmentsImport.notifications.failedTransactions', { count: result.failedTransactions }));
      }
      for (const warning of result.warnings ?? []) lines.push(formatInvestmentImportWarning({ warning, t }));
      addNotification({
        text: lines.join('\n'),
        type: NotificationType.warning,
      });
    }

    emit('imported');
  },
  onError: (err: Error) => {
    addNotification({
      text: extractApiErrorMessage(err) || t('investmentsImport.notifications.importFailed'),
      type: NotificationType.error,
    });
  },
});
</script>

<template>
  <div class="space-y-4">
    <Callout v-if="warningMessages.length > 0" :title="$t('investmentsImport.review.warningsTitle')">
      <ul class="list-disc space-y-0.5 pl-5">
        <li v-for="(w, i) in warningMessages" :key="i">{{ w }}</li>
      </ul>
    </Callout>

    <div v-if="holdings.length === 0" class="text-muted-foreground py-10 text-center text-sm">
      {{ $t('investmentsImport.review.empty') }}
    </div>

    <template v-else>
      <div
        class="text-muted-foreground hidden gap-3 px-4 text-xs font-medium tracking-wider uppercase @md/import:grid @md/import:grid-cols-[1fr_160px_140px_180px]"
      >
        <div class="flex items-center gap-1.5">
          <CoinsIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.security') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.security')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </div>
        <div class="flex items-center gap-1.5">
          <CircleDollarSignIcon class="size-3.5" />
          {{ $t('investmentsImport.review.cols.currency') }}
          <DesktopOnlyTooltip
            :content="$t('investmentsImport.review.tooltips.currency')"
            :content-class-name="TOOLTIP_CLASS"
          >
            <InfoIcon class="size-3.5" />
          </DesktopOnlyTooltip>
        </div>
        <div class="text-right">{{ $t('investmentsImport.review.cols.txCount') }}</div>
        <div></div>
      </div>

      <HoldingCard
        v-for="holding in holdings"
        :key="holding.tempId"
        :holding="holding"
        :blocked-provider-symbols="blockedProviderSymbolsForHolding(holding.tempId)"
        :currency-options="currencyOptions"
        :side-options="sideOptions"
        :skip-temp-ids="skipTempIds"
        :expanded="expandedHoldings.has(holding.tempId)"
        :compact="isMobile"
        :is-duplicate-security="duplicateSecurityRows.has(holding.tempId)"
        :is-valid="isHoldingValid(holding)"
        :unskipped-duplicate-count="unskippedDuplicateCount(holding)"
        :is-transaction-valid="isTransactionValid"
        @delete="deleteHolding(holding.tempId)"
        @toggle-expansion="toggleHoldingExpansion(holding.tempId)"
        @toggle-skip-transaction="toggleSkipDuplicate"
        @delete-transaction="(txTempId) => deleteTransaction(holding.tempId, txTempId)"
      />
    </template>

    <div class="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
      <Button variant="outline" @click="emit('back')">{{ $t('investmentsImport.review.back') }}</Button>
      <Button :disabled="!allValid || execute.isPending.value" @click="execute.mutate()">
        <Loader2Icon v-if="execute.isPending.value" class="mr-1 size-4 animate-spin" />
        {{ $t('investmentsImport.review.commit') }}
      </Button>
    </div>
  </div>
</template>
