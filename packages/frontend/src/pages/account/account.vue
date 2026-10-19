<template>
  <div class="@container/settings">
    <div v-if="!isAccountsFetched" class="flex h-100 items-center justify-center">
      <div class="text-muted-foreground text-sm">{{ t('pages.account.loading') }}</div>
    </div>

    <ResourceNotFound
      v-else-if="!account"
      class="m-6"
      :title="t('pages.account.notFound')"
      :description="t('pages.account.notFoundDescription')"
      :link-label="t('pages.account.goToAccounts')"
      :link-to="{ name: ROUTES_NAMES.accounts }"
    />

    <!-- Vehicle accounts have a dedicated detail page; the redirect fires in the
         script. Show a loading state while the query is in-flight; show a
         terminal "not found" state if the query failed or no matching vehicle
         record exists (deleted sidecar / stale cache). -->
    <ResourceNotFound
      v-else-if="isVehicleAccount && (isVehiclesError || isVehicleNotFound)"
      class="m-6"
      :title="t('pages.account.notFound')"
      :description="t('pages.account.notFoundDescription')"
      :link-label="t('pages.account.goToAccounts')"
      :link-to="{ name: ROUTES_NAMES.accounts }"
    />
    <div v-else-if="isVehicleAccount" class="flex h-100 items-center justify-center">
      <div class="text-muted-foreground text-sm">{{ t('pages.account.loading') }}</div>
    </div>

    <!-- Property accounts follow the same dedicated-page redirect as vehicles. -->
    <ResourceNotFound
      v-else-if="isPropertyAccount && (isPropertiesError || isPropertyNotFound)"
      class="m-6"
      :title="t('pages.account.notFound')"
      :description="t('pages.account.notFoundDescription')"
      :link-label="t('pages.account.goToAccounts')"
      :link-to="{ name: ROUTES_NAMES.accounts }"
    />
    <div v-else-if="isPropertyAccount" class="flex h-100 items-center justify-center">
      <div class="text-muted-foreground text-sm">{{ t('pages.account.loading') }}</div>
    </div>

    <div v-else class="flex flex-col justify-start gap-4 p-6 @[800px]/settings:flex-row">
      <Card.Card class="w-full max-w-150">
        <Header :account="account" />

        <!-- Account re-link warning banner -->
        <Callout
          v-if="account.needsRelink"
          variant="destructive"
          :title="t('pages.account.relinkWarning.title')"
          class="mx-6 mb-4"
        >
          <p class="text-muted-foreground text-xs">
            {{ t('pages.account.relinkWarning.description') }}
            <span class="text-foreground font-medium">"{{ t('pages.account.relinkWarning.connectionValidity') }}"</span>
            {{ t('pages.account.relinkWarning.in') }}
            <router-link
              v-if="account.bankDataProviderConnectionId"
              :to="{
                name: ROUTES_NAMES.accountIntegrationDetails,
                params: { connectionId: account.bankDataProviderConnectionId },
              }"
              class="text-primary-text hover:text-primary-text/80 inline-flex items-center gap-0.5 font-medium underline underline-offset-2"
            >
              {{ t('pages.account.relinkWarning.connectionSettings') }}
            </router-link>
            <template v-else>{{ t('pages.account.relinkWarning.settings') }}</template
            >{{ t('pages.account.relinkWarning.ifPersists') }}
            <span class="text-foreground font-medium">"{{ t('pages.account.relinkWarning.unlink') }}"</span>
            {{ t('pages.account.relinkWarning.belowThenLink') }}
          </p>
        </Callout>

        <Separator />

        <Card.CardContent>
          <template v-if="account.bankDataProviderConnectionId">
            <BankConnectionView :account="account" />
          </template>
          <template v-else>
            <SystemAccount :account="account" />
          </template>
        </Card.CardContent>
      </Card.Card>

      <Card.Card class="w-full max-w-150 pt-6">
        <Card.CardContent>
          <Tabs.Tabs default-value="records">
            <Tabs.TabsList class="w-full justify-start">
              <Tabs.TabsTrigger value="records">{{ t('pages.account.rightPanel.transactions') }}</Tabs.TabsTrigger>
              <Tabs.TabsTrigger disabled value="analytics">{{
                t('pages.account.rightPanel.analyticsSoon')
              }}</Tabs.TabsTrigger>
            </Tabs.TabsList>
            <Tabs.TabsContent value="records">
              <template v-if="isFetched">
                <ScrollArea :scroll-area-id="SCROLL_AREA_IDS.accountTransactions" class="h-screen max-h-150">
                  <TransactionsList
                    :hasNextPage="hasNextPage"
                    :transactions="rawTransactionsList"
                    :isFetchingNextPage="isFetchingNextPage"
                    :scroll-area-id="SCROLL_AREA_IDS.accountTransactions"
                    @fetch-next-page="fetchNextPage"
                  />
                </ScrollArea>
              </template>
            </Tabs.TabsContent>
          </Tabs.Tabs>
        </Card.CardContent>
      </Card.Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { loadTransactions } from '@/api';
import { getProperties } from '@/api/properties';
import { getVehicles } from '@/api/vehicles';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import { captureException } from '@/lib/sentry';
import * as Card from '@/components/lib/ui/card';
import { Callout } from '@/components/lib/ui/callout';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { Separator } from '@/components/lib/ui/separator';
import * as Tabs from '@/components/lib/ui/tabs';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore } from '@/stores';
import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import Header from './components/header.vue';
import { isGenuineSidecarOrphan } from './is-sidecar-orphan';
import BankConnectionView from './types/bank-connection/index.vue';
import SystemAccount from './types/system/system.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const accountsStore = useAccountsStore();
const { accounts, accountsRecord, isAccountsFetched } = storeToRefs(accountsStore);
const account = computed(() => accountsRecord.value[route.params.id as string] ?? null);

