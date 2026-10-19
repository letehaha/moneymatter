<template>
  <PageWrapper>
    <div v-if="isLoading" class="@container/property grid gap-6">
      <div class="bg-card h-28 animate-pulse rounded-2xl"></div>
      <div class="grid gap-4 @lg/property:grid-cols-3">
        <div class="bg-card h-24 animate-pulse rounded-2xl"></div>
        <div class="bg-card h-24 animate-pulse rounded-2xl"></div>
        <div class="bg-card h-24 animate-pulse rounded-2xl"></div>
      </div>
      <div class="bg-card h-96 animate-pulse rounded-2xl"></div>
    </div>

    <div
      v-else-if="!property || !property.account"
      class="flex flex-col items-center justify-center gap-3 py-20 text-center"
    >
      <HomeIcon class="text-muted-foreground/40 size-12" />
      <h3 class="text-foreground text-lg font-medium">{{ $t('pages.propertyDetails.notFound') }}</h3>
      <RouterLink :to="{ name: ROUTES_NAMES.accounts }">
        <UiButton variant="outline" size="sm">{{ $t('pages.propertyDetails.backToAccounts') }}</UiButton>
      </RouterLink>
    </div>

    <div v-else class="@container/property grid gap-6">
      <!-- Hero / header -->
      <section
        class="bg-card relative overflow-hidden rounded-2xl border shadow-xs"
        :style="{
          '--hero-accent': gainDirection === 'down' ? 'var(--app-expense-color)' : 'var(--app-income-color)',
        }"
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 opacity-[0.06]"
          :style="{
            background:
              'radial-gradient(circle at 100% 0%, var(--primary), transparent 55%), radial-gradient(circle at 0% 100%, var(--hero-accent), transparent 50%)',
          }"
        ></div>

        <div
          class="absolute top-5 right-5 z-10 flex flex-wrap justify-end gap-2 @md/property:top-6 @md/property:right-6"
        >
          <UiButton variant="outline" @click="isRevalueOpen = true">
            {{ $t('pages.propertyDetails.revalueButton') }}
          </UiButton>
          <UiButton variant="outline" @click="isEditOpen = true">
            {{ $t('pages.propertyDetails.editButton') }}
          </UiButton>
          <DesktopOnlyTooltip :content="$t('pages.propertyDetails.deleteTitle')">
            <UiButton variant="soft-destructive" size="icon" @click="isDeleteOpen = true">
              <Trash2Icon class="size-4" />
            </UiButton>
          </DesktopOnlyTooltip>
        </div>

        <div class="relative grid gap-6 p-5 pt-20 @md/property:p-8 @md/property:pt-8 @md/property:pr-[26rem]">
          <div class="grid gap-4">
            <div class="flex items-center gap-3">
              <div class="bg-primary/10 text-primary-text flex size-9 items-center justify-center rounded-xl">
                <HomeIcon class="size-5" />
              </div>
              <div class="grid gap-0.5">
                <div class="text-muted-foreground text-xs tracking-wider uppercase">
                  {{ $t(PROPERTY_TYPE_TRANSLATION_KEYS[property.propertyType]) }}
                </div>
                <h1 class="text-2xl leading-tight font-semibold tracking-tight @md/property:text-3xl">
                  {{ property.account?.name || property.address }}
                </h1>
                <div class="text-muted-foreground text-sm">{{ locationLabel }}</div>
              </div>
            </div>

            <div class="grid gap-1">
              <span class="text-muted-foreground text-xs tracking-wider uppercase">
                {{ $t('pages.propertyDetails.currentValue') }}
              </span>
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="text-3xl font-semibold tracking-tight tabular-nums @md/property:text-5xl">
                  {{ formatAmountByCurrencyCode(property.account?.currentBalance ?? 0, currencyCode) }}
                </span>
                <span
                  class="inline-flex items-center gap-1 text-sm font-medium tabular-nums"
                  :class="gainDirection === 'down' ? 'text-app-expense-color' : 'text-app-income-color'"
                >
                  <component :is="gainDirection === 'down' ? ArrowDownRightIcon : ArrowUpRightIcon" class="size-4" />
                  {{ formatAmountByCurrencyCode(Math.abs(gainAmount), currencyCode) }}
                  <span class="text-muted-foreground font-normal">
                    ({{ gainDirection === 'down' ? '-' : '+' }}{{ Math.abs(gainPercent).toFixed(1) }}%)
                  </span>
                </span>
              </div>
              <span v-if="showRefValue" class="text-muted-foreground text-sm tabular-nums">
                ≈ {{ formatAmountByCurrencyCode(refCurrentBalance, baseCurrencyCode) }}
              </span>
              <span class="text-muted-foreground text-xs">
                {{ $t('pages.propertyDetails.sinceAcquired', { date: formatDisplayDate(property.purchaseDate) }) }}
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- KPI strip -->
      <section class="grid gap-4 @lg/property:grid-cols-3">
        <div class="bg-card rounded-2xl border p-5 shadow-xs">
          <div class="text-muted-foreground text-xs tracking-wider uppercase">
            {{ $t('pages.propertyDetails.purchasePrice') }}
          </div>
          <div class="mt-2 text-2xl font-semibold tabular-nums">
            {{ formatAmountByCurrencyCode(property.purchasePrice, currencyCode) }}
          </div>
          <div v-if="showRefValue" class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            ≈ {{ formatAmountByCurrencyCode(refPurchasePrice, baseCurrencyCode) }}
          </div>
          <div class="text-muted-foreground mt-1 text-xs">{{ formatDisplayDate(property.purchaseDate) }}</div>
        </div>

        <div class="bg-card rounded-2xl border p-5 shadow-xs">
          <div class="text-muted-foreground text-xs tracking-wider uppercase">
            {{ $t('pages.propertyDetails.totalGain') }}
          </div>
          <div class="mt-2 flex items-baseline gap-2 text-2xl font-semibold tabular-nums">
            <span :class="gainDirection === 'down' ? 'text-app-expense-color' : 'text-app-income-color'">
              {{ formatAmountByCurrencyCode(Math.abs(gainAmount), currencyCode) }}
            </span>
            <span class="text-muted-foreground text-sm font-normal">{{ Math.abs(gainPercent).toFixed(1) }}%</span>
          </div>
          <div v-if="showRefValue" class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            ≈ {{ formatAmountByCurrencyCode(Math.abs(refGainAmount), baseCurrencyCode) }}
          </div>
          <div class="text-muted-foreground mt-1 text-xs">
            {{ $t('pages.propertyDetails.ownedFor', { years: ownedYears.toFixed(1) }) }}
          </div>
        </div>

        <!-- Equity replaces the projection card when a mortgage is linked: with debt
             attached, what the owner actually holds is the more useful headline. -->
        <div v-if="equity !== null" class="bg-card rounded-2xl border p-5 shadow-xs">
          <div class="text-muted-foreground text-xs tracking-wider uppercase">
            {{ $t('pages.propertyDetails.equity') }}
          </div>
          <div class="mt-2 text-2xl font-semibold tabular-nums">
            {{ formatAmountByCurrencyCode(equity, currencyCode) }}
          </div>
          <div class="text-muted-foreground mt-1 text-xs">
            {{
              $t('pages.propertyDetails.equityExplain', {
                mortgage: formatAmountByCurrencyCode(Math.abs(mortgageBalance), currencyCode),
              })
            }}
          </div>
        </div>

        <div v-else class="bg-card rounded-2xl border p-5 shadow-xs">
          <div class="text-muted-foreground text-xs tracking-wider uppercase">
            {{ $t('pages.propertyDetails.projectedFiveYear') }}
          </div>
          <div class="mt-2 text-2xl font-semibold tabular-nums">
            {{ formatAmountByCurrencyCode(projectedFiveYearValue, currencyCode) }}
          </div>
          <div v-if="showRefValue" class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            ≈ {{ formatAmountByCurrencyCode(refProjectedFiveYearValue, baseCurrencyCode) }}
          </div>
          <div class="text-muted-foreground mt-1 text-xs">
            {{ $t('pages.propertyDetails.projectedExplain', { pct: property.annualAppreciationRatePct }) }}
          </div>
        </div>
      </section>

      <!-- Appreciation chart -->
      <section class="bg-card @container/chart-card rounded-2xl border p-5 shadow-xs @md/property:p-6">
        <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 class="text-base font-semibold tracking-tight">{{ $t('pages.propertyDetails.chart.title') }}</h3>
            <p class="text-muted-foreground mt-1 text-xs">{{ $t('pages.propertyDetails.chart.subtitle') }}</p>
          </div>
        </div>
        <AppreciationChart
          :timeline="showRefValue ? refAppreciationTimeline : appreciationTimeline"
          :purchase-date="purchaseDateAsDate"
          :purchase-price="showRefValue ? refPurchasePrice : property.purchasePrice"
          :revaluation="showRefValue ? refRevaluationAnchor : revaluationAnchor"
          :today-date="todayDate"
          :currency-code="showRefValue ? baseCurrencyCode : currencyCode"
        />
      </section>

      <!-- Details sections -->
      <section class="grid gap-4 @lg/property:grid-cols-2">
        <DetailsCard :title="$t('pages.propertyDetails.sections.property')" :icon="HomeIcon">
          <DetailRow :label="$t('pages.propertyDetails.propertyType')">
            {{ $t(PROPERTY_TYPE_TRANSLATION_KEYS[property.propertyType]) }}
          </DetailRow>
          <DetailRow :label="$t('pages.propertyDetails.address')">{{ property.address }}</DetailRow>
          <DetailRow v-if="property.city" :label="$t('pages.propertyDetails.city')">{{ property.city }}</DetailRow>
          <DetailRow v-if="property.country" :label="$t('pages.propertyDetails.country')">
            {{ property.country }}
          </DetailRow>
          <DetailRow v-if="property.yearBuilt !== null" :label="$t('pages.propertyDetails.yearBuilt')">
            {{ property.yearBuilt }}
          </DetailRow>
          <DetailRow v-if="property.notes" :label="$t('pages.propertyDetails.notes')">{{ property.notes }}</DetailRow>
        </DetailsCard>

        <DetailsCard :title="$t('pages.propertyDetails.sections.valuation')" :icon="TrendingUpIcon">
          <DetailRow :label="$t('pages.propertyDetails.annualRate')">
            <span class="tabular-nums">{{ property.annualAppreciationRatePct }}%</span>
          </DetailRow>
          <DetailRow v-if="property.valueAnchor !== null" :label="$t('pages.propertyDetails.lastRevaluation')">
            <span class="tabular-nums">{{ formatAmountByCurrencyCode(property.valueAnchor, currencyCode) }}</span>
            <span v-if="showRefValue && refValueAnchor !== null" class="text-muted-foreground ml-2 text-xs">
              ≈ {{ formatAmountByCurrencyCode(refValueAnchor, baseCurrencyCode) }}
            </span>
            <span class="text-muted-foreground ml-2 text-xs">
              {{ formatDisplayDate(property.valueAnchorDate ?? property.purchaseDate) }}
            </span>
          </DetailRow>
          <DetailRow v-if="property.loanAccount" :label="$t('pages.propertyDetails.mortgage')">
            <RouterLink
              :to="{ name: ROUTES_NAMES.account, params: { id: property.loanAccount.id } }"
              class="text-primary-text hover:underline"
            >
              {{ property.loanAccount.name }}
            </RouterLink>
            <span class="text-muted-foreground ml-2 text-xs tabular-nums">
              {{ formatAmountByCurrencyCode(Math.abs(mortgageBalance), currencyCode) }}
            </span>
          </DetailRow>
        </DetailsCard>
      </section>

      <RevaluationHistoryCard :account-id="property.account.id" :currency-code="currencyCode" />

      <RevaluationDialog
        v-model:open="isRevalueOpen"
        :property-id="property.id"
        :account-id="property.account.id"
        :current-value="property.account.currentBalance"
        :currency-code="currencyCode"
      />

      <EditPropertyDialog v-model:open="isEditOpen" :property="property" />

      <ResponsiveAlertDialog
        v-model:open="isDeleteOpen"
        :confirm-label="$t('pages.propertyDetails.deleteConfirm')"
        confirm-variant="destructive"
        @confirm="handleDelete"
      >
        <template #title>{{ $t('pages.propertyDetails.deleteTitle') }}</template>
        <template #description>{{ $t('pages.propertyDetails.deleteDescription') }}</template>
      </ResponsiveAlertDialog>
    </div>
  </PageWrapper>
