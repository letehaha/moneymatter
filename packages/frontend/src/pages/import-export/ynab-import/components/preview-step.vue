<template>
  <div v-if="parsed" class="space-y-4">
    <div v-if="parsed.dateRange" class="text-muted-foreground text-sm">
      {{
        $t('pages.importExport.ynabImport.preview.dateRange', {
          from: formatDate(parsed.dateRange.from),
          to: formatDate(parsed.dateRange.to),
        })
      }}
    </div>

    <PillTabs v-model="activeTab" :items="tabItems" size="default" />

    <!-- Accounts. Cached across tab switches so the currency-picker rows
         (SelectField with searchable currency list) don't re-mount every
         time the user revisits this tab. Other tabs stay v-if'd since
         they're cheap to mount and would just hold DOM for nothing. -->
    <KeepAlive>
      <AccountsTab v-if="activeTab === 'accounts'" :accounts="parsed.accounts" :currency-options="currencyOptions" />
    </KeepAlive>

    <!-- Categories -->
    <div v-if="activeTab === 'categories'" :class="cn('border-border rounded-md border', LIST_HEIGHT_CLASS)">
      <EmptyList v-if="parsed.categories.length === 0" />
      <VirtualList
        v-else
        :items="parsed.categories"
        container-class="h-full"
        :estimate-size="40"
        :get-item-key="(cat) => cat.fullName"
      >
        <template #default="{ item: cat, index }">
          <div
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            :class="index > 0 ? 'border-border border-t' : ''"
          >
            <div class="min-w-0 truncate">
              <span class="text-muted-foreground">{{ cat.groupName }}</span>
              <ChevronRightIcon class="text-muted-foreground mx-1 inline size-3 align-[-1px]" />
              <span class="font-medium">{{ cat.categoryName }}</span>
            </div>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{
                $t('pages.importExport.ynabImport.accountRow.transactionsCount', {
                  count: cat.transactionCount,
                })
              }}
            </span>
          </div>
        </template>
      </VirtualList>
    </div>

    <!-- Payees -->
    <div v-if="activeTab === 'payees'" :class="cn('border-border rounded-md border', LIST_HEIGHT_CLASS)">
      <EmptyList v-if="parsed.payees.length === 0" />
      <VirtualList
        v-else
        :items="parsed.payees"
        container-class="h-full"
        :estimate-size="40"
        :get-item-key="(p) => p.name"
      >
        <template #default="{ item: p, index }">
          <div
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            :class="index > 0 ? 'border-border border-t' : ''"
          >
            <span class="min-w-0 truncate font-medium">{{ p.name }}</span>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{
                $t('pages.importExport.ynabImport.accountRow.transactionsCount', {
                  count: p.transactionCount,
                })
              }}
            </span>
          </div>
        </template>
      </VirtualList>
    </div>

    <!-- Tags -->
    <div v-if="activeTab === 'tags'" :class="cn('border-border rounded-md border', LIST_HEIGHT_CLASS)">
      <EmptyList v-if="parsed.tagsUsed.length === 0" />
      <VirtualList
        v-else
        :items="parsed.tagsUsed"
        container-class="h-full"
        :estimate-size="40"
        :get-item-key="(t) => t.color"
      >
        <template #default="{ item: t, index }">
          <div
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            :class="index > 0 ? 'border-border border-t' : ''"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span
                class="inline-block size-3 shrink-0 rounded-full"
                :style="{ backgroundColor: YNAB_FLAG_HEX[t.color] }"
              />
              <span class="truncate font-medium">YNAB {{ capitalize(t.color) }}</span>
            </div>
            <span class="text-muted-foreground shrink-0 text-xs">
              {{
                $t('pages.importExport.ynabImport.accountRow.transactionsCount', {
                  count: t.transactionCount,
                })
              }}
            </span>
          </div>
        </template>
      </VirtualList>
    </div>

    <!-- Transactions -->
    <div v-if="activeTab === 'transactions'" :class="cn('border-border rounded-md border', LIST_HEIGHT_CLASS)">
      <EmptyList v-if="parsed.transactions.length === 0" />
      <VirtualList
        v-else
        :items="parsed.transactions"
        container-class="h-full"
        :estimate-size="56"
        :get-item-key="(tx) => tx.rowIndex"
      >
        <template #default="{ item: tx, index }">
          <div class="px-3 py-2 text-sm" :class="index > 0 ? 'border-border border-t' : ''">
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ formatDate(tx.date) }}</span>
              <span
                class="shrink-0 font-semibold tabular-nums"
                :class="tx.amount >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
              >
                {{ formatTxAmount(tx) }}
              </span>
            </div>
            <div class="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs">
              <span class="truncate">{{ tx.accountName }}</span>
              <span v-if="tx.payeeName">· {{ tx.payeeName }}</span>
              <span v-if="tx.categoryGroup && tx.categoryName">· {{ tx.categoryGroup }}: {{ tx.categoryName }}</span>
            </div>
          </div>
        </template>
      </VirtualList>
    </div>

    <!-- Transfers -->
    <div v-if="activeTab === 'transfers'" :class="cn('border-border rounded-md border', LIST_HEIGHT_CLASS)">
      <EmptyList v-if="parsed.transfers.length === 0" />
      <VirtualList
        v-else
        :items="parsed.transfers"
        container-class="h-full"
        :estimate-size="56"
        :get-item-key="(_xfer, i) => i"
      >
        <template #default="{ item: xfer, index }">
          <div class="px-3 py-2 text-sm" :class="index > 0 ? 'border-border border-t' : ''">
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ formatDate(xfer.date) }}</span>
              <span class="text-app-transfer-color shrink-0 font-semibold tabular-nums">
                {{ formatTransferAmount(xfer) }}
              </span>
            </div>
            <div class="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 text-xs">
              <span class="truncate">{{ xfer.sourceAccountName }}</span>
              <ArrowRightIcon class="size-3 shrink-0" />
              <span class="truncate">{{ xfer.destinationAccountName }}</span>
            </div>
          </div>
        </template>
      </VirtualList>
    </div>

    <section v-if="parsed.warnings.length > 0">
      <h3 class="mb-2 text-sm font-semibold">
        {{ $t('pages.importExport.ynabImport.preview.warningsTitle') }}
      </h3>
      <Callout variant="warning">
        <ul class="list-disc space-y-1 pl-5 text-sm">
          <li v-for="(w, i) in parsed.warnings" :key="i">
            <span v-if="w.rowIndex" class="text-muted-foreground"
              >{{ $t('pages.importExport.ynabImport.preview.rowPrefix', { rowIndex: w.rowIndex }) }}
            </span>
            {{ w.message }}
          </li>
        </ul>
      </Callout>
    </section>

    <Callout v-if="store.executeError" variant="destructive">
      {{ store.executeError }}
    </Callout>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <UiButton variant="ghost" @click="store.reset()">
        <ChevronLeftIcon class="size-4" />
        {{ $t('pages.importExport.ynabImport.preview.startOver') }}
      </UiButton>
      <UiButton :disabled="!store.canExecute" @click="store.execute()">
        {{ $t('pages.importExport.ynabImport.preview.continueToImport') }}
      </UiButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button as UiButton } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { useCurrencyName } from '@/composable';
import { formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores';
import { useImportYnabStore } from '@/stores/import-ynab';
import { type CurrencyModel, YNAB_FLAG_HEX, type YnabParseTransaction, type YnabParseTransfer } from '@bt/shared/types';
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { format, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AccountsTab from './accounts-tab.vue';
import EmptyList from './empty-list.vue';
import VirtualList from '@/components/common/virtual-list.vue';

const LIST_HEIGHT_CLASS = 'h-[420px]';

type TabKey = 'accounts' | 'categories' | 'payees' | 'tags' | 'transactions' | 'transfers';

export interface CurrencyOption extends CurrencyModel {
  displayLabel: string;
}

const store = useImportYnabStore();
const { parsedResult: parsed } = storeToRefs(store);
const { t } = useI18n();
const { formatCurrencyLabel } = useCurrencyName();
const { systemCurrencies } = storeToRefs(useCurrenciesStore());

const activeTab = ref<TabKey>('accounts');

// Shared across every AccountPickRow so the (i18n-heavy) label formatting runs
// once for the whole accounts list instead of N times.
const currencyOptions = computed<CurrencyOption[]>(() =>
  systemCurrencies.value.map((c) => ({
    ...c,
    displayLabel: formatCurrencyLabel({ code: c.code, fallbackName: c.currency }),
  })),
);

const tabItems = computed<PillTabItem[]>(() => {
  if (!parsed.value) return [];
  return [
    { value: 'accounts', label: tabLabel('accounts', parsed.value.accounts.length) },
    { value: 'categories', label: tabLabel('categories', parsed.value.categories.length) },
    { value: 'payees', label: tabLabel('payees', parsed.value.payees.length) },
    { value: 'tags', label: tabLabel('tags', parsed.value.tagsUsed.length) },
    { value: 'transactions', label: tabLabel('transactions', parsed.value.transactions.length) },
    { value: 'transfers', label: tabLabel('transfers', parsed.value.transfers.length) },
  ];
});

function tabLabel(key: TabKey, count: number): string {
  return `(${count}) ${t(`pages.importExport.ynabImport.preview.${key}`)}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** YNAB parser hands us ISO YYYY-MM-DD strings; format them locale-aware so
 *  the preview reads like a date instead of raw machine output. */
function formatDate(iso: string): string {
  return format(parseISO(iso), 'PP');
}

function currencyForAccount(accountName: string): string | undefined {
  const code = store.accountPicks[accountName]?.currencyCode;
  if (code && code.length === 3) return code;
  const acc = parsed.value?.accounts.find((a) => a.originalName === accountName);
  return acc?.detectedCurrency ?? undefined;
}

function formatTxAmount(tx: YnabParseTransaction): string {
  return formatUIAmount(tx.amount, { currency: currencyForAccount(tx.accountName) });
}

function formatTransferAmount(xfer: YnabParseTransfer): string {
  return formatUIAmount(xfer.amount, { currency: currencyForAccount(xfer.sourceAccountName) });
}
</script>
