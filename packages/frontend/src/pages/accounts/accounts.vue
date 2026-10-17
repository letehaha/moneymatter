<template>
  <PageWrapper>
    <div class="@container/accounts-page">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <h1 class="text-3xl font-semibold tracking-tight">{{ $t('accounts.title') }}</h1>

        <!-- Wide: both buttons inline. Narrow: collapse into a kebab menu so the actions
             never wrap onto their own row. Popover-with-dialog-trigger mirrors the sidebar. -->
        <div class="hidden flex-wrap gap-2 @[35rem]/accounts-page:flex">
          <AccountsSortMenu trigger-variant="labeled" />

          <CreateVehicleDialog>
            <UiButton variant="outline">{{ $t('accounts.createVehicle') }}</UiButton>
          </CreateVehicleDialog>

          <CreatePropertyDialog>
            <UiButton variant="outline">{{ $t('accounts.createProperty') }}</UiButton>
          </CreatePropertyDialog>

          <CreateAccountDialog>
            <UiButton>{{ $t('accounts.createAccount') }}</UiButton>
          </CreateAccountDialog>
        </div>

        <div class="flex items-center gap-2 @[35rem]/accounts-page:hidden">
          <AccountsSortMenu trigger-variant="icon" />

          <Popover.Popover :open="isActionsMenuOpen" @update:open="isActionsMenuOpen = $event">
            <Popover.PopoverTrigger as-child>
              <UiButton variant="outline" size="icon" :aria-label="$t('accounts.actionsMenu')">
                <EllipsisVerticalIcon class="size-4" />
              </UiButton>
            </Popover.PopoverTrigger>
            <Popover.PopoverContent align="end" class="w-52 p-1">
              <CreateVehicleDialog @created="isActionsMenuOpen = false">
                <UiButton variant="ghost" class="w-full justify-start">
                  <CarIcon class="size-4" />
                  {{ $t('accounts.createVehicle') }}
                </UiButton>
              </CreateVehicleDialog>
              <CreatePropertyDialog @created="isActionsMenuOpen = false">
                <UiButton variant="ghost" class="w-full justify-start">
                  <HomeIcon class="size-4" />
                  {{ $t('accounts.createProperty') }}
                </UiButton>
              </CreatePropertyDialog>
              <CreateAccountDialog @created="isActionsMenuOpen = false">
                <UiButton variant="ghost" class="w-full justify-start">
                  <PlusIcon class="size-4" />
                  {{ $t('accounts.createAccount') }}
                </UiButton>
              </CreateAccountDialog>
            </Popover.PopoverContent>
          </Popover.Popover>
        </div>
      </div>

      <template v-if="isInitialLoading">
        <div class="grid grid-cols-1 gap-8">
          <Card>
            <div class="flex flex-wrap items-center justify-between gap-6 px-6 py-5">
              <div class="space-y-2">
                <div class="bg-muted h-3 w-24 animate-pulse rounded" />
                <div class="bg-muted h-9 w-48 animate-pulse rounded" />
              </div>
              <div class="flex gap-8">
                <div v-for="i in 3" :key="i" class="space-y-2">
                  <div class="bg-muted h-2.5 w-16 animate-pulse rounded" />
                  <div class="bg-muted h-5 w-20 animate-pulse rounded" />
                </div>
              </div>
            </div>
          </Card>

          <div class="border-border/60 divide-border/60 divide-y overflow-hidden rounded-xl border">
            <div v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
              <div class="bg-muted size-9 animate-pulse rounded-lg" />
              <div class="flex-1 space-y-2">
                <div class="bg-muted h-4 w-32 animate-pulse rounded" />
                <div class="bg-muted h-3 w-24 animate-pulse rounded" />
              </div>
              <div class="bg-muted h-5 w-20 animate-pulse rounded" />
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="accounts?.length || vehicles?.length || properties?.length">
        <div class="grid grid-cols-1 gap-5 @[30rem]/accounts-page:gap-8">
          <AccountsOverviewCard
            v-if="baseCurrencyCode"
            :overview="overview"
            :base-currency-code="baseCurrencyCode"
            :has-vehicles="!!vehiclesWithAccount.length"
            :has-properties="!!propertiesWithAccount.length"
            :planned="plannedTotals"
            :projected-total="projectedTotal"
          />

          <AccountsSection :title="$t('accounts.sections.bankConnections')" :count="bankConnectionsCount">
            <template #action>
              <UiButton size="sm" @click="openAddIntegrationDialog">
                <LinkIcon class="size-4" />
                <span class="@[30rem]/accounts-page:hidden">{{ $t('accounts.connect') }}</span>
                <span class="hidden @[30rem]/accounts-page:inline">{{ $t('accounts.connectBank') }}</span>
              </UiButton>
            </template>

            <div
              v-if="connectionRows.length"
              class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border"
            >
              <BankConnectionRow
                v-for="row in sortedConnectionRows"
                :key="row.connection.id"
                :connection="row.connection"
                :accounts="row.accounts"
                :folder-group-names="folderGroupNames"
              />
            </div>
            <p v-else class="text-muted-foreground px-1 py-2 text-sm">{{ $t('accounts.noBanksConnected') }}</p>
          </AccountsSection>

          <AccountsSection v-if="manualItems.length" :title="$t('accounts.sections.manual')" :count="manualCount">
            <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
              <template v-for="item in manualItems" :key="item.id">
                <AccountGroupRow v-if="item.kind === 'group'" :group="item.group" />
                <AccountListRow v-else :account="item.account" />
              </template>
            </div>
          </AccountsSection>

          <AccountsSection
            v-if="sharedAccounts.length"
            :title="$t('accounts.sections.sharedWithMe')"
            :count="sharedAccounts.length"
          >
            <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
              <AccountListRow v-for="account in sortedShared" :key="account.id" :account="account" />
            </div>
          </AccountsSection>

          <AccountsSection
            v-if="vehiclesWithAccount.length"
            :title="$t('accounts.sections.vehicles')"
            :count="vehiclesWithAccount.length"
          >
            <template v-if="baseCurrencyCode" #action>
              <GroupTotal
                :amount="vehiclesBaseTotal.total"
                :currency-code="baseCurrencyCode"
                :is-approx="vehiclesBaseTotal.isApprox"
                emphasis
              />
            </template>

            <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
              <AccountListRow
                v-for="vehicle in sortedVehicles"
                :key="vehicle.id"
                :account="vehicle.account!"
                :subtitle="`${vehicle.year} ${vehicle.make} ${vehicle.model}`"
                :category-override="ACCOUNT_CATEGORIES.vehicle"
              />
            </div>
          </AccountsSection>

          <AccountsSection
            v-if="propertiesWithAccount.length"
            :title="$t('accounts.sections.properties')"
            :count="propertiesWithAccount.length"
          >
            <template v-if="baseCurrencyCode" #action>
              <GroupTotal
                :amount="propertiesBaseTotal.total"
                :currency-code="baseCurrencyCode"
                :is-approx="propertiesBaseTotal.isApprox"
                emphasis
              />
            </template>

            <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
              <AccountListRow
                v-for="property in sortedProperties"
                :key="property.id"
                :account="property.account!"
                :subtitle="[property.city, property.country].filter(Boolean).join(', ') || property.address"
                :category-override="ACCOUNT_CATEGORIES.property"
              />
            </div>
          </AccountsSection>

          <section v-if="archivedAccounts.length">
            <Collapsible v-model:open="isArchivedOpen">
              <CollapsibleTrigger
                class="focus-visible:ring-ring/40 mb-3 flex w-full items-center gap-2 rounded px-1 focus-visible:ring-2 focus-visible:outline-none"
              >
                <h2 class="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
                  {{ $t('accounts.sections.archived') }}
                </h2>
                <span class="text-muted-foreground/70 text-xs font-medium tabular-nums">
                  {{ archivedAccounts.length }}
                </span>
                <ChevronDownIcon
                  class="text-muted-foreground size-3.5 transition-transform"
                  :class="{ 'rotate-180': isArchivedOpen }"
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
                  <AccountListRow v-for="account in sortedArchived" :key="account.id" :account="account" />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </section>
        </div>
      </template>

      <template v-else>
        <div class="py-12 text-center">
          <div class="mb-4">
            <LandmarkIcon class="text-muted-foreground mx-auto size-12" />
          </div>
          <h3 class="text-foreground mb-2 text-lg font-medium">{{ $t('accounts.empty.title') }}</h3>
          <p class="text-muted-foreground mb-6">
            {{ $t('accounts.empty.description') }}
          </p>

          <div class="mx-auto flex max-w-sm flex-col gap-3">
            <UiButton size="lg" @click="openAddIntegrationDialog">
              <LinkIcon class="size-5" />
              {{ $t('accounts.empty.connectBank') }}
            </UiButton>

            <CreateAccountDialog>
              <UiButton variant="outline">
                <PlusIcon class="size-4" />
                {{ $t('accounts.empty.createManual') }}
              </UiButton>
            </CreateAccountDialog>
          </div>
        </div>
      </template>

      <AddIntegrationDialog
        v-model:open="isDialogOpen"
        :providers="providers || []"
        @integration-added="handleIntegrationAdded"
      />
    </div>
  </PageWrapper>
