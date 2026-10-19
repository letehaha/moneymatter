<script setup lang="ts">
import { extractInvestmentTransactions } from '@/api/investment-transactions-import';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Card, CardContent } from '@/components/lib/ui/card';
import { ScrollArea, ScrollBar } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { usePrioritizedCurrencies } from '@/composable/data-queries/prioritized-currencies';
import { getApiErrorMessage } from '@/js/errors';
import { cn } from '@/lib/utils';
import {
  INVESTMENT_IMPORT_SIDE_SKIP,
  INVESTMENT_TRANSACTION_CATEGORY,
  type InvestmentColumnMapping,
  type InvestmentImportExtractionResult,
  type InvestmentImportHolding,
  type InvestmentImportSideSkip,
  type InvestmentImportTransactionSide,
  type InvestmentImportWarning,
} from '@bt/shared/types/investments';
import { useMutation } from '@tanstack/vue-query';
import { ArrowLeftIcon, InfoIcon, Loader2Icon, SparklesIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { InvestmentImportParseCsvResult } from './parse-csv-local';

const props = defineProps<{
  portfolioId: string;
  fileBase64: string;
  fileName: string;
  parseResult: InvestmentImportParseCsvResult;
  /**
   * Previously-built mapping for this same file. Set by the page orchestrator
   * when the user returns to this step from review — so column picks and
   * side-value mappings aren't lost.
   */
  initialMapping?: InvestmentColumnMapping | null;
}>();

const emit = defineEmits<{
  (
    e: 'extracted',
    payload: {
      holdings: InvestmentImportHolding[];
      warnings: InvestmentImportWarning[];
      mapping: InvestmentColumnMapping;
    },
  ): void;
  (e: 'back'): void;
}>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();

type ColumnOption = { label: string; value: string };
type SideMappingValue = InvestmentImportTransactionSide | InvestmentImportSideSkip;
type CategoryOption = { label: string; value: SideMappingValue };

// Auto-pick a column when the header text matches one of these patterns. Order
// inside each array matters — earlier patterns win. Keep lower-case.
const AUTO_PICK_PATTERNS: Record<keyof InvestmentColumnMapping, string[]> = {
  symbol: ['symbol', 'ticker', 'instrument', 'security'],
  date: ['date', 'trade date', 'transaction date', 'execution date'],
  side: ['side', 'action', 'type', 'transaction type', 'operation'],
  quantity: ['quantity', 'qty', 'shares', 'units', 'amount'],
  price: ['price', 'unit price', 'execution price', 'avg price', 'average price'],
  fees: ['fees', 'fee', 'commission', 'costs'],
  currency: ['currency', 'ccy', 'quote currency'],
  name: ['name', 'description', 'security name'],
  // These two aren't headers — never auto-picked.
  defaultCurrency: [],
  defaultAssetClassHint: [],
  sideValueMapping: [],
};

// Maps lower-cased CSV side-cell values to the canonical category we'd
// auto-suggest. Cash-movement values resolve to the SKIP sentinel because we
// don't model cash deposits/withdrawals in portfolios yet — the user can still
// override to a real category if they want.
const SIDE_AUTO_PICK: Record<string, SideMappingValue> = {
  b: INVESTMENT_TRANSACTION_CATEGORY.buy,
  buy: INVESTMENT_TRANSACTION_CATEGORY.buy,
  bought: INVESTMENT_TRANSACTION_CATEGORY.buy,
  purchase: INVESTMENT_TRANSACTION_CATEGORY.buy,
  s: INVESTMENT_TRANSACTION_CATEGORY.sell,
  sell: INVESTMENT_TRANSACTION_CATEGORY.sell,
  sold: INVESTMENT_TRANSACTION_CATEGORY.sell,
  sale: INVESTMENT_TRANSACTION_CATEGORY.sell,
  div: INVESTMENT_TRANSACTION_CATEGORY.dividend,
  dividend: INVESTMENT_TRANSACTION_CATEGORY.dividend,
  dividends: INVESTMENT_TRANSACTION_CATEGORY.dividend,
  'cash dividend': INVESTMENT_TRANSACTION_CATEGORY.dividend,
  'cash dividends': INVESTMENT_TRANSACTION_CATEGORY.dividend,
  transfer: INVESTMENT_TRANSACTION_CATEGORY.transfer,
  tax: INVESTMENT_TRANSACTION_CATEGORY.tax,
  fee: INVESTMENT_TRANSACTION_CATEGORY.fee,
  cancel: INVESTMENT_TRANSACTION_CATEGORY.cancel,
  deposit: INVESTMENT_IMPORT_SIDE_SKIP,
  withdrawal: INVESTMENT_IMPORT_SIDE_SKIP,
  withdraw: INVESTMENT_IMPORT_SIDE_SKIP,
  'cash in': INVESTMENT_IMPORT_SIDE_SKIP,
  'cash out': INVESTMENT_IMPORT_SIDE_SKIP,
};

function autoPickHeader(headers: string[], field: keyof InvestmentColumnMapping): string | null {
  const patterns = AUTO_PICK_PATTERNS[field];
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const pat of patterns) {
    const i = lower.indexOf(pat);
    if (i >= 0) return headers[i]!;
  }
  return null;
}

