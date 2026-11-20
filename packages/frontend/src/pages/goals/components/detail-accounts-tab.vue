<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import { useFormatCurrency } from '@/composable';
import { useGoals } from '@/composable/data-queries/goals';
import { cn } from '@/lib/utils';
import { FULL_SHARE } from '@bt/shared/goals/goal-math';
import { ACCOUNT_STATUSES, type GoalModel } from '@bt/shared/types';
import { ArchiveIcon } from '@lucide/vue';
import { sumBy } from 'lodash-es';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatGoalLinkLabel, getAccountShareCapacity } from '../helpers';
import { type DetailAccountRow, formatAccountRowCaption, formatRowAmount } from './detail-helpers';
import DetailNoAccounts from './detail-no-accounts.vue';

const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 @2xl/goal:grid-cols-[minmax(0,2fr)_80px_112px_112px]';

const props = defineProps<{ goal: GoalModel; rows: DetailAccountRow[] }>();

const { t } = useI18n();
const { formatWholeOrCompactAmount } = useFormatCurrency();
const { data: allGoals } = useGoals();

const formatAmount = ({ amount }: { amount: number }) =>
  formatWholeOrCompactAmount({ amount, currencyCode: props.goal.currencyCode });
const formatConverted = ({ row, amount }: { row: DetailAccountRow; amount: number }) =>
  formatRowAmount({ row, formatted: formatAmount({ amount }), currencyCode: props.goal.currencyCode });

const linkLabel = ({ row }: { row: DetailAccountRow }) =>
  formatGoalLinkLabel({
    share: row,
    currencyCode: row.account?.currencyCode,
    formatAmount: formatWholeOrCompactAmount,
  });

const amountCaption = ({ row }: { row: DetailAccountRow }) => formatAccountRowCaption({ row, t, formatAmount });

const shareCaption = ({ row }: { row: DetailAccountRow }) => {
  if (row.fixedAmount !== null) return t('goals.details.accounts.fixedHere', { amount: linkLabel({ row }) });
  if (row.sharePercent === FULL_SHARE) return t('goals.details.accounts.wholeAccount');
  if (!allGoals.value) return t('goals.details.accounts.shareHere', { share: row.sharePercent });
  const { free } = getAccountShareCapacity({ goals: allGoals.value, accountId: row.accountId });
  return t('goals.details.accounts.shareHereFree', { share: row.sharePercent, free });
};

const totals = computed(() => {
  const withAmounts = props.rows.filter((row) => row.counted !== null);
  if (!withAmounts.length) return null;
  return {
    count: withAmounts.length,
    balance: sumBy(withAmounts, (row) => row.balance ?? 0),
    counted: sumBy(withAmounts, (row) => row.counted ?? 0),
  };
});
</script>

<template>
  <DetailNoAccounts v-if="!rows.length" />

  <div v-else class="divide-border divide-y tabular-nums">
    <div
      :class="
        cn(GRID, 'text-muted-foreground hidden px-4 py-2 text-xs font-semibold tracking-wider uppercase @2xl/goal:grid')
      "
      aria-hidden="true"
    >
      <span>{{ $t('goals.details.accounts.columns.account') }}</span>
      <span class="text-right">{{ $t('goals.details.accounts.columns.share') }}</span>
      <span class="text-right">{{ $t('goals.details.accounts.columns.balance') }}</span>
      <span class="text-right">{{ $t('goals.details.accounts.columns.counted') }}</span>
    </div>

    <div v-for="row in rows" :key="row.accountId" :class="cn(GRID, 'px-3 py-3 @md/goal:px-4')">
      <div class="flex min-w-0 items-center gap-3">
        <AccountLogo v-if="row.account" :account="row.account" class="size-8 shrink-0 rounded-lg" />
        <span v-else class="bg-muted size-8 shrink-0 rounded-lg" />
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-1.5">
            <span :class="cn('truncate font-medium', !row.account && 'text-muted-foreground')">
              {{ row.account?.name ?? $t('goals.details.accounts.unavailableAccount') }}
            </span>
            <span
              v-if="row.account?.status === ACCOUNT_STATUSES.archived"
              class="bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
            >
              <ArchiveIcon class="size-3" />
              {{ $t('goals.details.accounts.archived') }}
            </span>
          </div>
          <div class="text-muted-foreground truncate text-xs">
            <template v-if="row.percentOfSaved !== null">
              {{ $t('goals.details.accounts.percentOfSaved', { percent: Math.round(row.percentOfSaved) }) }} ·
            </template>
            {{ shareCaption({ row }) }}
          </div>
        </div>
      </div>

      <span class="hidden text-right text-sm @2xl/goal:block">{{ linkLabel({ row }) }}</span>
      <span class="hidden text-right text-sm @2xl/goal:block">
        {{ row.balance === null ? '—' : formatConverted({ row, amount: row.balance }) }}
      </span>

      <div v-if="row.counted === null" class="text-muted-foreground text-right text-xs whitespace-nowrap">
        {{ $t('goals.details.accounts.balanceUnavailable') }}
      </div>
      <div v-else class="text-right whitespace-nowrap">
        <div class="text-sm font-semibold">{{ formatConverted({ row, amount: row.counted }) }}</div>
        <div
          v-if="amountCaption({ row }) && !amountCaption({ row })!.isShort"
          class="text-muted-foreground text-xs @2xl/goal:hidden"
        >
          {{ amountCaption({ row })!.text }}
        </div>
      </div>

      <div v-if="amountCaption({ row })?.isShort" class="text-warning-text col-span-full mt-1 pl-11 text-xs">
        {{ amountCaption({ row })!.text }}
      </div>
    </div>

    <div v-if="totals" :class="cn(GRID, 'bg-muted/50 px-3 py-3 font-bold @md/goal:px-4')">
      <span class="text-sm">
        {{ $t('goals.details.accounts.total', { count: totals.count }, totals.count) }}
      </span>
      <span class="hidden @2xl/goal:block" />
      <span class="hidden text-right text-sm @2xl/goal:block">{{ formatAmount({ amount: totals.balance }) }}</span>
      <div class="text-right whitespace-nowrap">
        <div class="text-sm">{{ formatAmount({ amount: totals.counted }) }}</div>
        <div class="text-muted-foreground text-xs font-medium @2xl/goal:hidden">
          {{ $t('goals.details.accounts.ofBalance', { amount: formatAmount({ amount: totals.balance }) }) }}
        </div>
      </div>
    </div>
  </div>
</template>
