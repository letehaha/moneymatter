<script setup lang="ts">
import { type SubscriptionDetail, unlinkTransactionsFromSubscription } from '@/api/subscriptions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { ChartTooltipHeader } from '@/components/common/charts/chart-tooltip';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { useFormatCurrency } from '@/composable/formatters';
import { SUBSCRIPTION_MATCH_SOURCE, TRANSACTION_TYPES } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { LinkIcon, SearchIcon, SettingsIcon, UnlinkIcon } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import {
  type LinkedPaymentsChartGap,
  type LinkedPaymentsCurrencyTotal,
  buildLinkedPaymentsSummary,
} from '../linked-payments-summary';

type LinkedTransaction = NonNullable<SubscriptionDetail['transactions']>[number];

const props = defineProps<{ subscription: SubscriptionDetail }>();

const route = useRoute();
const rootRef = ref<HTMLElement>();
const listRef = ref<HTMLElement>();
onMounted(() => {
  if (route.hash === '#linked-transactions') (listRef.value ?? rootRef.value)?.scrollIntoView({ behavior: 'smooth' });
});

const emit = defineEmits<{
  'suggest-matches': [];
  'open-automation': [];
}>();

const { t } = useI18n();
const queryClient = useQueryClient();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const summary = computed(() =>
  buildLinkedPaymentsSummary({
    transactions: props.subscription.transactions ?? [],
    frequency: props.subscription.frequency,
    intervalUnit: props.subscription.intervalUnit,
    intervalCount: props.subscription.intervalCount,
  }),
);

const hasMatchingRules = computed(() => (props.subscription.matchingRules?.rules?.length ?? 0) > 0);

const { mutate: unlinkTransaction, isPending: isUnlinking } = useMutation({
  mutationFn: unlinkTransactionsFromSubscription,
  onSuccess: () => {
    invalidateSubscriptionQueries();
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    addSuccessNotification(t('planned.subscriptions.unlinkSuccess'));
  },
  onError: () => addErrorNotification(t('planned.subscriptions.unlinkError')),
});

const pendingUnlinkTx = ref<LinkedTransaction | null>(null);
const isUnlinkConfirmOpen = ref(false);

const requestUnlink = ({ tx }: { tx: LinkedTransaction }) => {
  pendingUnlinkTx.value = tx;
  isUnlinkConfirmOpen.value = true;
};

const confirmUnlink = () => {
  if (pendingUnlinkTx.value) {
    unlinkTransaction({ id: props.subscription.id, transactionIds: [pendingUnlinkTx.value.id] });
  }
  isUnlinkConfirmOpen.value = false;
};

const pendingUnlinkLabel = computed(() => {
  const tx = pendingUnlinkTx.value;
  if (!tx) return '';
  return `${format(new Date(tx.time), 'd MMM yyyy')} · ${formatRowAmount({ tx })}`;
});

const formatNativeLines = ({ totals }: { totals: LinkedPaymentsCurrencyTotal[] }): string[] =>
  totals.map(({ currencyCode, total }) => formatAmountByCurrencyCode(total, currencyCode));

// Currencies are never joined with an arithmetic separator: "A + B" claims an
// addition the app can't perform. The middle dot lists them without that claim.
const formatNativeList = ({ totals }: { totals: LinkedPaymentsCurrencyTotal[] }): string =>
  formatNativeLines({ totals }).join(' · ');

/** A payment recorded without an exchange rate has refAmount 0; a ref total would then understate. */
const missingRefRates = computed(() => {
  const { refTotal, totalsByCurrency } = summary.value.stats;
  return refTotal === 0 && totalsByCurrency.some(({ total }) => total !== 0);
});

/** The "≈" disclosure: shown whenever the headline number is a conversion, not a booked amount. */
const showApprox = computed(() => summary.value.stats.isConverted && !missingRefRates.value);

