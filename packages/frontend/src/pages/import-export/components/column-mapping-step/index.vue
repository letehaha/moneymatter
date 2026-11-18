<!--
  Map Columns step — the wizard's centerpiece. Two compact, full-width tables:

    1. "Columns" (simple fields): status | field | CSV column | example data
       Rows: Date (required), Amount (required), Description, Payee, Tags (optional).
       A mapped Date row expands in place to the date-format block, which forces
       an explicit day/month-order confirmation before Next unlocks.

    2. "Assignments" (complex fields): status | field | how to assign | using
       Rows: Category, Account, Currency, Transaction type. The method cell picks
       the assignment strategy; the "using" cell shows the resulting decision
       (a CSV column, an existing entity, or — for amount-sign — a short note).
       Transaction type expands in place to a triple block when "From column".

  Both tables use the shared MappingTable (responsive grid↔cards). Every row's
  status comes from deriveMapRowStatus(), reading the auto-match record plus
  value presence. All edits write straight to store.columnMapping.*.
-->
<template>
  <div class="bg-card rounded-lg border p-4 sm:p-6">
    <div class="mb-4">
      <h2 class="text-lg font-semibold">{{ $t('pages.importExport.columnMapping.stepTitle') }}</h2>
      <p class="text-muted-foreground text-sm">
        {{ $t('pages.importExport.columnMapping.description') }}
        <DocsLink path="/import/import-from-csv/#map-columns" />
      </p>
    </div>

    <!-- File info -->
    <p class="text-muted-foreground mb-6 text-xs">
      {{ $t('pages.importExport.columnMapping.file') }}:
      <span class="text-foreground font-medium">{{ fileLabel }}</span>
      <span class="mx-1.5">·</span>
      {{ $t('pages.importExport.columnMapping.totalRows') }}: {{ importStore.totalRows }}
      <span class="mx-1.5">·</span>
      {{ $t('pages.importExport.columnMapping.delimiter') }}: "{{ importStore.detectedDelimiter }}"
    </p>

    <!-- TABLE 1: simple columns -->
    <h3 class="mb-2 text-sm font-semibold">{{ $t('pages.importExport.mapColumns.columnsTitle') }}</h3>
    <MappingTable
      :columns="simpleColumns"
      :items="simpleRows"
      :row-key="(row) => row.id"
      :is-row-expanded="(row) => row.id === 'date' && !!row.value"
      :get-row-class="(row) => (row.status === 'needs-attention' ? 'bg-warning/10' : '')"
      class="mb-6"
    >
      <template #cell:status="{ item }">
        <StatusIndicator :status="item.status" size="sm" />
      </template>

      <template #cell:field="{ item }">
        <span class="font-medium">{{ item.label }}</span>
        <span v-if="item.required" class="text-destructive-text" aria-hidden="true">&nbsp;*</span>
        <span v-else class="text-muted-foreground ml-1 text-xs">
          {{ $t('pages.importExport.mapColumns.optionalSuffix') }}
        </span>
      </template>

      <template #cell:column="{ item }">
        <CellColumnSelect
          :model-value="item.value"
          :headers="importStore.csvHeaders"
          :used-by-others="usedByOthers(item.id)"
          :required="item.required"
          clearable
          :placeholder="
            item.required
              ? $t('pages.importExport.mapColumns.choosePlaceholder')
              : $t('pages.importExport.common.noneOptional')
          "
          @update:model-value="item.onChange"
        />
      </template>

      <template #cell:example="{ item }">
        <span class="text-muted-foreground truncate">{{ exampleData(item.value) }}</span>
      </template>

      <!-- Forced date-format confirmation, always visible under a mapped Date row -->
      <template #expansion="{ item }">
        <DateFormatExpansion v-if="item.id === 'date'" />
      </template>
    </MappingTable>

    <!-- TABLE 2: complex assignments -->
    <h3 class="mb-2 text-sm font-semibold">{{ $t('pages.importExport.mapColumns.assignmentsTitle') }}</h3>
    <MappingTable
      :columns="complexColumns"
      :items="complexRows"
      :row-key="(row) => row.id"
      :is-row-expanded="(row) => row.expanded"
      :get-row-class="(row) => (row.status === 'needs-attention' ? 'bg-warning/10' : '')"
    >
      <template #cell:status="{ item }">
        <StatusIndicator :status="item.status" size="sm" />
      </template>

      <template #cell:field="{ item }">
        <span class="font-medium">{{ item.label }}</span>
        <span class="text-destructive-text" aria-hidden="true">&nbsp;*</span>
      </template>

      <template #cell:method="{ item }">
        <SelectField
          :model-value="item.methodOption"
          :values="item.methodOptions"
          required
          class="w-full"
          :placeholder="$t('pages.importExport.common.selectOption')"
          @update:model-value="item.onMethodChange"
        />
      </template>

      <template #cell:decision="{ item }">
        <!-- Category: column-based methods ⇒ CSV column picker -->
        <CellColumnSelect
          v-if="item.id === 'category' && categoryUsesColumn"
          :model-value="columnByField.category ?? null"
          :headers="importStore.csvHeaders"
          :used-by-others="usedByOthers('category')"
          required
          :placeholder="$t('pages.importExport.common.selectColumn')"
          @update:model-value="handleCategoryColumnChange"
        />
        <!-- Category: single existing ⇒ hierarchical category picker -->
        <CategorySelectField
          v-else-if="item.id === 'category' && categoryUsesExisting"
          :model-value="selectedCategory"
          :values="formattedCategories"
          :categories-map="categoriesMap"
          label-key="name"
          :placeholder="$t('pages.importExport.categoryMapping.selectCategory')"
          popover-class-name="min-w-60"
          @update:model-value="handleCategorySelect"
        />

        <!-- Account: from column ⇒ CSV column picker -->
        <CellColumnSelect
          v-else-if="item.id === 'account' && accountUsesColumn"
          :model-value="columnByField.account ?? null"
          :headers="importStore.csvHeaders"
          :used-by-others="usedByOthers('account')"
          required
          :placeholder="$t('pages.importExport.common.selectColumn')"
          @update:model-value="handleAccountColumnChange"
        />
        <!-- Account: single existing ⇒ existing-account picker -->
        <AccountSelectField
          v-else-if="item.id === 'account' && accountUsesExisting"
          :model-value="selectedAccount"
          :accounts="importLinkableAccounts"
          class="w-full"
          required
          :placeholder="$t('pages.importExport.accountMapping.selectAccount')"
          @update:model-value="handleAccountSelect"
        />

        <!-- Currency: from column ⇒ CSV column picker -->
        <CellColumnSelect
          v-else-if="item.id === 'currency' && currencyUsesColumn"
          :model-value="columnByField.currency ?? null"
          :headers="importStore.csvHeaders"
          :used-by-others="usedByOthers('currency')"
          required
          :placeholder="$t('pages.importExport.common.selectColumn')"
          @update:model-value="handleCurrencyColumnChange"
        />
        <!-- Currency: single existing ⇒ currency picker -->
        <SelectField
          v-else-if="item.id === 'currency' && currencyUsesExisting"
          :model-value="selectedCurrency"
          :values="currencies"
          label-key="displayName"
          value-key="code"
          class="w-full"
          required
          with-search
          :search-keys="['code', 'currency']"
          :placeholder="$t('pages.importExport.currencyMapping.selectCurrency')"
          @update:model-value="handleCurrencySelect"
        />

        <!-- Transaction type: amount-sign ⇒ inline note (no decision); from-column lives in the expansion -->
        <span
          v-else-if="item.id === 'transactionType' && transactionTypeUsesAmountSign"
          class="text-muted-foreground text-xs"
        >
          {{ $t('pages.importExport.mapColumns.amountSignNote') }}
        </span>

        <!-- No method chosen yet -->
        <span v-else class="text-muted-foreground">—</span>
      </template>

      <!-- Transaction-type expansion (from-column triple block) -->
      <template #expansion="{ item }">
        <TransactionTypeExpansion
          v-if="item.id === 'transactionType'"
          :used-by-others="usedByOthers('transactionType')"
        />
      </template>
    </MappingTable>

    <!-- detectDuplicates transport failure (network / 5xx). -->
    <Callout v-if="importStore.detectError" variant="destructive" class="mt-4" role="alert">
      <p>{{ importStore.detectError }}</p>
    </Callout>

    <!-- Footer -->
    <div
      class="border-border mt-6 flex flex-col gap-3 border-t pt-4 @2xl/csv-wizard:flex-row @2xl/csv-wizard:items-center @2xl/csv-wizard:justify-between"
    >
      <p v-if="!importStore.isMapStepValid" class="text-muted-foreground text-xs" aria-live="polite">
        {{ missingHint }}
      </p>
      <div class="flex justify-between gap-3 @2xl/csv-wizard:ml-auto">
        <UiButton variant="ghost" :disabled="isAdvancing" @click="importStore.goBack()">
          {{ $t('pages.importExport.mapColumns.back') }}
        </UiButton>
        <UiButton :disabled="!importStore.isMapStepValid || isAdvancing" @click="handleNext">
          <template v-if="isAdvancing">
            <LoaderIcon class="size-4 animate-spin" />
            {{ $t('pages.importExport.columnMapping.detecting') }}
          </template>
          <template v-else>
            {{ $t('pages.importExport.mapColumns.next') }}
            <ChevronRightIcon class="size-4" />
          </template>
        </UiButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAllCurrencies } from '@/api/currencies';