// The accounts store's query has staleTime: Infinity and is only refetched on
// explicit refetchAccounts() calls (e.g. after connecting a bank). When the
// user lands on this page right after a fresh bank connection, the store may
// not yet contain the newly-created account — even though the backend has it.
// Without this safeguard, the page would render "not found" until a full page
// reload. Try one refetch per id before deciding the account is really gone.
const refetchAttemptedForId = ref<string | null>(null);
watch(
  [() => route.params.id, isAccountsFetched],
  async ([id, fetched]) => {
    const accountId = id as string;
    if (!fetched || !accountId) return;
    if (accountsRecord.value[accountId]) return;
    if (refetchAttemptedForId.value === accountId) return;
    refetchAttemptedForId.value = accountId;
    await accountsStore.refetchAccounts();
  },
  { immediate: true },
);

// A vehicle is stored as a regular `system` account, so its id can land on this
// generic page. The generic page exposes balance-adjustment / add-transaction /
// archive actions that are all invalid for a vehicle (the backend rejects them),
// so bounce to the dedicated vehicle detail page instead.
const isVehicleAccount = computed(() => account.value?.accountCategory === ACCOUNT_CATEGORIES.vehicle);

const {
  data: vehicles,
  isError: isVehiclesError,
  isSuccess: isVehiclesSuccess,
} = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.vehiclesList,
  queryFn: getVehicles,
  enabled: isVehicleAccount,
});

// Derived: query settled but no vehicle matches this account id (stale cache /
// sidecar deleted). Treat it the same as an error — both are terminal states.
const isVehicleNotFound = computed(
  () => isVehiclesSuccess.value && !vehicles.value?.find((v) => v.accountId === account.value?.id),
);

watch(
  [isVehicleAccount, vehicles],
  ([isVehicle, list]) => {
    if (!isVehicle) return;
    const vehicleId = list?.find((v) => v.accountId === account.value?.id)?.id;
    if (vehicleId) {
      router.replace({ name: ROUTES_NAMES.accountsVehicleDetails, params: { id: vehicleId } });
    }
  },
  { immediate: true },
);

// Report a genuine orphan only. A ghost account (deleted, gone from the live
// list) has no vehicle record legitimately and renders the not-found view, so
// capturing it would be noise.
watch(isVehicleNotFound, (notFound) => {
  if (!notFound) return;
  if (
    !isGenuineSidecarOrphan({
      accountId: account.value?.id,
      category: ACCOUNT_CATEGORIES.vehicle,
      liveAccounts: accounts.value ?? [],
      sidecarRecords: vehicles.value ?? [],
    })
  ) {
    return;
  }
  captureException({
    error: new Error('Vehicle account has no matching vehicle record'),
    context: { accountId: account.value?.id, source: 'accountPage' },
  });
});

// A property is stored as a regular `system` account, so its id can land on this
// generic page too. Same reasoning as vehicles above: the generic actions are all
// rejected by the backend for a property, so bounce to its dedicated page.
const isPropertyAccount = computed(() => account.value?.accountCategory === ACCOUNT_CATEGORIES.property);

const {
  data: properties,
  isError: isPropertiesError,
  isSuccess: isPropertiesSuccess,
} = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.propertiesList,
  queryFn: getProperties,
  enabled: isPropertyAccount,
});

const isPropertyNotFound = computed(
  () => isPropertiesSuccess.value && !properties.value?.find((p) => p.accountId === account.value?.id),
);

watch(
  [isPropertyAccount, properties],
  ([isProperty, list]) => {
    if (!isProperty) return;
    const propertyId = list?.find((p) => p.accountId === account.value?.id)?.id;
    if (propertyId) {
      router.replace({ name: ROUTES_NAMES.accountsPropertyDetails, params: { id: propertyId } });
    }
  },
  { immediate: true },
);

watch(isPropertyNotFound, (notFound) => {
  if (!notFound) return;
  if (
    !isGenuineSidecarOrphan({
      accountId: account.value?.id,
      category: ACCOUNT_CATEGORIES.property,
      liveAccounts: accounts.value ?? [],
      sidecarRecords: properties.value ?? [],
    })
  ) {
    return;
  }
  captureException({
    error: new Error('Property account has no matching property record'),
    context: { accountId: account.value?.id, source: 'accountPage' },
  });
});

// A loan is a regular `system` account, so its id can land on this page; the
// balance/category edits here are rejected for loans, so redirect to the loan page
// (id IS the account id). Loans shared with the user stay here — the loans page is owner-scoped only.
const isOwnLoanAccount = computed(
  () => account.value?.accountCategory === ACCOUNT_CATEGORIES.loan && account.value?.share?.isOwner !== false,
);

watch(
  isOwnLoanAccount,
  (isOwnLoan) => {
    if (isOwnLoan && account.value?.id) {
      router.replace({ name: ROUTES_NAMES.loanDetail, params: { id: account.value.id } });
    }
  },
  { immediate: true },
);

const limit = 10;

const fetchTransactions = ({ pageParam }: { pageParam: number }) => {
  const offset = pageParam * limit;
  return loadTransactions({ limit, offset, accountIds: [account.value!.id] });
};

const {
  data: transactionsPages,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isFetched,
} = useInfiniteQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.accountSpecificTransactions, account],
  queryFn: fetchTransactions,
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => {
    // No more pages to load
    if (lastPage.length < limit) return undefined;
    // returns the number of pages fetched so far as the next page param
    return pages.length;
  },
  enabled: computed(() => isAccountsFetched.value && !!account.value),
  staleTime: Infinity,
});

const rawTransactionsList = computed(() => transactionsPages.value?.pages?.flat() || []);
</script>