// Initial-value resolver: prefer the previously-persisted mapping (when the
// user returns from review), fall back to header auto-pick for first visits.
function initialColumn(field: keyof InvestmentColumnMapping): string | null {
  const fromMapping = props.initialMapping?.[field];
  if (typeof fromMapping === 'string' && fromMapping.length > 0) return fromMapping;
  if (fromMapping === null) return null;
  return autoPickHeader(props.parseResult.headers, field);
}

const symbolColumn = ref<string | null>(initialColumn('symbol'));
const dateColumn = ref<string | null>(initialColumn('date'));
const sideColumn = ref<string | null>(initialColumn('side'));
const quantityColumn = ref<string | null>(initialColumn('quantity'));
const priceColumn = ref<string | null>(initialColumn('price'));
const feesColumn = ref<string | null>(initialColumn('fees'));
const currencyColumn = ref<string | null>(initialColumn('currency'));
const nameColumn = ref<string | null>(initialColumn('name'));

const defaultCurrency = ref<string>(props.initialMapping?.defaultCurrency ?? 'USD');
const defaultAssetClassHint = ref<'crypto' | 'stocks'>(props.initialMapping?.defaultAssetClassHint ?? 'stocks');

const { currencies: prioritizedCurrencies } = usePrioritizedCurrencies();

type CurrencyOption = { label: string; value: string };
const currencyOptions = computed<CurrencyOption[]>(() =>
  (prioritizedCurrencies.value ?? []).map((c) => ({
    label: `${c.code} — ${c.currency}`,
    value: c.code,
  })),
);

// Generic option-by-value lookup. Replaces four near-identical helpers
// (objectFor/categoryObject/currencyObject/assetClassObject) — they all
// did `options.find(o => o.value === value) ?? null`.
function optionFor<V, O extends { value: V }>(value: V | null | undefined, options: readonly O[]): O | null {
  if (value === null || value === undefined) return null;
  return options.find((o) => o.value === value) ?? null;
}

// Side value mapping is keyed by the raw CSV cell value. Computed from the
// preview rows of the currently-selected `sideColumn`. Re-derived whenever
// that column changes, but existing user picks are preserved across changes
// when the same raw value reappears. Initial value comes from `initialMapping`
// when present so user picks survive a round-trip through the review step.
const sideValueMapping = ref<Record<string, SideMappingValue>>({ ...(props.initialMapping?.sideValueMapping ?? {}) });

const uniqueSideValues = computed<string[]>(() => {
  const col = sideColumn.value;
  if (!col) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const row of props.parseResult.preview) {
    const raw = (row[col] ?? '').trim();
    if (!raw) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    values.push(raw);
  }
  return values;
});

// Auto-populate side-value mapping when the side column changes. Preserves
// user overrides for values that are still present in the new column.
watch(
  uniqueSideValues,
  (values) => {
    const next: Record<string, SideMappingValue> = {};
    for (const v of values) {
      const existing = sideValueMapping.value[v];
      if (existing) {
        next[v] = existing;
        continue;
      }
      const guess = SIDE_AUTO_PICK[v.toLowerCase()];
      if (guess) next[v] = guess;
    }
    sideValueMapping.value = next;
  },
  { immediate: true },
);