import { type FormattedCategory } from '@/common/types';
import DocsLink from '@/components/common/docs-link.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { MappingTable, type MappingTableColumn } from '@/components/lib/ui/mapping-table';
import { StatusIndicator } from '@/components/lib/ui/status-indicator';
import {
  isAccountDecided,
  isCategoryDecided,
  isCurrencyDecided,
  isTransactionTypeDecided,
} from '@/pages/import-export/utils/field-decision';
import { buildCategoryMapById } from '@/pages/import-export/utils/flatten-categories';
import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useImportExportStore } from '@/stores/import-export';
import {
  type AccountModel,
  AccountOptionValue,
  type CategoryOption,
  CategoryOptionValue,
  type CurrencyModel,
  CurrencyOptionValue,
  TagOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import { ChevronRightIcon, LoaderIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CellColumnSelect from './cell-column-select.vue';
import DateFormatExpansion from './date-format-expansion.vue';
import { type MapRowStatus, deriveMapRowStatus } from './map-row-status';
import TransactionTypeExpansion from './transaction-type-expansion.vue';

const { t } = useI18n();

const importStore = useImportExportStore();
const accountsStore = useAccountsStore();
const categoriesStore = useCategoriesStore();
const { importLinkableAccounts } = storeToRefs(accountsStore);
const { categories, formattedCategories, categoriesMap } = storeToRefs(categoriesStore);

/** Single file → its name; several files → a "N files" count (they were merged into one). */
const fileLabel = computed(() => {
  const files = importStore.uploadedFiles;
  if (files.length === 1) return files[0]!.name;
  return t('pages.importExport.csvImport.columnMapping.filesCount', { count: files.length }, files.length);
});

interface CurrencyWithDisplay extends CurrencyModel {
  displayName: string;
}
const currencies = ref<CurrencyWithDisplay[]>([]);

onMounted(async () => {
  if (categories.value.length === 0) {
    await categoriesStore.loadCategories();
  }
  const allCurrencies = await getAllCurrencies();
  currencies.value = allCurrencies.map((currency) => ({
    ...currency,
    displayName: `${currency.code} - ${currency.currency}`,
  }));
});

const m = computed(() => importStore.columnMapping);

interface MethodOption {
  label: string;
  value: string;
}

/** Resolves a stored option value back to its `MethodOption` (for the method `SelectField`). */
const findMethodOption = ({
  options,
  value,
}: {
  options: MethodOption[];
  value: string | undefined;
}): MethodOption | null => (value ? (options.find((o) => o.value === value) ?? null) : null);

// ---------------------------------------------------------------------------
// Already-matched de-prioritisation
// ---------------------------------------------------------------------------

/** Field id → the CSV column it currently consumes (if any). */
const columnByField = computed<Record<string, string | null>>(() => {
  const mapping = m.value;

  const category = mapping.category;
  const categoryCol =
    category?.option === CategoryOptionValue.mapDataSourceColumn ||
    category?.option === CategoryOptionValue.createNewCategories
      ? category.columnName || null
      : null;

  const account = mapping.account;
  const accountCol = account?.option === AccountOptionValue.dataSourceColumn ? account.columnName || null : null;

  const currency = mapping.currency;
  const currencyCol = currency?.option === CurrencyOptionValue.dataSourceColumn ? currency.columnName || null : null;

  const transactionType = mapping.transactionType;
  const transactionTypeCol =
    transactionType.option === TransactionTypeOptionValue.dataSourceColumn ? transactionType.columnName || null : null;

  return {
    date: mapping.date,
    amount: mapping.amount,
    description: mapping.description,
    payee: mapping.payee,
    tags: mapping.tags?.columnName || null,
    category: categoryCol,
    account: accountCol,
    currency: currencyCol,
    transactionType: transactionTypeCol,
  };
});

/** Columns claimed by every field EXCEPT `fieldId` (drives demotion in that field's picker). */
const usedByOthers = (fieldId: string): string[] => {
  const used: string[] = [];
  for (const [id, column] of Object.entries(columnByField.value)) {
    if (id !== fieldId && column) used.push(column);
  }
  return used;
};

// ---------------------------------------------------------------------------
// Example data
// ---------------------------------------------------------------------------

const MAX_EXAMPLE_VALUES = 2;

/** First couple of non-empty sample cells for a column, joined for the example cell. */
const exampleData = (column: string | null): string => {
  if (!column) return '—';
  const samples: string[] = [];
  for (const row of importStore.csvPreview) {
    const value = row[column];
    if (value !== undefined && value !== '') samples.push(value);
    if (samples.length >= MAX_EXAMPLE_VALUES) break;
  }
  return samples.length > 0 ? samples.join(' · ') : '—';
};

// ---------------------------------------------------------------------------
// TABLE 1 — simple fields
// ---------------------------------------------------------------------------

const simpleColumns: MappingTableColumn[] = [
  { key: 'status', label: '', width: '36px', hideLabelInCard: true, cardHeader: true },
  { key: 'field', label: t('pages.importExport.mapColumns.fieldHeader'), width: '160px', cardHeader: true },
  { key: 'column', label: t('pages.importExport.mapColumns.csvColumnHeader'), width: 'minmax(0,1fr)' },
  { key: 'example', label: t('pages.importExport.mapColumns.exampleHeader'), width: 'minmax(0,1fr)' },
];

interface SimpleRow {
  id: 'date' | 'amount' | 'description' | 'payee' | 'tags';
  label: string;
  required: boolean;
  value: string | null;
  status: MapRowStatus;
  onChange: (value: string | null) => void;
}

const simpleRows = computed<SimpleRow[]>(() => [
  {
    id: 'date',
    label: t('pages.importExport.mapColumns.fields.date'),
    required: true,
    // The Date row counts as filled only once the day/month order is confirmed
    // too, so the row stays flagged until the expansion's pick is made.
    value: m.value.date,
    status: deriveMapRowStatus({
      hasValue: !!m.value.date && !!m.value.dateFieldOrder,
      required: true,
      match: importStore.columnMatch?.date ?? null,
    }),
    onChange: (value) => {
      // A different column's cells may follow a different day/month order —
      // the user must confirm the format again.
      if (value !== importStore.columnMapping.date) {
        importStore.columnMapping.dateFieldOrder = null;
      }
      importStore.columnMapping.date = value;
    },
  },
  {
    id: 'amount',
    label: t('pages.importExport.mapColumns.fields.amount'),
    required: true,
    value: m.value.amount,
    status: deriveMapRowStatus({
      hasValue: !!m.value.amount,
      required: true,
      match: importStore.columnMatch?.amount ?? null,
    }),
    onChange: (value) => {
      importStore.columnMapping.amount = value;
    },
  },
  {
    id: 'description',
    label: t('pages.importExport.mapColumns.fields.description'),
    required: false,
    value: m.value.description,
    status: deriveMapRowStatus({
      hasValue: !!m.value.description,
      required: false,
      match: importStore.columnMatch?.description ?? null,
    }),
    onChange: (value) => {
      importStore.columnMapping.description = value;
    },
  },
  {
    id: 'payee',
    label: t('pages.importExport.mapColumns.fields.payee'),
    required: false,
    value: m.value.payee,
    status: deriveMapRowStatus({
      hasValue: !!m.value.payee,
      required: false,
      match: importStore.columnMatch?.payee ?? null,
    }),
    onChange: (value) => {
      importStore.columnMapping.payee = value;
    },
  },
  {
    id: 'tags',
    label: t('pages.importExport.mapColumns.fields.tags'),
    required: false,
    value: m.value.tags?.columnName ?? null,
    status: deriveMapRowStatus({
      hasValue: !!m.value.tags?.columnName,
      required: false,
      match: importStore.columnMatch?.tags ?? null,
    }),
    onChange: (value) => {
      importStore.columnMapping.tags = value ? { option: TagOptionValue.mapDataSourceColumn, columnName: value } : null;
    },
  },
]);

// ---------------------------------------------------------------------------
// TABLE 2 — complex assignments
// ---------------------------------------------------------------------------

const complexColumns: MappingTableColumn[] = [
  { key: 'status', label: '', width: '36px', hideLabelInCard: true, cardHeader: true },
  { key: 'field', label: t('pages.importExport.mapColumns.fieldHeader'), width: '160px', cardHeader: true },
  { key: 'method', label: t('pages.importExport.mapColumns.howToAssignHeader'), width: 'minmax(0,1fr)' },
  { key: 'decision', label: t('pages.importExport.mapColumns.usingHeader'), width: 'minmax(0,1fr)' },
];

// --- Category ---

const categoryMethodOptions = computed<MethodOption[]>(() => [
  {
    label: t('pages.importExport.categoryAssignment.options.mapToExisting'),
    value: CategoryOptionValue.mapDataSourceColumn,
  },
  {
    label: t('pages.importExport.categoryAssignment.options.createNew'),
    value: CategoryOptionValue.createNewCategories,
  },
  {
    label: t('pages.importExport.categoryAssignment.options.assignToSingle'),
    value: CategoryOptionValue.existingCategory,
  },
]);

const categoryMethodOption = computed<MethodOption | null>(() =>
  findMethodOption({ options: categoryMethodOptions.value, value: m.value.category?.option }),
);

const categoryUsesColumn = computed(
  () =>
    m.value.category?.option === CategoryOptionValue.mapDataSourceColumn ||
    m.value.category?.option === CategoryOptionValue.createNewCategories,
);
const categoryUsesExisting = computed(() => m.value.category?.option === CategoryOptionValue.existingCategory);

const handleCategoryMethodChange = (option: MethodOption | null) => {
  if (!option) {
    importStore.columnMapping.category = null;
    return;
  }
  const next: Record<string, CategoryOption> = {
    [CategoryOptionValue.mapDataSourceColumn]: { option: CategoryOptionValue.mapDataSourceColumn, columnName: '' },
    [CategoryOptionValue.createNewCategories]: { option: CategoryOptionValue.createNewCategories, columnName: '' },
    [CategoryOptionValue.existingCategory]: { option: CategoryOptionValue.existingCategory, categoryId: '' },
  };
  importStore.columnMapping.category = next[option.value] ?? null;
};

const handleCategoryColumnChange = (column: string | null) => {
  const current = m.value.category;
  if (
    current?.option === CategoryOptionValue.mapDataSourceColumn ||
    current?.option === CategoryOptionValue.createNewCategories
  ) {
    importStore.columnMapping.category = { option: current.option, columnName: column ?? '' };
  }
};

const flatCategoriesById = computed(() => buildCategoryMapById({ categories: formattedCategories.value }));

const selectedCategory = computed<FormattedCategory | null>(() => {
  const category = m.value.category;
  if (category?.option === CategoryOptionValue.existingCategory && category.categoryId) {
    return flatCategoriesById.value.get(category.categoryId) ?? null;
  }
  return null;
});

const handleCategorySelect = (category: FormattedCategory | null) => {
  importStore.columnMapping.category = {
    option: CategoryOptionValue.existingCategory,
    categoryId: category?.id ?? '',
  };
};

// --- Account ---

const accountMethodOptions = computed<MethodOption[]>(() => [
  {
    label: t('pages.importExport.accountAssignment.options.mapToExisting'),
    value: AccountOptionValue.dataSourceColumn,
  },
  {
    label: t('pages.importExport.accountAssignment.options.assignToSingle'),
    value: AccountOptionValue.existingAccount,
  },
]);

const accountMethodOption = computed<MethodOption | null>(() =>
  findMethodOption({ options: accountMethodOptions.value, value: m.value.account?.option }),
);

const accountUsesColumn = computed(() => m.value.account?.option === AccountOptionValue.dataSourceColumn);
const accountUsesExisting = computed(() => m.value.account?.option === AccountOptionValue.existingAccount);

const handleAccountMethodChange = (option: MethodOption | null) => {
  if (!option) {
    importStore.columnMapping.account = null;
    return;
  }
  if (option.value === AccountOptionValue.dataSourceColumn) {
    importStore.columnMapping.account = { option: AccountOptionValue.dataSourceColumn, columnName: '' };
  } else {
    importStore.columnMapping.account = { option: AccountOptionValue.existingAccount, accountId: '' };
  }
};

const handleAccountColumnChange = (column: string | null) => {
  if (m.value.account?.option === AccountOptionValue.dataSourceColumn) {
    importStore.columnMapping.account = { option: AccountOptionValue.dataSourceColumn, columnName: column ?? '' };
  }
};

const selectedAccount = computed<AccountModel | null>(() => {
  const account = m.value.account;
  if (account?.option === AccountOptionValue.existingAccount && account.accountId) {
    return importLinkableAccounts.value.find((a) => a.id === account.accountId) ?? null;
  }
  return null;
});

const handleAccountSelect = (account: AccountModel | null) => {
  importStore.columnMapping.account = {
    option: AccountOptionValue.existingAccount,
    accountId: account?.id ?? '',
  };
};

// --- Currency ---

const currencyMethodOptions = computed<MethodOption[]>(() => [
  {
    label: t('pages.importExport.currencyMapping.methodOptions.dataSourceColumn'),
    value: CurrencyOptionValue.dataSourceColumn,
  },
  {
    label: t('pages.importExport.currencyMapping.methodOptions.existingCurrency'),
    value: CurrencyOptionValue.existingCurrency,
  },
]);

const currencyMethodOption = computed<MethodOption | null>(() =>
  findMethodOption({ options: currencyMethodOptions.value, value: m.value.currency?.option }),
);

const currencyUsesColumn = computed(() => m.value.currency?.option === CurrencyOptionValue.dataSourceColumn);
const currencyUsesExisting = computed(() => m.value.currency?.option === CurrencyOptionValue.existingCurrency);

const handleCurrencyMethodChange = (option: MethodOption | null) => {
  if (!option) {
    importStore.columnMapping.currency = null;
    return;
  }
  if (option.value === CurrencyOptionValue.dataSourceColumn) {
    importStore.columnMapping.currency = { option: CurrencyOptionValue.dataSourceColumn, columnName: '' };
  } else {
    importStore.columnMapping.currency = { option: CurrencyOptionValue.existingCurrency, currencyCode: '' };
  }
};

const handleCurrencyColumnChange = (column: string | null) => {
  if (m.value.currency?.option === CurrencyOptionValue.dataSourceColumn) {
    importStore.columnMapping.currency = { option: CurrencyOptionValue.dataSourceColumn, columnName: column ?? '' };
  }
};

const selectedCurrency = computed<CurrencyWithDisplay | null>(() => {
  const currency = m.value.currency;
  if (currency?.option === CurrencyOptionValue.existingCurrency && currency.currencyCode) {
    return currencies.value.find((c) => c.code === currency.currencyCode) ?? null;
  }
  return null;
});

const handleCurrencySelect = (currency: CurrencyWithDisplay | null) => {
  importStore.columnMapping.currency = {
    option: CurrencyOptionValue.existingCurrency,
    currencyCode: currency?.code ?? '',
  };
};

// --- Transaction type ---

const transactionTypeMethodOptions = computed<MethodOption[]>(() => [
  {
    label: t('pages.importExport.transactionTypeMapping.methodOptions.amountSign'),
    value: TransactionTypeOptionValue.amountSign,
  },
  {
    label: t('pages.importExport.transactionTypeMapping.methodOptions.dataSourceColumn'),
    value: TransactionTypeOptionValue.dataSourceColumn,
  },
]);

const transactionTypeMethodOption = computed<MethodOption | null>(() =>
  findMethodOption({ options: transactionTypeMethodOptions.value, value: m.value.transactionType.option }),
);

const transactionTypeUsesAmountSign = computed(
  () => m.value.transactionType.option === TransactionTypeOptionValue.amountSign,
);
const transactionTypeUsesColumn = computed(
  () => m.value.transactionType.option === TransactionTypeOptionValue.dataSourceColumn,
);

const handleTransactionTypeMethodChange = (option: MethodOption | null) => {
  if (!option) return;
  if (option.value === TransactionTypeOptionValue.amountSign) {
    importStore.columnMapping.transactionType = { option: TransactionTypeOptionValue.amountSign };
  } else {
    importStore.columnMapping.transactionType = {
      option: TransactionTypeOptionValue.dataSourceColumn,
      columnName: '',
      incomeValues: [],
      expenseValues: [],
    };
  }
};

// --- Complex row status helpers ---

/**
 * Status for a complex row. A row "has a value" once its method is chosen AND any
 * required decision is filled (a column for column-methods, an entity id for
 * single-existing, no extra decision for amount-sign).
 */
const categoryStatus = computed<MapRowStatus>(() =>
  deriveMapRowStatus({
    hasValue: isCategoryDecided({ category: m.value.category }),
    required: true,
    match: importStore.columnMatch?.category ?? null,
  }),
);

const accountStatus = computed<MapRowStatus>(() =>
  deriveMapRowStatus({
    hasValue: isAccountDecided({ account: m.value.account }),
    required: true,
    match: importStore.columnMatch?.account ?? null,
  }),
);

const currencyStatus = computed<MapRowStatus>(() =>
  deriveMapRowStatus({
    hasValue: isCurrencyDecided({ currency: m.value.currency }),
    required: true,
    match: importStore.columnMatch?.currency ?? null,
  }),
);

const transactionTypeStatus = computed<MapRowStatus>(() => {
  // Type-column values not yet assigned to income/expense are a blocking problem
  // the user must resolve here, so flag the row regardless of method-level decidedness.
  if (importStore.uncoveredTransactionTypeValues.length > 0) return 'needs-attention';
  return deriveMapRowStatus({
    hasValue: isTransactionTypeDecided({ transactionType: m.value.transactionType }),
    required: true,
    match: importStore.columnMatch?.transactionType ?? null,
  });
});

interface ComplexRow {
  id: 'category' | 'account' | 'currency' | 'transactionType';
  label: string;
  status: MapRowStatus;
  methodOption: MethodOption | null;
  methodOptions: MethodOption[];
  expanded: boolean;
  onMethodChange: (option: MethodOption | null) => void;
}

const complexRows = computed<ComplexRow[]>(() => [
  {
    id: 'category',
    label: t('pages.importExport.mapColumns.fields.category'),
    status: categoryStatus.value,
    methodOption: categoryMethodOption.value,
    methodOptions: categoryMethodOptions.value,
    expanded: false,
    onMethodChange: handleCategoryMethodChange,
  },
  {
    id: 'account',
    label: t('pages.importExport.mapColumns.fields.account'),
    status: accountStatus.value,
    methodOption: accountMethodOption.value,
    methodOptions: accountMethodOptions.value,
    expanded: false,
    onMethodChange: handleAccountMethodChange,
  },
  {
    id: 'currency',
    label: t('pages.importExport.mapColumns.fields.currency'),
    status: currencyStatus.value,
    methodOption: currencyMethodOption.value,
    methodOptions: currencyMethodOptions.value,
    expanded: false,
    onMethodChange: handleCurrencyMethodChange,
  },
  {
    id: 'transactionType',
    label: t('pages.importExport.mapColumns.fields.transactionType'),
    status: transactionTypeStatus.value,
    methodOption: transactionTypeMethodOption.value,
    methodOptions: transactionTypeMethodOptions.value,
    expanded: transactionTypeUsesColumn.value,
    onMethodChange: handleTransactionTypeMethodChange,
  },
]);

// ---------------------------------------------------------------------------
// Footer / navigation
// ---------------------------------------------------------------------------

const isAdvancing = computed(() => importStore.isDetectingDuplicates);

/** Short list of what still blocks the Next button, surfaced when it's disabled. */
const missingHint = computed(() => {
  const missing: string[] = [];
  if (!m.value.date) missing.push(t('pages.importExport.mapColumns.fields.date'));
  else if (!m.value.dateFieldOrder) missing.push(t('pages.importExport.mapColumns.dateFormat.label'));
  if (!m.value.amount) missing.push(t('pages.importExport.mapColumns.fields.amount'));
  if (categoryStatus.value === 'needs-attention') missing.push(t('pages.importExport.mapColumns.fields.category'));
  if (accountStatus.value === 'needs-attention') missing.push(t('pages.importExport.mapColumns.fields.account'));
  if (currencyStatus.value === 'needs-attention') missing.push(t('pages.importExport.mapColumns.fields.currency'));
  if (transactionTypeStatus.value === 'needs-attention') {
    missing.push(t('pages.importExport.mapColumns.fields.transactionType'));
  }

  if (missing.length === 0) return '';
  return t('pages.importExport.mapColumns.missingHint', { fields: missing.join(', ') });
});

const handleNext = async () => {
  // When a per-value method is active a Resolve step handles reconciliation,
  // so just advance; otherwise run duplicate detection (which advances to Review).
  if (importStore.needsAccountResolution || importStore.needsCategoriesResolveStep) {
    importStore.goNext();
    return;
  }
  try {
    await importStore.detectDuplicates();
  } catch {
    // Error captured in importStore.detectError and rendered in the Callout above.
  }
};
</script>
