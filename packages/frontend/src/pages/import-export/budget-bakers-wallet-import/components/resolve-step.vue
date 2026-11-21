<script setup lang="ts">
/**
 * BudgetBakers Wallet resolve step — reconciles every Wallet account + non-transfer category
 * against the user's existing app data using the shared mapping tables. Mirrors
 * the CSV importer's resolve step: each row is either "create new" or
 * "link to existing", or skipped entirely, with per-entity bulk-action toolbars.
 *
 * Wallet-only addition: each `create-new` account row exposes an optional
 * "current balance" input (the `create-new-cell` slot). Leaving it blank lets
 * the imported transactions' sum drive the final balance.
 */
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import RecalculateBalanceToggle from '@/pages/import-export/components/recalculate-balance-toggle.vue';
import AccountMappingTable from '@/pages/import-export/components/resolve-values-step/account-mapping-table.vue';
import CategoryMappingTable from '@/pages/import-export/components/resolve-values-step/category-mapping-table.vue';
import { type QuickAction } from '@/pages/import-export/components/resolve-values-step/quick-action-toolbar.vue';
import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useImportBudgetBakersWalletStore } from '@/stores/import-budget-bakers-wallet';
import { ChevronLeftIcon, ChevronRightIcon, LinkIcon, PlusIcon, RefreshCwIcon, SparklesIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const store = useImportBudgetBakersWalletStore();
const accountsStore = useAccountsStore();
const categoriesStore = useCategoriesStore();

const { importLinkableAccounts } = storeToRefs(accountsStore);
const { formattedCategories } = storeToRefs(categoriesStore);

// ---- Table items ----

/** Source accounts mapped to the shared table's item shape. */
const accountItems = computed(() =>
  (store.parsedResult?.accounts ?? []).map((account) => ({
    name: account.originalName,
    currency: account.currency,
    transactionCount: account.transactionCount,
  })),
);

/**
 * Non-transfer source categories for the table. `resolvableCategoryNames`
 * already strips the transfer marker; pair each with its transaction count.
 */
const categoryItems = computed(() => {
  const countByName = new Map<string, number>();
  for (const category of store.parsedResult?.categories ?? []) {
    countByName.set(category.name, category.transactionCount);
  }
  return store.resolvableCategoryNames.map((name) => ({ name, transactionCount: countByName.get(name) }));
});

// ---- Current-balance input bridge (Wallet-only) ----

/** Stored decimal balance for a create-new account, or null when unset. */
function balanceInputValue(name: string): number | null {
  const mapping = store.accountMapping[name];
  if (mapping?.action !== 'create-new') return null;
  return mapping.currentBalance;
}

/**
 * Number InputField emits `number | null` (null = cleared). Pass it straight
 * through: null leaves the balance equal to the sum of imported transactions.
 */
function onBalanceInput({ name, value }: { name: string; value: string | number | null }): void {
  store.setAccountCurrentBalance({ name, currentBalance: typeof value === 'number' ? value : null });
}

// ---- Quick-action toolbars (mirror CSV) ----

const accountQuickActions = computed<QuickAction[]>(() => [
  {
    icon: LinkIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.mapExactMatches'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.mapExactMatchesAccounts'),
    onClick: () => store.quickMapExactMatches({ entity: 'accounts' }),
    menu: true,
  },
  {
    icon: PlusIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.createNewForUnmatched'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.createNewForUnmatched'),
    onClick: () => store.quickCreateNewForUnmatched({ entity: 'accounts' }),
    menu: true,
  },
  {
    icon: RefreshCwIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.reset'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.reset'),
    onClick: () => store.resetResolveEntity({ entity: 'accounts' }),
  },
]);

const categoryQuickActions = computed<QuickAction[]>(() => [
  {
    icon: LinkIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.mapExactMatches'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.mapExactMatchesCategories'),
    onClick: () => store.quickMapExactMatches({ entity: 'categories' }),
    menu: true,
  },
  {
    icon: SparklesIcon,
    label: t('importShared.aiMapping.action'),
    tooltip: t('importShared.aiMapping.tooltipCategories'),
    onClick: () => store.quickAiMapCategories(),
    disabled: store.isAiMappingCategories,
    menu: true,
  },
  {
    icon: PlusIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.createNewForUnmatched'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.createNewForUnmatched'),
    onClick: () => store.quickCreateNewForUnmatched({ entity: 'categories' }),
    menu: true,
  },
  {
    icon: RefreshCwIcon,
    label: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.reset'),
    tooltip: t('pages.importExport.budgetBakersWalletImport.resolve.quickActions.tooltips.reset'),
    onClick: () => store.resetResolveEntity({ entity: 'categories' }),
  },
]);