</template>

<script setup lang="ts">
import { deleteProperty, getPropertyById } from '@/api/properties';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { PROPERTY_TYPE_TRANSLATION_KEYS } from '@/common/const/property-types-verbose';
import PageWrapper from '@/components/common/page-wrapper.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import EditPropertyDialog from '@/components/dialogs/edit-property-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { captureException } from '@/lib/sentry';
import DetailRow from '@/pages/accounts/components/asset-details/detail-row.vue';
import DetailsCard from '@/pages/accounts/components/asset-details/details-card.vue';
import AppreciationChart from '@/pages/accounts/components/property-details/appreciation-chart.vue';
import RevaluationDialog from '@/pages/accounts/components/property-details/revaluation-dialog.vue';
import RevaluationHistoryCard from '@/pages/accounts/components/property-details/revaluation-history-card.vue';
import { buildAppreciationTimeline } from '@/pages/accounts/utils/appreciation-math';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCurrenciesStore } from '@/stores';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ArrowDownRightIcon, ArrowUpRightIcon, HomeIcon, Trash2Icon, TrendingUpIcon } from '@lucide/vue';
import { addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

const PROJECTION_HORIZON_MONTHS = 144;
const FIVE_YEAR_PROJECTION_MONTHS = 60;
const DAYS_PER_YEAR = 365;

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const propertyId = computed(() => route.params.id as string);

const { data: property, isLoading } = useQuery({
  // Include `propertyId` (the ref) — not `.value` — so the query refetches when
  // the route param changes (sibling navigation between /properties/:id).
  queryKey: [...VUE_QUERY_CACHE_KEYS.propertyDetail, propertyId],
  queryFn: () => getPropertyById({ id: propertyId.value }),
});

// Empty string is a safe placeholder — the page body only renders inside a
// `v-else` gated on `property.account`, so this fallback never reaches the
// formatter at runtime, but keeps the type as `string` for the helpers.
const currencyCode = computed(() => property.value?.account?.currencyCode ?? '');

const { baseCurrency } = storeToRefs(useCurrenciesStore());
const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code ?? '');