</template>

<script setup lang="ts">
import { loadAccountGroups } from '@/api/account-groups';
import { type BankConnection, type BankProvider, listConnections, listProviders } from '@/api/bank-data-providers';
import { getProperties } from '@/api/properties';
import { getVehicles } from '@/api/vehicles';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { AccountGroups } from '@/common/types/models';
import PageWrapper from '@/components/common/page-wrapper.vue';
import CreateAccountDialog from '@/components/dialogs/create-account-dialog.vue';
import CreatePropertyDialog from '@/components/dialogs/create-property-dialog.vue';
import CreateVehicleDialog from '@/components/dialogs/create-vehicle-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card } from '@/components/lib/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/lib/ui/collapsible';
import * as Popover from '@/components/lib/ui/popover';
import GroupTotal from '@/components/sidebar/accounts-view/group-total.vue';
import { collectGroupAccounts } from '@/components/sidebar/accounts-view/helpers/account-totals';
import { useBaseBalanceTotals } from '@/composable/use-base-balance-totals';
import { useProjectedBalance } from '@/composable/use-projected-balance';
import AddIntegrationDialog from '@/pages/accounts/integrations/components/add-integration-dialog.vue';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, AccountModel } from '@bt/shared/types';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  CarIcon,
  ChevronDownIcon,
  EllipsisVerticalIcon,
  HomeIcon,
  LandmarkIcon,
  LinkIcon,
  PlusIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { computeAccountsOverview } from './accounts-overview-totals';
