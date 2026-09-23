<template>
  <MultiSelectField
    v-model:open="isOpen"
    v-model:search-term="searchQuery"
    :active="hasSelection"
    :label="placeholder ?? $t('fields.comboboxAccounts.allAccounts')"
    :selected-label="selectedLabel"
    :search-placeholder="$t('fields.comboboxAccounts.searchPlaceholder')"
    :field-label="label"
    :error-message="errorMessage"
    :disabled="disabled"
    :trigger-class="triggerClass"
    content-class="w-80"
    @clear="clearSelection"
  >
    <ScrollArea class="max-h-80" viewport-class="max-h-80">
      <div class="p-2">
        <div v-if="isLoading" class="text-muted-foreground py-4 text-center text-sm">
          {{ $t('common.loading') }}
        </div>
        <div v-else-if="!hasResults" class="text-muted-foreground py-4 text-center text-sm">
          {{ $t('fields.comboboxAccounts.noResults') }}
        </div>

        <template v-for="section in displaySections" :key="section.id">
          <!-- Grouped accounts: collapsible section with a tri-state select-all header. -->
          <Collapsible v-if="section.showHeader" :open="isSectionExpanded(section.id)" class="mb-0.5">
            <div class="hover:bg-accent flex items-center gap-2 rounded-md pr-2">
              <div class="flex shrink-0 cursor-pointer items-center py-2 pr-1 pl-2" @click="toggleSection(section)">
                <Checkbox
                  :model-value="sectionCheckState(section)"
                  @click.stop
                  @update:model-value="toggleSection(section)"
                />
              </div>
              <div
                class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2"
                @click="toggleSectionCollapse(section.id)"
              >
                <span class="min-w-0 flex-1 truncate text-left text-sm font-semibold">{{ section.label }}</span>
                <span
                  class="text-primary-text bg-primary/10 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium tabular-nums"
                >
                  {{ selectedInSection(section) }}/{{ section.accounts.length }}
                </span>
                <ChevronDownIcon
                  class="text-muted-foreground size-4 shrink-0 transition-transform duration-200"
                  :class="{ 'rotate-180': isSectionExpanded(section.id) }"
                />
              </div>
            </div>

            <CollapsibleContent>
              <div
                v-for="account in section.accounts"
                :key="account.id"
                role="option"
                :aria-selected="isSelected(account)"
                :class="
                  cn(
                    'hover:bg-accent flex w-full cursor-pointer items-center gap-2.5 rounded-md py-1.5 pr-2 pl-8',
                    isSelected(account) && 'bg-primary/5',
                  )
                "
                @click="toggleAccount(account)"
              >
                <Checkbox :model-value="isSelected(account)" @click.stop @update:model-value="toggleAccount(account)" />
                <AccountLogo :account="account" class="size-5 shrink-0" />
                <span class="min-w-0 flex-1 truncate text-sm">{{ account.name }}</span>
                <span class="text-muted-foreground shrink-0 text-xs">{{ account.currencyCode }}</span>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- No groups configured: flat account list, no section header. -->
          <template v-else>
            <div
              v-for="account in section.accounts"
              :key="account.id"
              role="option"
              :aria-selected="isSelected(account)"
              :class="
                cn(
                  'hover:bg-accent flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5',
                  isSelected(account) && 'bg-primary/5',
                )
              "
              @click="toggleAccount(account)"
            >
              <Checkbox :model-value="isSelected(account)" @click.stop @update:model-value="toggleAccount(account)" />
              <AccountLogo :account="account" class="size-5 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ account.name }}</span>
              <span class="text-muted-foreground shrink-0 text-xs">{{ account.currencyCode }}</span>
            </div>
          </template>
        </template>
      </div>
    </ScrollArea>
  </MultiSelectField>
</template>

<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import MultiSelectField from '@/components/fields/multi-select-field.vue';
import { Checkbox, type CheckedState } from '@/components/lib/ui/checkbox';
import { Collapsible, CollapsibleContent } from '@/components/lib/ui/collapsible';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { type GroupedAccountsGroup, useGroupedAccounts } from '@/composable/use-grouped-accounts';
import { cn } from '@/lib/utils';
import { AccountModel } from '@bt/shared/types';
import { ChevronDownIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  computeSectionCheckState,
  filterAccountsBySearch,
  filterGroupsBySearch,
  toggleAccountId,
  toggleSectionIds,
} from './account-multi-select-field.helpers';

/** Sentinel section id for the accounts that belong to no group. */
const UNGROUPED_SECTION_ID = '__ungrouped__';

interface DisplaySection {
  id: string;
  label: string;
  accounts: AccountModel[];
  /** Groups render a collapsible header; the flat "no groups configured" list does not. */
  showHeader: boolean;
}