/**
 * Today's account→base FX rate, derived from the account's own current/ref balance pair.
 * Returns `null` when the rate can't be derived reliably (account missing, or the value
 * has collapsed to zero) — callers gate ref-value display on that null rather than
 * silently rendering 1:1 across currencies. Historically-accurate ref values would
 * require per-date rates; today's rate is good enough for at-a-glance display.
 */
const fxRatio = computed<number | null>(() => {
  const account = property.value?.account;
  if (!account || account.currentBalance === 0) return null;
  return account.refCurrentBalance / account.currentBalance;
});

const showRefValue = computed(
  () => baseCurrencyCode.value !== '' && baseCurrencyCode.value !== currencyCode.value && fxRatio.value !== null,
);

const locationLabel = computed(() =>
  [property.value?.address, property.value?.city, property.value?.country].filter(Boolean).join(' · '),
);

const refCurrentBalance = computed(() => property.value?.account?.refCurrentBalance ?? 0);
const refPurchasePrice = computed(() => (property.value?.purchasePrice ?? 0) * (fxRatio.value ?? 1));
const refValueAnchor = computed(() =>
  property.value?.valueAnchor != null ? property.value.valueAnchor * (fxRatio.value ?? 1) : null,
);

const gainAmount = computed(() => {
  if (!property.value?.account) return 0;
  return property.value.account.currentBalance - property.value.purchasePrice;
});