import AccountGroupRow from './components/account-group-row.vue';
import AccountListRow from './components/account-list-row.vue';
import AccountsOverviewCard from './components/accounts-overview-card.vue';
import AccountsSection from './components/accounts-section.vue';
import AccountsSortMenu from './components/accounts-sort-menu.vue';
import BankConnectionRow from './components/bank-connection-row.vue';
import { collectManualAccounts, mapFolderGroupNames, pruneBankLinkedAccounts } from './manual-accounts-split';
import { useAccountsSort } from './use-accounts-sort';

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { t } = useI18n();

const isActionsMenuOpen = ref(false);

const { sortConnectionRows, sortLeafAccounts, sortVehicles, sortProperties, sortManual } = useAccountsSort();

const { accounts, activeAccounts, isAccountsFetched } = storeToRefs(useAccountsStore());

const { data: accountGroups, isFetched: isGroupsFetched } = useQuery({
  queryFn: () => loadAccountGroups(),
  queryKey: VUE_QUERY_CACHE_KEYS.accountGroups,
  staleTime: Infinity,
  placeholderData: [] as AccountGroups[],
});

const { data: vehicles } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.vehiclesList,
  queryFn: getVehicles,
});

const { data: properties } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.propertiesList,
  queryFn: getProperties,
});

const { data: providers } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.bankProviders,
  queryFn: listProviders,
  staleTime: Infinity,
  placeholderData: [] as BankProvider[],
});