// ---- Mount: ensure link targets are loaded + auto-match ----

onMounted(() => {
  store.prepareResolveStep();
});

// ---- Footer nav ----

const isNavigating = ref(false);

async function handleContinue() {
  isNavigating.value = true;
  try {
    await store.detectDuplicates();
  } catch {
    // Error captured in store.detectError and shown via Callout.
  } finally {
    isNavigating.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- ==================== ACCOUNTS SECTION ==================== -->
    <AccountMappingTable
      :items="accountItems"
      :mapping="store.accountMapping"
      :available-accounts="importLinkableAccounts"
      :title="$t('pages.importExport.budgetBakersWalletImport.resolve.accounts.sectionTitle')"
      :resolved-label="$t('pages.importExport.budgetBakersWalletImport.resolve.resolvedCounterWord')"
      :quick-actions="accountQuickActions"
      allow-skip
      @set-action="store.setAccountAction"
      @set-target="store.setAccountTarget"
    >
      <!-- Wallet-only: optional current-balance input for create-new accounts. -->
      <template #create-new-cell="{ item }">
        <div class="flex flex-col gap-1">
          <InputField
            type="number"
            :model-value="balanceInputValue(item.name)"
            :label="$t('pages.importExport.budgetBakersWalletImport.resolve.accounts.currentBalanceLabel')"
            :placeholder="$t('pages.importExport.budgetBakersWalletImport.resolve.accounts.currentBalancePlaceholder')"
            @update:model-value="(value) => onBalanceInput({ name: item.name, value })"
          />
          <span class="text-muted-foreground text-xs">
            {{
              $t('pages.importExport.budgetBakersWalletImport.resolve.accounts.willCreateHint', {
                currency: item.currency || '—',
              })
            }}
          </span>
        </div>
      </template>
    </AccountMappingTable>

    <Callout v-if="store.skippedAccountNames.length > 0" variant="warning">
      <p>
        {{
          $t('pages.importExport.budgetBakersWalletImport.resolve.accounts.skippedNote', {
            count: store.skippedAccountNames.length,
          })
        }}
      </p>
    </Callout>

    <!-- ==================== CATEGORIES SECTION ==================== -->
    <CategoryMappingTable
      :loading="store.isAiMappingCategories"
      :items="categoryItems"
      :mapping="store.categoryMapping"
      :available-categories="formattedCategories"
      :title="$t('pages.importExport.budgetBakersWalletImport.resolve.categories.sectionTitle')"
      :resolved-label="$t('pages.importExport.budgetBakersWalletImport.resolve.resolvedCounterWord')"
      :quick-actions="categoryQuickActions"
      :matching-preset="store.matchingCategoryPreset"
      :named-presets="store.namedCategoryPresets"
      @set-action="store.setCategoryAction"
      @set-target="store.setCategoryTarget"
      @apply-preset="store.applyCategoryPreset"
      @rename-preset="store.renameCategoryPreset"
      @delete-preset="store.deleteCategoryPreset"
    />

    <Callout v-if="store.aiMappingCategoriesError" variant="destructive" role="alert">
      <p>{{ store.aiMappingCategoriesError }}</p>
    </Callout>

    <!-- ==================== BALANCE RECALCULATION ==================== -->
    <RecalculateBalanceToggle
      v-model="store.recalculateBalance"
      :settings-loading="store.recalculateBalanceSettingLoading"
      :settings-load-failed="store.recalculateBalanceSettingLoadFailed"
    />

    <!-- Detect error from store (e.g. network failure during detectDuplicates) -->
    <Callout v-if="store.detectError" variant="destructive" role="alert">
      <p>{{ store.detectError }}</p>
    </Callout>

    <!-- ==================== FOOTER ==================== -->
    <div class="flex items-center justify-between pt-2">
      <UiButton variant="ghost" @click="store.goBack()">
        <ChevronLeftIcon class="size-4" />
        {{ $t('pages.importExport.budgetBakersWalletImport.resolve.footer.back') }}
      </UiButton>

      <UiButton
        :disabled="
          !store.isResolveStepValid || isNavigating || store.isDetectingDuplicates || store.isAiMappingCategories
        "
        @click="handleContinue"
      >
        {{ $t('pages.importExport.budgetBakersWalletImport.resolve.footer.continue') }}
        <ChevronRightIcon class="size-4" />
      </UiButton>
    </div>
  </div>
</template>