const columnOptions = computed<ColumnOption[]>(() => props.parseResult.headers.map((h) => ({ label: h, value: h })));

const categoryOptions = computed<CategoryOption[]>(() => [
  ...Object.values(INVESTMENT_TRANSACTION_CATEGORY).map((c) => ({
    label: t(`investmentsImport.categories.${c}`),
    value: c as SideMappingValue,
  })),
  // Skip sentinel — keeps the rows out of the import without dirtying the
  // invalid-rows list. Always last so it doesn't shadow real categories.
  { label: t('investmentsImport.categories.skip'), value: INVESTMENT_IMPORT_SIDE_SKIP },
]);

const assetClassOptions = computed<{ label: string; value: 'crypto' | 'stocks' }[]>(() => [
  { label: t('investmentsImport.assetClasses.stocks'), value: 'stocks' },
  { label: t('investmentsImport.assetClasses.crypto'), value: 'crypto' },
]);

const requiredFilled = computed(
  () =>
    !!symbolColumn.value &&
    !!dateColumn.value &&
    !!sideColumn.value &&
    !!quantityColumn.value &&
    !!priceColumn.value &&
    uniqueSideValues.value.length > 0 &&
    uniqueSideValues.value.every((v) => !!sideValueMapping.value[v]),
);

// Stays false until the user first tries to submit. Once true, empty required
// fields render in their invalid state. Validity is still computed live, so
// the highlight clears as soon as the user fills the field.
const submitAttempted = ref(false);

const invalidFields = computed(() => ({
  symbol: submitAttempted.value && !symbolColumn.value,
  date: submitAttempted.value && !dateColumn.value,
  side: submitAttempted.value && !sideColumn.value,
  quantity: submitAttempted.value && !quantityColumn.value,
  price: submitAttempted.value && !priceColumn.value,
}));

const invalidSideValues = computed<Set<string>>(() => {
  if (!submitAttempted.value) return new Set();
  return new Set(uniqueSideValues.value.filter((v) => !sideValueMapping.value[v]));
});

// Tailwind classes that paint the SelectField trigger red. Applied via
// arbitrary-variant `[&_button]` so we don't have to fork SelectField for
// this one visual state.
const INVALID_FIELD_CLASS = '[&_button]:border-destructive-text [&_button]:ring-destructive-text/30 [&_button]:ring-1';

function fieldErrorClass(invalid: boolean): string {
  return cn(invalid && INVALID_FIELD_CLASS);
}

function buildMapping(): InvestmentColumnMapping {
  return {
    symbol: symbolColumn.value!,
    date: dateColumn.value!,
    side: sideColumn.value!,
    quantity: quantityColumn.value!,
    price: priceColumn.value!,
    fees: feesColumn.value,
    currency: currencyColumn.value,
    name: nameColumn.value,
    defaultCurrency: defaultCurrency.value || null,
    defaultAssetClassHint: defaultAssetClassHint.value,
    sideValueMapping: { ...sideValueMapping.value },
  };
}

