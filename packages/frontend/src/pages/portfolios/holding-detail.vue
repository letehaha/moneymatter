<template>
  <PageWrapper class="flex flex-col gap-4">
    <ResourceNotFound
      v-if="isNotFound"
      :title="$t('portfolioHolding.notFoundTitle')"
      :description="$t('portfolioHolding.notFoundDescription')"
      :link-label="$t('portfolioHolding.backToPortfolio')"
      :link-to="portfolioRoute"
    />

    <template v-else>
      <div class="@container/holding-header flex items-center gap-3">
        <DesktopOnlyTooltip :content="backLabel">
          <Button as-child variant="ghost" size="icon-sm" class="-ml-2 shrink-0">
            <router-link :to="portfolioRoute" :aria-label="backLabel">
              <ChevronLeftIcon class="size-4" />
            </router-link>
          </Button>
        </DesktopOnlyTooltip>

        <template v-if="holding && !loadError">
          <SecurityLogo v-if="holding.security" :security="holding.security" class="size-11 shrink-0" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2">
              <h1 class="truncate text-xl font-semibold tracking-tight @md/holding-header:text-2xl">
                {{ holding.security?.symbol }}
              </h1>
              <span
                class="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs font-semibold tracking-wide uppercase"
              >
                {{ securityMeta }}
              </span>
            </div>
            <p v-if="holding.security?.name" class="text-muted-foreground truncate text-sm">
              {{ holding.security.name }}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              class="w-9 px-0 @md/holding-header:w-auto @md/holding-header:px-3"
              :aria-label="$t('portfolioDetail.holdingsTable.actions.addTransaction')"
              @click="isAddTransactionOpen = true"
            >
              <PlusIcon class="size-4" />
              <span class="hidden @md/holding-header:inline">
                {{ $t('portfolioDetail.holdingsTable.actions.addTransaction') }}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <span class="inline-flex">
                  <DesktopOnlyTooltip :content="$t('common.actions.more')">
                    <Button variant="outline" size="sm" class="w-9 px-0" :aria-label="$t('common.actions.more')">
                      <EllipsisIcon class="size-4" />
                    </Button>
                  </DesktopOnlyTooltip>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="min-w-48">
                <DropdownMenuItem class="text-destructive-text" @click="isDeleteOpen = true">
                  <Trash2Icon class="size-4" />
                  {{ $t('portfolioDetail.holdingsTable.deleteHolding.ariaLabel') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </template>
        <template v-else-if="!loadError">
          <div class="bg-muted size-11 shrink-0 animate-pulse rounded-full" />
          <div class="bg-muted h-7 w-32 animate-pulse rounded" />
        </template>
      </div>

      <div
        v-if="loadError"
        class="bg-card flex flex-col items-center gap-2 rounded-xl border p-6 text-center"
        role="alert"
      >
        <div class="bg-destructive/10 flex size-10 items-center justify-center rounded-full">
          <TriangleAlertIcon class="text-destructive-text size-5" />
        </div>
        <p class="text-destructive-text text-sm">{{ $t('portfolioHolding.loadError') }}</p>
        <Button variant="outline" size="sm" @click="retryLoad">{{ $t('common.actions.retry') }}</Button>
      </div>

      <template v-if="holding && !loadError">
        <HoldingChartCard
          :holding="holding"
          :points="pricePoints"
          :trades="trades"
          :is-loading="isPricesLoading || isTransactionsLoading"
          :is-error="isPricesError"
          :is-trades-error="isTransactionsFailed"
          :average-cost="averageCost"
          @retry-prices="refetchPrices()"
          @retry-trades="refetchTransactions()"
        />

        <HoldingStats
          :holding="holding"
          :weight="weight"
          :average-cost="averageCost"
          :portfolio-name="portfolio?.name"
          :open-lots-count="transactions ? openLots.length : null"
          :first-purchase-date="firstPurchaseDate"
        />

        <HoldingTimingCard v-if="timing" :timing="timing" :currency-code="holding.currencyCode" />

        <Card class="min-w-0 overflow-hidden">
          <Tabs v-model="activeSection">
            <TabsList variant="underline" class="px-4">
              <TabsTrigger value="transactions">
                {{ $t('portfolioHolding.sections.transactions') }}
                <span v-if="transactions" class="text-muted-foreground tabular-nums">{{ transactions.length }}</span>
              </TabsTrigger>
              <TabsTrigger value="lots">
                {{ $t('portfolioHolding.sections.openLots') }}
                <span v-if="transactions" class="text-muted-foreground tabular-nums">{{ openLots.length }}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="transactions" class="@container py-2">
              <HoldingTransactionsSection
                :portfolio-id="portfolioId"
                :security-id="securityId"
                @add-transaction="isAddTransactionOpen = true"
              />
            </TabsContent>
            <TabsContent value="lots" class="py-2">
              <div v-if="isTransactionsLoading" class="flex flex-col gap-2 px-3 py-2">
                <div v-for="index in 3" :key="index" class="bg-muted h-10 animate-pulse rounded" />
              </div>
              <div
                v-else-if="isTransactionsFailed"
                class="flex flex-col items-center gap-3 py-10 text-center text-sm"
                role="alert"
              >
                <p class="text-destructive-text">{{ $t('portfolioHolding.lots.loadError') }}</p>
                <Button variant="outline" size="sm" @click="refetchTransactions()">
                  {{ $t('common.actions.retry') }}
                </Button>
              </div>
              <HoldingOpenLots v-else :lots="openLots" :currency-code="holding.currencyCode" />
            </TabsContent>
          </Tabs>
        </Card>
      </template>
      <template v-else-if="isHoldingsLoading">
        <div class="bg-muted h-96 animate-pulse rounded-lg" />
        <div class="bg-muted h-32 animate-pulse rounded-lg" />
      </template>
    </template>

    <AddHoldingTransactionDialog
      v-model:open="isAddTransactionOpen"
      :portfolio-id="portfolioId"
      :holding="holding"
      :portfolio-name="portfolio?.name"
    />

    <ResponsiveAlertDialog
      v-model:open="isDeleteOpen"
      :confirm-label="$t('portfolioDetail.holdingsTable.deleteHolding.confirmLabel')"
      confirm-variant="destructive"
      :confirm-disabled="deleteHoldingMutation.isPending.value"
      @confirm="confirmDeleteHolding"
    >
      <template #title>{{ $t('portfolioDetail.holdingsTable.deleteHolding.title') }}</template>
      <template #description>
        <i18n-t keypath="portfolioDetail.holdingsTable.deleteHolding.description" tag="span">
          <template #symbol>
            <strong>{{ holding?.security?.symbol ?? '' }}</strong>
          </template>
        </i18n-t>
      </template>
    </ResponsiveAlertDialog>
  </PageWrapper>
</template>

<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import PageWrapper from '@/components/common/page-wrapper.vue';
import ResourceNotFound from '@/components/common/resource-not-found.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import SecurityLogo from '@/components/common/security-logo.vue';
import AddHoldingTransactionDialog from '@/components/holdings/add-holding-transaction-dialog.vue';
import HoldingTransactionsSection from '@/components/holdings/holding-transactions-section.vue';
import { getHoldingWeights, getPrice } from '@/components/holdings/utils/holding-display';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/lib/ui/tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useDeleteHolding, useHoldings } from '@/composable/data-queries/holdings';
import { useAllHoldingTransactions } from '@/composable/data-queries/investment-transactions';
import { usePortfolio } from '@/composable/data-queries/portfolios';
import { useSecurityPrices } from '@/composable/data-queries/security-prices';
import { ApiErrorResponseError, getApiErrorMessage, isResourceMissingError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { ROUTES_NAMES } from '@/routes/constants';
import { API_ERROR_CODES } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { ChevronLeftIcon, EllipsisIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import HoldingChartCard from './components/holding-detail/holding-chart-card.vue';
import { buildOpenLots, getBuyTiming, getTrades, toPricePoints } from './components/holding-detail/holding-derivations';
import HoldingOpenLots from './components/holding-detail/holding-open-lots.vue';
import HoldingStats from './components/holding-detail/holding-stats.vue';
import HoldingTimingCard from './components/holding-detail/holding-timing-card.vue';
import { PORTFOLIO_TABS } from './portfolio-tabs';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const activeSection = ref('transactions');
const isAddTransactionOpen = ref(false);
const isDeleteOpen = ref(false);
const isDeleting = ref(false);

const portfolioId = computed(() => String(route.params.portfolioId));
const securityId = computed(() => String(route.params.securityId));

const portfolioRoute = computed(() => ({
  name: ROUTES_NAMES.portfolioDetail,
  params: { portfolioId: portfolioId.value },
  query: { tab: PORTFOLIO_TABS.holdings },
}));
const backLabel = computed(() => portfolio.value?.name ?? t('portfolioHolding.backToPortfolio'));

const {
  data: portfolio,
  isError: isPortfolioError,
  error: portfolioError,
  refetch: refetchPortfolio,
} = usePortfolio(portfolioId, {
  retry: false,
});
const {
  data: holdings,
  isLoading: isHoldingsLoading,
  isError: isHoldingsError,
  refetch: refetchHoldings,
} = useHoldings(portfolioId);
const {
  data: transactions,
  isLoading: isTransactionsLoading,
  isError: isTransactionsError,
  refetch: refetchTransactions,
} = useAllHoldingTransactions({
  portfolioId,
  securityId,
});
const {
  data: prices,
  isLoading: isPricesLoading,
  isError: isPricesError,
  refetch: refetchPrices,
} = useSecurityPrices({ securityId });

const holding = computed(() => holdings.value?.find((item) => item.securityId === securityId.value) ?? null);
const isNotFound = computed(
  () =>
    (isPortfolioError.value && isResourceMissingError(portfolioError.value)) ||
    (holdings.value !== undefined && holding.value === null && !isDeleting.value),
);

const isTransactionsFailed = computed(() => isTransactionsError.value && !transactions.value);
const isPortfolioLoadError = computed(
  () => isPortfolioError.value && !isResourceMissingError(portfolioError.value) && !portfolio.value,
);
const loadError = computed(() => (isHoldingsError.value && !holdings.value) || isPortfolioLoadError.value);
const retryLoad = () => {
  if (isPortfolioLoadError.value) refetchPortfolio();
  if (isHoldingsError.value) refetchHoldings();
};

const securityMeta = computed(() =>
  [holding.value?.security?.exchangeAcronym ?? holding.value?.security?.exchangeName, holding.value?.currencyCode]
    .filter(Boolean)
    .join(' · '),
);

const weight = computed(() =>
  holdings.value ? (getHoldingWeights({ holdings: holdings.value }).get(securityId.value) ?? null) : null,
);

const pricePoints = computed(() => toPricePoints({ prices: prices.value ?? [] }));
const trades = computed(() => getTrades({ transactions: transactions.value ?? [] }));
const currentPrice = computed(() => {
  const price = holding.value ? getPrice(holding.value) : 0;
  return price > 0 ? price : null;
});
const averageCost = computed(() => {
  const quantity = Number(holding.value?.quantity);
  const costBasis = Number(holding.value?.costBasis);
  return quantity > 0 && costBasis > 0 ? costBasis / quantity : null;
});
const openLots = computed(() => buildOpenLots({ trades: trades.value, price: currentPrice.value }));
const timing = computed(() => getBuyTiming({ trades: trades.value, points: pricePoints.value }));
const firstPurchaseDate = computed(
  () => trades.value.find((trade) => trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy)?.date ?? null,
);

const deleteHoldingMutation = useDeleteHolding();

const confirmDeleteHolding = async () => {
  isDeleting.value = true;
  try {
    await deleteHoldingMutation.mutateAsync({
      portfolioId: portfolioId.value,
      securityId: securityId.value,
      force: true,
    });
  } catch (err) {
    isDeleting.value = false;
    isDeleteOpen.value = false;
    addErrorNotification(
      getApiErrorMessage({
        e: err,
        t,
        conflictKey: 'portfolioDetail.holdingsTable.deleteHolding.error',
        fallbackKey: 'portfolioDetail.holdingsTable.deleteHolding.error',
      }),
    );
    if (!(err instanceof ApiErrorResponseError) || err.data?.code === API_ERROR_CODES.unexpected) {
      captureException({
        error: err,
        context: { source: 'confirmDeleteHolding', portfolioId: portfolioId.value, securityId: securityId.value },
      });
    }
    return;
  }

  isDeleteOpen.value = false;
  addSuccessNotification(t('portfolioDetail.holdingsTable.deleteHolding.success'));
  try {
    const failure = await router.replace(portfolioRoute.value);
    if (failure) isDeleting.value = false;
  } catch {
    isDeleting.value = false;
  }
};
</script>