const { data: bankConnections, isFetched: isConnectionsFetched } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.bankConnections,
  queryFn: listConnections,
  staleTime: Infinity,
  placeholderData: [] as BankConnection[],
});

const { baseCurrencyCode, includeCreditLimit, sumBaseBalance } = useBaseBalanceTotals();

// Gate the skeleton on the groups and connections queries too: until they resolve every
// account would render as ungrouped and Bank connections would flash "no banks connected".
const isInitialLoading = computed(
  () => !isAccountsFetched.value || !isGroupsFetched.value || !isConnectionsFetched.value,
);

// id -> account map for every account nested anywhere in the group tree, so the
// ungrouped list can exclude anything already shown under a group.
const accountsInGroups = computed(() => {
  const flatten = (groups: AccountGroups[]): Record<string, AccountModel> =>
    groups.reduce(
      (acc, group) => {
        group.accounts.forEach((account) => {
          acc[account.id] = account;
        });
        if (group.childGroups.length) Object.assign(acc, flatten(group.childGroups));
        return acc;
      },
      {} as Record<string, AccountModel>,
    );

  return flatten(accountGroups.value ?? []);
});

// Bank connections are driven by the accounts' own connection link, not group membership:
// regrouping a synced account must never move it out of this section (or hide the connection).
const bankAccountsByConnectionId = computed(() => {
  const map = new Map<string, AccountModel[]>();
  for (const account of activeAccounts.value ?? []) {
    if (!account.bankDataProviderConnectionId || account.share?.isOwner === false) continue;
    const bucket = map.get(account.bankDataProviderConnectionId);
    if (bucket) bucket.push(account);
    else map.set(account.bankDataProviderConnectionId, [account]);
  }
  return map;
});

const connectionRows = computed(() =>
  (bankConnections.value ?? []).map((connection) => ({
    connection,
    accounts: bankAccountsByConnectionId.value.get(connection.id) ?? [],
  })),
);

// Manual section shows only manual accounts: folder groups pruned of bank-linked accounts
// (those render under their connection above), dropped entirely when nothing manual remains.
const manualFolderGroups = computed(() =>
  pruneBankLinkedAccounts({
    groups: (accountGroups.value ?? []).filter((group) => group.bankDataProviderConnectionId == null),
  }),
);

const folderGroupNames = computed(() => mapFolderGroupNames({ groups: accountGroups.value ?? [] }));

const vehicleAccountIds = computed(() => new Set((vehicles.value ?? []).map((v) => v.accountId)));

// Manual, ungrouped, owned money accounts: everything not already under a group,
// not a vehicle or loan (those have their own sections/pages), and not shared in.
const ungroupedAccounts = computed(() =>
  (activeAccounts.value ?? []).filter(
    (account) =>
      !accountsInGroups.value[account.id] &&
      account.accountCategory !== ACCOUNT_CATEGORIES.vehicle &&
      !vehicleAccountIds.value.has(account.id) &&
      account.accountCategory !== ACCOUNT_CATEGORIES.loan &&
      account.share?.isOwner !== false,
  ),
);

const sharedAccounts = computed(() => (accounts.value ?? []).filter((account) => account.share?.isOwner === false));

const archivedAccounts = computed(() =>
  (accounts.value ?? []).filter(
    (account) => account.status === ACCOUNT_STATUSES.archived && account.share?.isOwner !== false,
  ),
);

// Overview net worth spans grouped + ungrouped money accounts (vehicles and properties
// counted separately), excluding archived accounts so a grouped-but-archived one doesn't
// skew net worth.
const moneyAccounts = computed(() =>
  [...Object.values(accountsInGroups.value), ...ungroupedAccounts.value].filter(
    (account) =>
      account.accountCategory !== ACCOUNT_CATEGORIES.vehicle &&
      account.accountCategory !== ACCOUNT_CATEGORIES.property &&
      account.accountCategory !== ACCOUNT_CATEGORIES.loan &&
      account.status !== ACCOUNT_STATUSES.archived,
  ),
);