const primaryTotal = computed(() => {
  const { refTotal, refCurrencyCode, totalsByCurrency } = summary.value.stats;
  if (missingRefRates.value) return formatNativeList({ totals: totalsByCurrency });
  return refCurrencyCode ? formatAmountByCurrencyCode(refTotal, refCurrencyCode) : '–';
});

/** Mixed native currencies: the breakdown only works as a per-line tooltip list. */
const totalBreakdownLines = computed(() => {
  const { totalsByCurrency } = summary.value.stats;
  if (!showApprox.value || totalsByCurrency.length < 2) return [];
  return formatNativeLines({ totals: totalsByCurrency });
});

/** Single foreign currency: the native sum is a real billed amount and earns an inline line. */
const nativeTotalLine = computed(() => {
  const { totalsByCurrency } = summary.value.stats;
  if (!showApprox.value || totalsByCurrency.length !== 1) return null;
  return formatNativeList({ totals: totalsByCurrency });
});

const formattedAverage = computed(() => {
  const { refAverage, refCurrencyCode, nativeAverage } = summary.value.stats;
  if (missingRefRates.value) {
    return nativeAverage ? formatAmountByCurrencyCode(nativeAverage.amount, nativeAverage.currencyCode) : '–';
  }
  if (refAverage === null || !refCurrencyCode) return '–';
  return formatAmountByCurrencyCode(refAverage, refCurrencyCode);
});

/** The provider's sticker price, shown when the whole history is billed in one foreign currency. */
const nativeAverageLine = computed(() => {
  const { nativeAverage, refCurrencyCode } = summary.value.stats;
  if (!showApprox.value || !nativeAverage || nativeAverage.currencyCode === refCurrencyCode) return null;
  return formatAmountByCurrencyCode(nativeAverage.amount, nativeAverage.currencyCode);
});

interface YearTotalDisplay {
  text: string;
  converted: boolean;
  breakdownLines: string[];
}

const yearGroupRows = computed(() =>
  summary.value.yearGroups.map((group) => {
    const { refCurrencyCode } = summary.value.stats;
    const ratesMissing = group.refTotal === 0 && group.totalsByCurrency.some(({ total }) => total !== 0);
    const total: YearTotalDisplay =
      ratesMissing || !refCurrencyCode
        ? { text: formatNativeList({ totals: group.totalsByCurrency }), converted: false, breakdownLines: [] }
        : {
            text: formatAmountByCurrencyCode(group.refTotal, refCurrencyCode),
            converted: group.isConverted,
            breakdownLines: group.isConverted ? formatNativeLines({ totals: group.totalsByCurrency }) : [],
          };
    return { group, total };
  }),
);

const formattedLastPayment = computed(() => {
  const { lastPaymentTime } = summary.value.stats;
  return lastPaymentTime ? format(lastPaymentTime, 'd MMM yyyy') : '–';
});

const driftKeypath = computed(() =>
  summary.value.drift?.direction === 'down'
    ? 'planned.subscriptions.linked.driftDown'
    : 'planned.subscriptions.linked.driftUp',
);

/** Grows the gap block to the width its skipped slots would occupy as bars, capped like the bars. */
const gapBlockStyle = ({ gap }: { gap: LinkedPaymentsChartGap }) => ({
  flex: `${gap.slotCount} 1 0%`,
  maxWidth: `calc(${gap.slotCount} * var(--chart-slot-max) + ${gap.slotCount - 1} * var(--chart-slot-gap))`,
});

/** Expenses read with a leading minus, matching how transaction rows render amounts. */
const formatRowAmount = ({ tx }: { tx: LinkedTransaction }): string =>
  formatAmountByCurrencyCode(
    tx.transactionType === TRANSACTION_TYPES.expense ? -tx.amount : tx.amount,
    tx.currencyCode,
  );

const MATCH_SOURCE_DOT_CLASSES: Record<string, string> = {
  [SUBSCRIPTION_MATCH_SOURCE.rule]: 'bg-success-text',
  [SUBSCRIPTION_MATCH_SOURCE.ai]: 'bg-primary',
  [SUBSCRIPTION_MATCH_SOURCE.manual]: 'border-muted-foreground border-[1.5px]',
};

