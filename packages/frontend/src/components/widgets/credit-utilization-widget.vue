<script lang="ts" setup>
import { computeCreditUsed } from '@/common/utils/account-balance';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useFormatCurrency } from '@/composable/formatters';
import { useAnimatedNumber } from '@/composable/use-animated-number';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { ACCOUNT_STATUSES, ACCOUNT_TYPES } from '@bt/shared/types';
import { CircleCheckIcon, InfoIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import CreditUtilizationSkeleton from './components/credit-utilization-skeleton.vue';
import WidgetWrapper from './components/widget-wrapper.vue';

defineOptions({ name: 'credit-utilization-widget' });

const THRESHOLDS = {
  medium: 40,
  high: 70,
};

const { accounts, isAccountsFetched } = storeToRefs(useAccountsStore());
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code ?? '');
const { formatBaseCurrency, formatAmountByCurrencyCode, formatCompactAmount } = useFormatCurrency();
const { data: userSettings } = useUserSettings();

const creditAccounts = computed(() => {
  if (!accounts.value) return [];

  return accounts.value
    .filter((a) => a.status === ACCOUNT_STATUSES.active && !a.excludeFromStats && a.creditLimit > 0)
    .map((a) => {
      // Provider-synced (non-system) cards report a balance that already nets off the
      // credit limit, so their drawn amount is the limit minus the balance at any sign.
      const balanceIncludesCreditLimit = a.type !== ACCOUNT_TYPES.system;
      // Only breaks the tie at balance 0: with the setting on, a zero balance
      // means the whole limit is drawn instead of an untouched card.
      const zeroBalanceMeansFullyDrawn = !!userSettings.value?.includeCreditLimitInStats;
      const used = computeCreditUsed({
        balance: a.currentBalance,
        creditLimit: a.creditLimit,
        balanceIncludesCreditLimit,
        zeroBalanceMeansFullyDrawn,
      });
      const limit = a.creditLimit;
      const utilization = limit > 0 ? Math.round((used / limit) * 100) : 0;

      return {
        id: a.id,
        name: a.name,
        currencyCode: a.currencyCode,
        used,
        limit,
        utilization: Math.min(utilization, 100),
        refUsed: computeCreditUsed({
          balance: a.refCurrentBalance,
          creditLimit: a.refCreditLimit,
          balanceIncludesCreditLimit,
          zeroBalanceMeansFullyDrawn,
        }),
        refLimit: a.refCreditLimit,
      };
    })
    .sort((a, b) => b.utilization - a.utilization);
});

const totalRefUsed = computed(() => creditAccounts.value.reduce((sum, a) => sum + a.refUsed, 0));
const totalRefLimit = computed(() => creditAccounts.value.reduce((sum, a) => sum + a.refLimit, 0));
const totalUtilization = computed(() => {
  if (totalRefLimit.value <= 0) return 0;
  return Math.min(Math.round((totalRefUsed.value / totalRefLimit.value) * 100), 100);
});

const { displayValue: animatedUtilization } = useAnimatedNumber({ value: totalUtilization });

const isLoading = computed(() => !isAccountsFetched.value);
const isEmpty = computed(() => isAccountsFetched.value && creditAccounts.value.length === 0);

const getUtilizationColors = ({ utilization }: { utilization: number }) => {
  if (utilization >= THRESHOLDS.high) return { text: 'text-app-expense-color', bg: 'bg-app-expense-color' };
  if (utilization >= THRESHOLDS.medium) return { text: 'text-warning-text', bg: 'bg-warning' };
  return { text: 'text-app-income-color', bg: 'bg-app-income-color' };
};
</script>

<template>
  <WidgetWrapper class="max-md:max-h-96" :is-fetching="isLoading">
    <template #title>
      <span class="inline-flex items-center gap-1">
        {{ $t('dashboard.widgets.creditUtilization.title') }}

        <ResponsiveTooltip
          :content="$t('dashboard.widgets.creditUtilization.description')"
          content-class-name="max-w-56"
          :delay-duration="100"
        >
          <InfoIcon class="text-muted-foreground ml-1 size-4 cursor-help" />
        </ResponsiveTooltip>
      </span>
    </template>

    <template v-if="isLoading">
      <CreditUtilizationSkeleton />
    </template>

    <template v-else>
      <div class="flex h-full flex-col gap-3">
        <!-- Summary header -->
        <div class="flex items-baseline justify-between gap-2">
          <div>
            <span
              class="text-2xl font-bold tracking-tight"
              :class="getUtilizationColors({ utilization: totalUtilization }).text"
            >
              {{ Math.round(animatedUtilization) }}%
            </span>
            <span class="text-muted-foreground ml-1.5 text-xs">
              {{ $t('dashboard.widgets.creditUtilization.utilized') }}
            </span>
          </div>
          <template v-if="!isEmpty">
            <DesktopOnlyTooltip :content="`${formatBaseCurrency(totalRefUsed)} / ${formatBaseCurrency(totalRefLimit)}`">
              <div class="text-muted-foreground text-right text-xs">
                {{ formatCompactAmount(totalRefUsed, baseCurrencyCode) }}
                / {{ formatCompactAmount(totalRefLimit, baseCurrencyCode) }}
              </div>
            </DesktopOnlyTooltip>
          </template>
        </div>

        <!-- Total utilization bar -->
        <div class="bg-muted h-2 w-full overflow-hidden rounded-full">
          <div
            class="h-full rounded-full transition-all duration-500 ease-out"
            :class="getUtilizationColors({ utilization: totalUtilization }).bg"
            :style="{ width: `${totalUtilization}%` }"
          />
        </div>

        <!-- Per-account list or empty message -->
        <template v-if="isEmpty">
          <div class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm">
            <CircleCheckIcon class="text-success-text size-12" />
            {{ $t('dashboard.widgets.creditUtilization.noAccounts') }}
          </div>
        </template>
        <ScrollArea v-else class="min-h-0 flex-1" viewport-class="md:overscroll-contain-if-scrollable">
          <div class="-mx-2 flex flex-col">
            <router-link
              v-for="account in creditAccounts"
              :key="account.id"
              :to="{ name: ROUTES_NAMES.account, params: { id: account.id } }"
              class="hover:bg-muted/50 flex flex-col gap-1.5 rounded-md px-3 py-2 transition-colors"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium">{{ account.name }}</span>
                <div class="flex shrink-0 items-center gap-2">
                  <DesktopOnlyTooltip
                    :content="`${formatAmountByCurrencyCode(account.used, account.currencyCode)} / ${formatAmountByCurrencyCode(account.limit, account.currencyCode)}`"
                  >
                    <span class="text-muted-foreground text-[10px]">
                      {{ formatCompactAmount(account.used, account.currencyCode) }}
                      / {{ formatCompactAmount(account.limit, account.currencyCode) }}
                    </span>
                  </DesktopOnlyTooltip>
                  <span
                    class="text-amount text-xs"
                    :class="getUtilizationColors({ utilization: account.utilization }).text"
                  >
                    {{ account.utilization }}%
                  </span>
                </div>
              </div>
              <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="getUtilizationColors({ utilization: account.utilization }).bg"
                  :style="{ width: `${account.utilization}%` }"
                />
              </div>
            </router-link>
          </div>
        </ScrollArea>
      </div>
    </template>
  </WidgetWrapper>
</template>