const props = withDefaults(
  defineProps<{
    label?: string;
    /**
     * Selected account ids. An EMPTY array is the load-bearing "no filter" state —
     * it means every account is included, so hosts using this as a filter must treat
     * `[]` as "all accounts", not "none".
     */
    modelValue?: string[];
    placeholder?: string;
    errorMessage?: string;
    disabled?: boolean;
    /** Extra classes merged onto the trigger so a host can reshape it (e.g. the
     * Pivot Report renders it as a compact rounded filter pill). */
    triggerClass?: string;
    /** Surface archived accounts too. Off by default so the selectable universe
     * matches the account-group endpoint (active accounts only); the /transactions
     * filter opts in so history can still be narrowed to a since-archived account. */
    includeArchived?: boolean;
    /** Drop dedicated-flow accounts (loans, vehicles) from the list. The Pivot Report
     * opts in so its account filter only offers regular cash-flow accounts. */
    excludeDedicatedFlow?: boolean;
    /** Extra predicate narrowing the offered accounts, e.g. to the categories a budget plan may attach. */
    filterAccounts?: (account: AccountModel) => boolean;
  }>(),
  {
    label: undefined,
    modelValue: () => [],
    placeholder: undefined,
    errorMessage: undefined,
    triggerClass: undefined,
    filterAccounts: undefined,
  },
);

const emit = defineEmits<{
  'update:model-value': [value: string[]];
}>();

const { t } = useI18n();
const { groups, ungroupedAccounts, isLoading } = useGroupedAccounts({
  includeArchived: props.includeArchived,
  excludeDedicatedFlow: props.excludeDedicatedFlow,
});

const isOpen = ref(false);
const searchQuery = ref('');

const selectedIds = computed<Set<string>>(() => new Set(props.modelValue ?? []));
const hasSelection = computed(() => (props.modelValue?.length ?? 0) > 0);
const isSelected = (account: AccountModel) => selectedIds.value.has(account.id);

// --- Trigger summary ------------------------------------------------------

const selectedLabel = computed(() => {
  const count = props.modelValue?.length ?? 0;
  return count === 1
    ? t('fields.comboboxAccounts.selectedOne')
    : t('fields.comboboxAccounts.selectedMany', { n: count });
});

// --- Filtering ------------------------------------------------------------

const normalizedSearch = computed(() => searchQuery.value.trim().toLowerCase());
const isSearching = computed(() => normalizedSearch.value.length > 0);

const offeredGroups = computed<GroupedAccountsGroup[]>(() => {
  const predicate = props.filterAccounts;
  if (!predicate) return groups.value;
  return groups.value
    .map((group) => ({ ...group, accounts: group.accounts.filter(predicate) }))
    .filter((group) => group.accounts.length > 0);
});

const offeredUngrouped = computed<AccountModel[]>(() =>
  props.filterAccounts ? ungroupedAccounts.value.filter(props.filterAccounts) : ungroupedAccounts.value,
);

const filteredGroups = computed<GroupedAccountsGroup[]>(() =>
  filterGroupsBySearch({ groups: offeredGroups.value, term: normalizedSearch.value }),
);

const filteredUngrouped = computed<AccountModel[]>(() =>
  filterAccountsBySearch({ accounts: offeredUngrouped.value, term: normalizedSearch.value }),
);

/** True when any group keeps an offered account (before search filtering). */
const accountsAreGrouped = computed(() => offeredGroups.value.length > 0);

const displaySections = computed<DisplaySection[]>(() => {
  const sections: DisplaySection[] = filteredGroups.value.map((group) => ({
    id: group.id,
    label: group.name,
    accounts: group.accounts,
    showHeader: true,
  }));

  if (filteredUngrouped.value.length > 0) {
    sections.push({
      id: UNGROUPED_SECTION_ID,
      label: t('fields.accountMultiSelect.ungrouped'),
      accounts: filteredUngrouped.value,
      // With no groups at all, the whole list is ungrouped — render it flat rather
      // than nesting every account under a lone "Ungrouped" header.
      showHeader: accountsAreGrouped.value,
    });
  }

  return sections;
});

const hasResults = computed(() => displaySections.value.some((section) => section.accounts.length > 0));

// --- Collapse -------------------------------------------------------------

const collapsedSections = ref(new Set<string>());

const isSectionExpanded = (sectionId: string) => isSearching.value || !collapsedSections.value.has(sectionId);

const toggleSectionCollapse = (sectionId: string) => {
  const next = new Set(collapsedSections.value);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  collapsedSections.value = next;
};

// --- Selection ------------------------------------------------------------

const selectedInSection = (section: DisplaySection) =>
  section.accounts.filter((account) => selectedIds.value.has(account.id)).length;

const sectionCheckState = (section: DisplaySection): CheckedState =>
  computeSectionCheckState({ accounts: section.accounts, selectedIds: selectedIds.value });

const toggleAccount = (account: AccountModel) =>
  emit('update:model-value', toggleAccountId({ selected: props.modelValue ?? [], accountId: account.id }));

const toggleSection = (section: DisplaySection) =>
  emit(
    'update:model-value',
    toggleSectionIds({ selected: props.modelValue ?? [], sectionAccountIds: section.accounts.map((a) => a.id) }),
  );

const clearSelection = () => emit('update:model-value', []);
</script>