function onContinueClick() {
  if (!requiredFilled.value) {
    submitAttempted.value = true;
    // Defer to next frame so newly-applied invalid classes are in the DOM
    // before we query for them.
    requestAnimationFrame(() => {
      const firstInvalid = document.querySelector<HTMLElement>('[data-mapping-invalid="true"]');
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return;
  }
  extract.mutate();
}

const extract = useMutation({
  mutationFn: async () => {
    const mapping = buildMapping();
    const result = await extractInvestmentTransactions({
      source: 'csv',
      fileBase64: props.fileBase64,
      defaultPortfolioId: props.portfolioId,
      columnMapping: mapping,
    });
    return { result, mapping };
  },
  onSuccess: ({ result, mapping }: { result: InvestmentImportExtractionResult; mapping: InvestmentColumnMapping }) => {
    const holdings = result.holdings.map((h) => ({
      ...h,
      transactions: h.transactions.map((tx) => ({ ...tx })),
    }));
    // Mapping rides along with the extract payload so the page orchestrator
    // can hand it back when the user returns from review — preserves picks.
    emit('extracted', { holdings, warnings: result.warnings, mapping });
  },
  onError: (err: Error) => {
    addNotification({
      text: getApiErrorMessage({
        e: err,
        t,
        conflictKey: 'investmentsImport.notifications.extractFailed',
        fallbackKey: 'investmentsImport.notifications.extractFailed',
      }),
      type: NotificationType.error,
    });
  },
});
</script>

<template>
  <Card class="overflow-hidden p-0">
    <!-- File summary -->
    <div class="border-border/60 flex items-center justify-between border-b px-5 py-4">
      <div>
        <h2 class="text-sm font-semibold">{{ fileName }}</h2>
        <p class="text-muted-foreground text-xs">
          {{
            $t('investmentsImport.columnMapping.rowsAndDelimiter', {
              rows: parseResult.totalRows,
              delimiter: parseResult.detectedDelimiter,
            })
          }}
        </p>
      </div>
      <Button variant="ghost" size="sm" :disabled="extract.isPending.value" @click="emit('back')">
        <ArrowLeftIcon class="mr-1 size-4" />
        {{ $t('investmentsImport.columnMapping.backToUpload') }}
      </Button>
    </div>

    <CardContent class="space-y-6 p-5">
      <!-- Preview -->
      <section>
        <h3 class="mb-2 text-sm font-semibold">{{ $t('investmentsImport.columnMapping.previewTitle') }}</h3>
        <ScrollArea class="border-border/60 h-96 rounded-md border">
          <table class="w-full min-w-max text-xs">
            <thead>
              <tr>
                <!-- Corner cell — sticky in both axes so it stays put while the
                     user scrolls the preview. Higher z-index than the regular
                     stickies underneath it. -->
                <th
                  class="bg-muted border-border/60 text-muted-foreground sticky top-0 left-0 z-20 border-r border-b px-2 py-2 text-left font-medium whitespace-nowrap"
                  scope="col"
                >
                  #
                </th>
                <th
                  v-for="header in parseResult.headers"
                  :key="header"
                  class="bg-muted border-border/60 sticky top-0 z-10 border-b px-3 py-2 text-left font-medium whitespace-nowrap"
                >
                  {{ header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in parseResult.preview" :key="idx" class="hover:bg-muted/30">
                <!-- Row index matches the backend's 1-based data-row numbering,
                     so "row 89 invalid" maps to the cell labelled 89 here. -->
                <td
                  class="bg-card border-border/60 text-muted-foreground sticky left-0 border-r border-b px-2 py-1.5 text-right whitespace-nowrap tabular-nums"
                >
                  {{ idx + 1 }}
                </td>
                <td
                  v-for="header in parseResult.headers"
                  :key="header"
                  class="border-border/60 border-b px-3 py-1.5 whitespace-nowrap tabular-nums"
                >
                  {{ row[header] ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </section>

      <!-- Required mapping -->
      <section>
        <h3 class="mb-3 text-sm font-semibold">{{ $t('investmentsImport.columnMapping.requiredTitle') }}</h3>
        <div class="@container/mapping">
          <div class="grid grid-cols-1 gap-3 @sm/mapping:grid-cols-2 @lg/mapping:grid-cols-3">
            <SelectField
              :model-value="optionFor(symbolColumn, columnOptions)"
              :values="columnOptions"
              :label="$t('investmentsImport.columnMapping.fields.symbol')"
              :placeholder="$t('investmentsImport.columnMapping.selectColumn')"
              :class="fieldErrorClass(invalidFields.symbol)"
              :data-mapping-invalid="invalidFields.symbol ? 'true' : null"
              @update:model-value="(o: ColumnOption | null) => (symbolColumn = o?.value ?? null)"
            />
            <SelectField
              :model-value="optionFor(dateColumn, columnOptions)"
              :values="columnOptions"
              :label="$t('investmentsImport.columnMapping.fields.date')"
              :placeholder="$t('investmentsImport.columnMapping.selectColumn')"
              :class="fieldErrorClass(invalidFields.date)"
              :data-mapping-invalid="invalidFields.date ? 'true' : null"
              @update:model-value="(o: ColumnOption | null) => (dateColumn = o?.value ?? null)"
            />
            <SelectField
              :model-value="optionFor(sideColumn, columnOptions)"
              :values="columnOptions"
              :label="$t('investmentsImport.columnMapping.fields.side')"
              :placeholder="$t('investmentsImport.columnMapping.selectColumn')"
              :class="fieldErrorClass(invalidFields.side)"
              :data-mapping-invalid="invalidFields.side ? 'true' : null"
              @update:model-value="(o: ColumnOption | null) => (sideColumn = o?.value ?? null)"
            />
            <SelectField
              :model-value="optionFor(quantityColumn, columnOptions)"
              :values="columnOptions"
              :label="$t('investmentsImport.columnMapping.fields.quantity')"
              :placeholder="$t('investmentsImport.columnMapping.selectColumn')"
              :class="fieldErrorClass(invalidFields.quantity)"
              :data-mapping-invalid="invalidFields.quantity ? 'true' : null"
              @update:model-value="(o: ColumnOption | null) => (quantityColumn = o?.value ?? null)"
            />
            <SelectField
              :model-value="optionFor(priceColumn, columnOptions)"
              :values="columnOptions"
              :label="$t('investmentsImport.columnMapping.fields.price')"
              :placeholder="$t('investmentsImport.columnMapping.selectColumn')"
              :class="fieldErrorClass(invalidFields.price)"
              :data-mapping-invalid="invalidFields.price ? 'true' : null"
              @update:model-value="(o: ColumnOption | null) => (priceColumn = o?.value ?? null)"
            />
          </div>
        </div>
      </section>

      <!-- Optional mapping -->
      <section>
        <h3 class="mb-3 text-sm font-semibold">{{ $t('investmentsImport.columnMapping.optionalTitle') }}</h3>
        <div class="@container/mapping">
          <div class="grid grid-cols-1 gap-3 @sm/mapping:grid-cols-2 @lg/mapping:grid-cols-3">
            <div>
              <div class="mb-1.25 flex items-center gap-1.5 text-base leading-none font-normal tracking-wide">
                <span>{{ $t('investmentsImport.columnMapping.fields.fees') }}</span>
                <DesktopOnlyTooltip
                  content-class-name="max-w-[300px]"
                  :content="$t('investmentsImport.columnMapping.tooltips.fees')"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
                </DesktopOnlyTooltip>
              </div>
              <SelectField
                :model-value="optionFor(feesColumn, columnOptions)"
                :values="columnOptions"
                :placeholder="$t('investmentsImport.columnMapping.notMapped')"
                @update:model-value="(o: ColumnOption | null) => (feesColumn = o?.value ?? null)"
              />
            </div>
            <div>
              <div class="mb-1.25 flex items-center gap-1.5 text-base leading-none font-normal tracking-wide">
                <span>{{ $t('investmentsImport.columnMapping.fields.currency') }}</span>
                <DesktopOnlyTooltip
                  content-class-name="max-w-[300px]"
                  :content="$t('investmentsImport.columnMapping.tooltips.currency')"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
                </DesktopOnlyTooltip>
              </div>
              <SelectField
                :model-value="optionFor(currencyColumn, columnOptions)"
                :values="columnOptions"
                :placeholder="$t('investmentsImport.columnMapping.notMapped')"
                @update:model-value="(o: ColumnOption | null) => (currencyColumn = o?.value ?? null)"
              />
            </div>
            <div>
              <div class="mb-1.25 flex items-center gap-1.5 text-base leading-none font-normal tracking-wide">
                <span>{{ $t('investmentsImport.columnMapping.fields.name') }}</span>
                <DesktopOnlyTooltip
                  content-class-name="max-w-[300px]"
                  :content="$t('investmentsImport.columnMapping.tooltips.name')"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
                </DesktopOnlyTooltip>
              </div>
              <SelectField
                :model-value="optionFor(nameColumn, columnOptions)"
                :values="columnOptions"
                :placeholder="$t('investmentsImport.columnMapping.notMapped')"
                @update:model-value="(o: ColumnOption | null) => (nameColumn = o?.value ?? null)"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Defaults -->
      <section>
        <h3 class="mb-3 text-sm font-semibold">{{ $t('investmentsImport.columnMapping.defaultsTitle') }}</h3>
        <div class="@container/mapping">
          <div class="grid grid-cols-1 gap-3 @sm/mapping:grid-cols-2">
            <div>
              <div class="mb-1.25 flex items-center gap-1.5 text-base leading-none font-normal tracking-wide">
                <span>{{ $t('investmentsImport.columnMapping.fields.defaultCurrency') }}</span>
                <DesktopOnlyTooltip
                  content-class-name="max-w-[300px]"
                  :content="$t('investmentsImport.columnMapping.tooltips.defaultCurrency')"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
                </DesktopOnlyTooltip>
              </div>
              <SelectField
                :model-value="optionFor(defaultCurrency, currencyOptions)"
                :values="currencyOptions"
                with-search
                :placeholder="$t('investmentsImport.columnMapping.fields.defaultCurrency')"
                @update:model-value="(o: CurrencyOption | null) => (defaultCurrency = o?.value ?? '')"
              />
            </div>
            <div>
              <div class="mb-1.25 flex items-center gap-1.5 text-base leading-none font-normal tracking-wide">
                <span>{{ $t('investmentsImport.columnMapping.fields.defaultAssetClass') }}</span>
                <DesktopOnlyTooltip
                  content-class-name="max-w-[300px]"
                  :content="$t('investmentsImport.columnMapping.tooltips.defaultAssetClass')"
                >
                  <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
                </DesktopOnlyTooltip>
              </div>
              <SelectField
                :model-value="optionFor(defaultAssetClassHint, assetClassOptions)"
                :values="assetClassOptions"
                @update:model-value="(o) => (defaultAssetClassHint = o?.value ?? 'stocks')"
              />
            </div>
          </div>
        </div>
      </section>

      <!-- Side value mapping -->
      <section v-if="sideColumn">
        <h3 class="mb-1 text-sm font-semibold">
          {{ $t('investmentsImport.columnMapping.sideValueMappingTitle') }}
          <span class="text-destructive-text">*</span>
        </h3>
        <p class="text-muted-foreground mb-3 text-xs">
          {{ $t('investmentsImport.columnMapping.sideValueMappingHint') }}
        </p>
        <Callout class="mb-3">
          <p>{{ $t('investmentsImport.columnMapping.cashMovementsNote') }}</p>
        </Callout>

        <div v-if="uniqueSideValues.length === 0" class="text-muted-foreground text-sm">
          {{ $t('investmentsImport.columnMapping.sideValueMappingEmpty') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="value in uniqueSideValues"
            :key="value"
            :class="
              cn(
                'flex items-center gap-3 rounded-md border p-2',
                invalidSideValues.has(value)
                  ? 'border-destructive-text/60 bg-destructive/5'
                  : 'border-border/60 bg-muted/20',
              )
            "
            :data-mapping-invalid="invalidSideValues.has(value) ? 'true' : null"
          >
            <code class="bg-background min-w-20 rounded px-2 py-1 text-xs">{{ value }}</code>
            <span class="text-muted-foreground text-xs">→</span>
            <div class="min-w-0 flex-1">
              <SelectField
                :model-value="optionFor(sideValueMapping[value], categoryOptions)"
                :values="categoryOptions"
                :placeholder="$t('investmentsImport.columnMapping.pickCategory')"
                :class="fieldErrorClass(invalidSideValues.has(value))"
                @update:model-value="
                  (o: CategoryOption | null) => {
                    if (o) sideValueMapping[value] = o.value;
                    else delete sideValueMapping[value];
                  }
                "
              />
            </div>
          </div>
        </div>
      </section>
    </CardContent>

    <div
      class="border-border/60 bg-muted/20 flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:items-center sm:justify-end"
    >
      <Button variant="ghost" size="sm" :disabled="extract.isPending.value" @click="emit('back')">
        {{ $t('investmentsImport.columnMapping.backToUpload') }}
      </Button>
      <Button :disabled="extract.isPending.value" @click="onContinueClick">
        <Loader2Icon v-if="extract.isPending.value" class="mr-1 size-4 animate-spin" />
        <SparklesIcon v-else class="mr-1 size-4" />
        {{
          extract.isPending.value
            ? $t('investmentsImport.columnMapping.extracting')
            : $t('investmentsImport.columnMapping.extractButton')
        }}
      </Button>
    </div>
  </Card>
</template>