const getMatchSourceDotClass = ({ source }: { source: string }): string =>
  MATCH_SOURCE_DOT_CLASSES[source] ?? MATCH_SOURCE_DOT_CLASSES[SUBSCRIPTION_MATCH_SOURCE.manual]!;
</script>

<template>
  <div id="linked-transactions" ref="rootRef" class="@container/linked scroll-mt-14">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-lg font-semibold">
        {{ $t('planned.subscriptions.linkedTransactionsTitle') }}
        <span v-if="summary.payments.length" class="text-muted-foreground ml-1 text-sm font-normal">
          {{ summary.payments.length }}
        </span>
      </h2>
      <DesktopOnlyTooltip :content="$t('planned.subscriptions.suggestMatches')">
        <Button
          variant="outline"
          size="sm"
          :aria-label="$t('planned.subscriptions.suggestMatches')"
          @click="emit('suggest-matches')"
        >
          <SearchIcon class="size-4" />
          <span class="hidden @lg/linked:inline">{{ $t('planned.subscriptions.suggestMatches') }}</span>
        </Button>
      </DesktopOnlyTooltip>
    </div>

    <template v-if="summary.payments.length">
      <div
        class="bg-card border-border mb-3 flex flex-col rounded-lg border @lg/linked:gap-3 @lg/linked:border-0 @lg/linked:bg-transparent"
      >
        <div
          class="@lg/linked:border-border @lg/linked:bg-card flex flex-col p-3 @lg/linked:flex-row @lg/linked:overflow-hidden @lg/linked:rounded-lg @lg/linked:border @lg/linked:p-0"
        >
          <div class="@lg/linked:border-border @lg/linked:flex-1 @lg/linked:border-r @lg/linked:px-4 @lg/linked:py-2.5">
            <p class="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
              {{ $t('planned.subscriptions.linked.totalPaid') }}
            </p>
            <p class="text-amount text-xl @lg/linked:text-base">
              <ResponsiveTooltip v-if="totalBreakdownLines.length" :delay-duration="100">
                <span
                  class="decoration-muted-foreground/50 cursor-default underline decoration-dotted underline-offset-4"
                >
                  <span class="text-muted-foreground">≈</span> {{ primaryTotal }}
                </span>
                <template #content>
                  <p class="text-muted-foreground mb-1 text-xs">
                    {{ $t('planned.subscriptions.linked.convertedTooltip') }}
                  </p>
                  <p v-for="line in totalBreakdownLines" :key="line" class="tabular-nums">{{ line }}</p>
                </template>
              </ResponsiveTooltip>
              <template v-else>
                <span v-if="showApprox" class="text-muted-foreground">≈</span> {{ primaryTotal }}
              </template>
            </p>
            <p v-if="nativeTotalLine" class="text-muted-foreground mt-0.5 text-xs font-medium">
              {{ nativeTotalLine }}
            </p>
          </div>

          <div class="border-border/60 mt-2.5 flex gap-6 border-t pt-2.5 @lg/linked:contents">
            <div
              class="@lg/linked:border-border @lg/linked:flex-1 @lg/linked:border-r @lg/linked:px-4 @lg/linked:py-2.5"
            >
              <p class="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                {{ $t('planned.subscriptions.linked.average') }}
              </p>
              <p class="text-amount text-sm @lg/linked:text-base">
                <span v-if="showApprox" class="text-muted-foreground">≈</span> {{ formattedAverage }}
              </p>
              <p v-if="nativeAverageLine" class="text-muted-foreground mt-0.5 text-xs font-medium">
                {{ nativeAverageLine }}
              </p>
            </div>
            <div class="@lg/linked:flex-1 @lg/linked:px-4 @lg/linked:py-2.5">
              <p class="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                {{ $t('planned.subscriptions.linked.lastPayment') }}
              </p>
              <p class="text-amount text-sm @lg/linked:text-base">{{ formattedLastPayment }}</p>
            </div>
          </div>
        </div>

        <div
          v-if="summary.chart || summary.drift"
          class="border-border/60 @lg/linked:border-border @lg/linked:bg-card border-t px-3 pt-3 pb-2.5 @lg/linked:rounded-lg @lg/linked:border @lg/linked:p-3.5"
        >
          <div
            v-if="summary.chart"
            class="flex h-11 items-end gap-(--chart-slot-gap) [--chart-slot-gap:0.25rem] [--chart-slot-max:2.25rem] @lg/linked:h-14 @lg/linked:[--chart-slot-gap:0.375rem]"
            role="img"
            :aria-label="$t('planned.subscriptions.linked.chartLabel')"
          >
            <template v-for="chartSlot in summary.chart" :key="chartSlot.id">
              <ResponsiveTooltip
                v-if="chartSlot.kind === 'payment'"
                variant="chart"
                content-class-name="min-w-0"
                :delay-duration="100"
              >
                <div
                  class="max-w-(--chart-slot-max) min-w-2 flex-1 rounded-t-sm"
                  :class="chartSlot.isLatest ? 'bg-app-expense-color' : 'bg-app-expense-color/30'"
                  :style="{ height: `${chartSlot.heightPct}%` }"
                />
                <template #content>
                  <ChartTooltipHeader>{{ chartSlot.monthLabel }}</ChartTooltipHeader>
                  <div class="font-semibold whitespace-nowrap tabular-nums">
                    {{ formatAmountByCurrencyCode(chartSlot.amount, chartSlot.currencyCode) }}
                  </div>
                  <div
                    v-if="chartSlot.currencyCode !== chartSlot.refCurrencyCode"
                    class="text-card-tooltip-muted mt-0.5 whitespace-nowrap tabular-nums"
                  >
                    ≈ {{ formatAmountByCurrencyCode(chartSlot.refAmount, chartSlot.refCurrencyCode) }}
                  </div>
                </template>
              </ResponsiveTooltip>

              <ResponsiveTooltip v-else variant="chart" content-class-name="min-w-0" :delay-duration="100">
                <div class="flex h-full items-end gap-(--chart-slot-gap)" :style="gapBlockStyle({ gap: chartSlot })">
                  <div
                    v-for="index in chartSlot.slotCount"
                    :key="index"
                    class="border-border max-w-(--chart-slot-max) min-w-2 flex-1 rounded-t-sm border border-dashed bg-transparent"
                    style="height: 25%"
                  />
                </div>
                <template #content>
                  <span class="tabular-nums">
                    {{ $t('planned.subscriptions.linked.gapTooltip', { range: chartSlot.rangeLabel }) }}
                  </span>
                </template>
              </ResponsiveTooltip>
            </template>
          </div>

          <i18n-t
            v-if="summary.drift"
            :keypath="driftKeypath"
            tag="p"
            class="text-muted-foreground mt-2.5 text-xs first:mt-0"
          >
            <template #percent>
              <span
                class="font-semibold"
                :class="summary.drift.direction === 'up' ? 'text-app-expense-color' : 'text-success-text'"
              >
                {{ summary.drift.percent }}
              </span>
            </template>
            <template #date>{{ format(summary.drift.firstPaymentTime, 'MMM yyyy') }}</template>
          </i18n-t>
        </div>
      </div>

      <div ref="listRef" class="border-border bg-card scroll-mt-14 overflow-hidden rounded-lg border">
        <div v-for="{ group, total } in yearGroupRows" :key="group.year" class="border-border border-b last:border-b-0">
          <div class="bg-background/50 flex items-center justify-between gap-3 px-2.5 py-1.5 @lg/linked:px-3.5">
            <span class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">
              {{ group.year }} ·
              {{ $t('planned.subscriptions.linked.yearPayments', { count: group.payments.length }) }}
            </span>
            <ResponsiveTooltip v-if="total.converted" :delay-duration="100">
              <span class="text-muted-foreground shrink-0 cursor-default font-mono text-[11px] tabular-nums">
                ≈ {{ total.text }}
              </span>
              <template #content>
                <p class="text-muted-foreground mb-1 text-xs">
                  {{ $t('planned.subscriptions.linked.convertedTooltip') }}
                </p>
                <p v-for="line in total.breakdownLines" :key="line" class="tabular-nums">{{ line }}</p>
              </template>
            </ResponsiveTooltip>
            <span v-else class="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
              {{ total.text }}
            </span>
          </div>

          <div
            v-for="tx in group.payments"
            :key="tx.id"
            class="group/row border-border/50 hover:bg-muted/30 flex items-center gap-2.5 border-t px-2.5 py-2 @lg/linked:gap-3 @lg/linked:px-3.5"
          >
            <span class="text-muted-foreground w-12 shrink-0 font-mono text-[11px] tabular-nums @lg/linked:text-xs">
              {{ format(new Date(tx.time), 'd MMM') }}
            </span>
            <span
              class="size-2 shrink-0 rounded-full"
              :class="getMatchSourceDotClass({ source: tx.SubscriptionTransactions.matchSource })"
            />
            <span class="flex-1 truncate text-[13px] @lg/linked:text-sm">{{ tx.note }}</span>
            <span
              class="text-amount shrink-0 text-xs @lg/linked:text-sm"
              :class="
                tx.transactionType === TRANSACTION_TYPES.expense ? 'text-app-expense-color' : 'text-app-income-color'
              "
            >
              {{ formatRowAmount({ tx }) }}
            </span>
            <DesktopOnlyTooltip :content="$t('planned.subscriptions.unlinkTransaction')">
              <Button
                variant="ghost"
                size="icon-sm"
                class="shrink-0 opacity-45 transition-opacity group-hover/row:opacity-100 [@media(hover:hover)]:opacity-0"
                :disabled="isUnlinking"
                :aria-label="$t('planned.subscriptions.unlinkTransaction')"
                @click="requestUnlink({ tx })"
              >
                <UnlinkIcon class="size-3.5" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
        </div>
      </div>

      <ResponsiveAlertDialog
        v-model:open="isUnlinkConfirmOpen"
        :confirm-label="$t('planned.subscriptions.unlinkConfirmAction')"
        confirm-variant="destructive"
        @confirm="confirmUnlink"
      >
        <template #title>{{ $t('planned.subscriptions.unlinkConfirmTitle') }}</template>
        <template #description>
          {{ $t('planned.subscriptions.unlinkConfirmDescription', { payment: pendingUnlinkLabel }) }}
        </template>
      </ResponsiveAlertDialog>

      <div class="text-muted-foreground mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-[11px]">
        <span class="inline-flex items-center gap-1.5">
          <span class="bg-success-text size-2 rounded-full" />
          {{ $t('planned.subscriptions.linked.legendRule') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="bg-primary size-2 rounded-full" />
          {{ $t('planned.subscriptions.linked.legendAi') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="border-muted-foreground size-2 rounded-full border-[1.5px]" />
          {{ $t('planned.subscriptions.linked.legendManual') }}
        </span>
      </div>
    </template>

    <div v-else class="border-border rounded-lg border p-8 text-center">
      <LinkIcon class="text-muted-foreground mx-auto mb-2 size-8 opacity-50" />
      <p class="text-muted-foreground text-sm">{{ $t('planned.subscriptions.noLinkedTransactions') }}</p>
      <Button
        v-if="!hasMatchingRules"
        type="button"
        variant="outline"
        size="sm"
        class="mt-3"
        @click="emit('open-automation')"
      >
        <SettingsIcon class="size-4" />
        {{ $t('planned.subscriptions.addMatchingRules') }}
      </Button>
    </div>
  </div>
</template>