// VehicleModel.account is nullable — render/count only vehicles that have one, so the
// section, its count, its total, and the overview all agree and no row null-derefs.
// Shared-in vehicles render under "Shared with me" and stay out of the caller's totals.
const sharedAccountIds = computed(() => new Set(sharedAccounts.value.map((account) => account.id)));
const vehiclesWithAccount = computed(() =>
  (vehicles.value ?? []).filter((v) => v.account != null && !sharedAccountIds.value.has(v.accountId)),
);

// Same nullable-account guard as vehicles above.
const propertiesWithAccount = computed(() => (properties.value ?? []).filter((p) => p.account != null));

// Loose rows of the Manual section: ungrouped manual accounts, plus manual accounts a
// user placed inside a connection-managed group (that group only renders under Bank
// connections implicitly, so without this rescue they would vanish from the page).
const manualLooseAccounts = computed(() => [
  ...ungroupedAccounts.value.filter((account) => !account.bankDataProviderConnectionId),
  ...collectManualAccounts({
    groups: (accountGroups.value ?? []).filter((group) => group.bankDataProviderConnectionId != null),
  }),
]);

// Apply the shared sort choice to each section. Manual folds folder-groups and loose
// accounts into one tagged list so the chosen order can interleave them.
const sortedConnectionRows = computed(() => sortConnectionRows(connectionRows.value));
const manualItems = computed(() => sortManual(manualFolderGroups.value, manualLooseAccounts.value));
const sortedVehicles = computed(() => sortVehicles(vehiclesWithAccount.value));
const sortedProperties = computed(() => sortProperties(propertiesWithAccount.value));
const sortedShared = computed(() => sortLeafAccounts(sharedAccounts.value));
const sortedArchived = computed(() => sortLeafAccounts(archivedAccounts.value));

const vehicleAccounts = computed(() => vehiclesWithAccount.value.map((v) => v.account!));
const propertyAccounts = computed(() => propertiesWithAccount.value.map((p) => p.account!));

const overview = computed(() =>
  computeAccountsOverview({
    moneyAccounts: moneyAccounts.value,
    vehicleAccounts: vehicleAccounts.value,
    propertyAccounts: propertyAccounts.value,
    baseCurrencyCode: baseCurrencyCode.value,
    includeCreditLimit: includeCreditLimit.value,
  }),
);

// The planned-summary endpoint also covers archived accounts, so the projected total is
// scoped to the very accounts the real total above is built from.
const { aggregateFor } = useProjectedBalance();
const plannedTotals = computed(() => aggregateFor({ accountIds: moneyAccounts.value.map((account) => account.id) }));
const projectedTotal = computed(() => overview.value.total + plannedTotals.value.refPlannedDelta);

const connectionAccountsCount = computed(() => connectionRows.value.reduce((sum, row) => sum + row.accounts.length, 0));

const bankConnectionsCount = computed<string | undefined>(() => {
  if (!connectionRows.value.length) return undefined;
  return `${connectionRows.value.length} · ${t('accounts.accountsCount', { count: connectionAccountsCount.value })}`;
});

const manualCount = computed(() => {
  const inFolders = manualFolderGroups.value.reduce((sum, group) => sum + collectGroupAccounts({ group }).length, 0);
  return inFolders + manualLooseAccounts.value.length;
});

const vehiclesBaseTotal = computed(() => sumBaseBalance({ accounts: vehicleAccounts.value }));
const propertiesBaseTotal = computed(() => sumBaseBalance({ accounts: propertyAccounts.value }));

const isArchivedOpen = ref(false);

const isDialogOpen = ref(false);

const openAddIntegrationDialog = () => {
  isDialogOpen.value = true;
};

const handleIntegrationAdded = () => {
  isDialogOpen.value = false;
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.bankConnections });
};

// Deep link from onboarding / dashboard: `?connect=bank` opens the add-bank dialog,
// then the param is stripped so a refresh or back-nav doesn't reopen it.
onMounted(() => {
  if (route.query.connect === 'bank') {
    isDialogOpen.value = true;
    const nextQuery = { ...route.query };
    delete nextQuery.connect;
    router.replace({ query: nextQuery });
  }
});
</script>