const refGainAmount = computed(() => refCurrentBalance.value - refPurchasePrice.value);

const gainPercent = computed(() => {
  if (!property.value?.account || property.value.purchasePrice === 0) return 0;
  return (gainAmount.value / property.value.purchasePrice) * 100;
});

const gainDirection = computed<'up' | 'down'>(() => (gainAmount.value >= 0 ? 'up' : 'down'));

// Loan balances persist negative, so the absolute value is the amount outstanding.
const mortgageBalance = computed(() => property.value?.loanAccount?.currentBalance ?? 0);

/**
 * Owner's stake: today's value less what is still owed on the linked mortgage.
 * `null` when no mortgage is linked, which swaps the card for the projection.
 * Presentational only — net worth still counts the asset and the liability
 * independently, so this figure is never added to any total.
 */
const equity = computed<number | null>(() => {
  if (!property.value?.account || !property.value.loanAccount) return null;
  return property.value.account.currentBalance - Math.abs(mortgageBalance.value);
});

const todayDate = ref(new Date());

const purchaseDateAsDate = computed(() => (property.value ? parseISO(property.value.purchaseDate) : new Date()));

const revaluationAnchor = computed<{ value: number; date: Date } | null>(() => {
  if (!property.value || property.value.valueAnchor === null || property.value.valueAnchorDate === null) {
    return null;
  }
  return { value: property.value.valueAnchor, date: parseISO(property.value.valueAnchorDate) };
});

