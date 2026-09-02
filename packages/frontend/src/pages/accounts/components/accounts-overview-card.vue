<template>
  <Card>
    <div
      class="flex flex-col gap-4 px-4 py-4 @[40rem]/accounts-page:flex-row @[40rem]/accounts-page:items-center @[40rem]/accounts-page:justify-between @[40rem]/accounts-page:gap-6 @[40rem]/accounts-page:px-6 @[40rem]/accounts-page:py-5"
    >
      <div>
        <div class="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">
          {{ $t('accounts.overview.totalBalance') }}
        </div>
        <div class="mt-1 text-2xl font-semibold tracking-tight tabular-nums @[40rem]/accounts-page:text-4xl">
          {{ totalDisplay }}
        </div>

        <i18n-t
          v-if="hasPendingPlans"
          keypath="accounts.overview.projected"
          :plural="planned.count"
          tag="div"
          class="text-muted-foreground mt-1 text-xs"
        >
          <template #amount>
            <span class="text-foreground font-semibold tabular-nums">{{ projectedDisplay }}</span>
          </template>
          <template #count>{{ planned.count }}</template>
          <template #date>{{ latestPlannedDisplay }}</template>
        </i18n-t>
      </div>

      <div class="flex gap-4 @[40rem]/accounts-page:gap-8">
        <div class="min-w-0 flex-1 @[40rem]/accounts-page:flex-none">
          <div class="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">
            {{ $t('accounts.overview.assets') }}
          </div>
          <div class="mt-1 truncate text-base font-semibold tabular-nums @[40rem]/accounts-page:text-lg">
            {{ formatBaseCurrency(overview.assets) }}
          </div>
        </div>

        <div class="min-w-0 flex-1 @[40rem]/accounts-page:flex-none">
          <div class="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">
            {{ $t('accounts.overview.liabilities') }}
          </div>
          <div
            class="text-destructive-text mt-1 truncate text-base font-semibold tabular-nums @[40rem]/accounts-page:text-lg"
          >
            {{ formatBaseCurrency(overview.liabilities) }}
          </div>
        </div>

        <div v-if="hasVehicles" class="min-w-0 flex-1 @[40rem]/accounts-page:flex-none">
          <div class="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">
            {{ $t('accounts.overview.vehicles') }}
          </div>
          <div
            class="text-muted-foreground mt-1 truncate text-base font-semibold tabular-nums @[40rem]/accounts-page:text-lg"
          >
            {{ formatBaseCurrency(overview.vehicles) }}
          </div>
        </div>

        <div v-if="hasProperties" class="min-w-0 flex-1 @[40rem]/accounts-page:flex-none">
          <div class="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase">
            {{ $t('accounts.overview.properties') }}
          </div>
          <div
            class="text-muted-foreground mt-1 truncate text-base font-semibold tabular-nums @[40rem]/accounts-page:text-lg"
          >
            {{ formatBaseCurrency(overview.properties) }}
          </div>
        </div>
      </div>
    </div>
  </Card>
</template>

<script setup lang="ts">
import { Card } from '@/components/lib/ui/card';
import { useFormatCurrency } from '@/composable';
import { type PlannedAggregate, usePlannedDateLabel } from '@/composable/use-projected-balance';
import type { AccountsOverview } from '@/pages/accounts/accounts-overview-totals';
import { computed } from 'vue';

const props = defineProps<{
  overview: AccountsOverview;
  baseCurrencyCode: string;
  hasVehicles: boolean;
  hasProperties: boolean;
  planned: PlannedAggregate;
  projectedTotal: number;
}>();

const { formatBaseCurrency } = useFormatCurrency();
const { formatPlannedDate } = usePlannedDateLabel();

const totalDisplay = computed(
  () => `${props.overview.isApprox ? '≈ ' : ''}${formatBaseCurrency(props.overview.total)}`,
);

const hasPendingPlans = computed(() => props.planned.count > 0);
const projectedDisplay = computed(
  () => `${props.overview.isApprox ? '≈ ' : ''}${formatBaseCurrency(props.projectedTotal)}`,
);
const latestPlannedDisplay = computed(() => formatPlannedDate({ time: props.planned.latestTime }));
</script>