const appreciationTimeline = computed(() => {
  if (!property.value) return [];
  return buildAppreciationTimeline({
    purchase: { value: property.value.purchasePrice, date: purchaseDateAsDate.value },
    revaluation: revaluationAnchor.value,
    annualRatePct: property.value.annualAppreciationRatePct,
    monthsHorizon: PROJECTION_HORIZON_MONTHS,
  });
});

const ownedYears = computed(() => {
  if (!property.value) return 0;
  const days = differenceInCalendarDays(todayDate.value, parseISO(property.value.purchaseDate));
  return Math.max(0, days / DAYS_PER_YEAR);
});

const projectedFiveYearValue = computed(() => {
  const tl = appreciationTimeline.value;
  if (tl.length === 0) return 0;
  const targetMs = addMonths(todayDate.value, FIVE_YEAR_PROJECTION_MONTHS).getTime();
  const future = tl.find((p) => p.date.getTime() >= targetMs);
  return future ? future.value : tl[tl.length - 1]!.value;
});

const refProjectedFiveYearValue = computed(() => projectedFiveYearValue.value * (fxRatio.value ?? 1));

const refAppreciationTimeline = computed(() =>
  appreciationTimeline.value.map((p) => ({ ...p, value: p.value * (fxRatio.value ?? 1) })),
);
const refRevaluationAnchor = computed<{ value: number; date: Date } | null>(() =>
  revaluationAnchor.value
    ? { value: revaluationAnchor.value.value * (fxRatio.value ?? 1), date: revaluationAnchor.value.date }
    : null,
);

const formatDisplayDate = (iso: string) => format(parseISO(iso), 'MMM d, yyyy');

const isRevalueOpen = ref(false);
const isEditOpen = ref(false);
const isDeleteOpen = ref(false);

const deleteMutation = useMutation({ mutationFn: deleteProperty });

const handleDelete = async () => {
  if (!property.value) return;
  try {
    await deleteMutation.mutateAsync({ id: property.value.id });
    addNotification({
      text: t('pages.propertyDetails.deleteSuccess'),
      type: NotificationType.success,
    });
    queryClient.invalidateQueries({
      predicate: (q) => (q.queryKey as string[]).includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
    });
    router.push({ name: ROUTES_NAMES.accounts });
  } catch (error) {
    addNotification({
      text: t('pages.propertyDetails.deleteError'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'propertyDetailsDelete', propertyId: property.value.id } });
  }
};
</script>
