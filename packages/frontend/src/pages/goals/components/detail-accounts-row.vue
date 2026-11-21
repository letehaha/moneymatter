<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import ResponsiveHoverCard from '@/components/common/responsive-hover-card.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import type { GoalModel } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatGoalLinkLabel } from '../helpers';
import { type DetailAccountRow, formatAccountRowCaption, formatRowAmount } from './detail-helpers';

const MAX_VISIBLE_CHIPS = 3;

const props = defineProps<{
  goal: GoalModel;
  rows: DetailAccountRow[];
  progress: { saved: number; percent: number } | null;
}>();

const { t } = useI18n();
const { formatWholeOrCompactAmount } = useFormatCurrency();

const formatAmount = ({ amount }: { amount: number }) =>
  formatWholeOrCompactAmount({ amount, currencyCode: props.goal.currencyCode });

const linkLabel = ({ row }: { row: DetailAccountRow }) =>
  formatGoalLinkLabel({
    share: row,
    currencyCode: row.account?.currencyCode,
    formatAmount: formatWholeOrCompactAmount,
  });

const rowCaption = ({ row }: { row: DetailAccountRow }) =>
  formatAccountRowCaption({ row, t, formatAmount }) ?? { text: linkLabel({ row }), isShort: false };

const visibleRows = computed(() => props.rows.slice(0, MAX_VISIBLE_CHIPS));
const hiddenCount = computed(() => Math.max(0, props.rows.length - MAX_VISIBLE_CHIPS));
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5 px-3 py-2 @md/goal:px-4">
    <span class="text-muted-foreground mr-1 text-xs font-semibold tracking-wider uppercase">
      {{ $t('goals.details.accounts.label') }}
    </span>

    <span v-if="!rows.length" class="text-muted-foreground text-sm">{{ $t('goals.status.noAccounts') }}</span>

    <span
      v-for="row in visibleRows"
      :key="row.accountId"
      class="bg-muted inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2 pl-1 text-xs font-medium"
    >
      <AccountLogo v-if="row.account" :account="row.account" class="size-4 shrink-0 rounded-full" />
      <span v-else class="bg-foreground/10 size-4 shrink-0 rounded-full" />
      <span :class="cn('truncate', !row.account && 'text-muted-foreground')">
        {{ row.account?.name ?? $t('goals.details.accounts.unavailableAccount') }}
      </span>
      <span class="text-muted-foreground">{{ linkLabel({ row }) }}</span>
    </span>

    <ResponsiveHoverCard v-if="hiddenCount" side="bottom" align="start" content-class-name="w-80">
      <Button
        variant="secondary"
        size="sm"
        class="h-6 rounded-full px-2 text-xs"
        :aria-label="$t('goals.details.accounts.showAll', { count: rows.length })"
      >
        +{{ hiddenCount }}
      </Button>

      <template #content>
        <div class="flex items-baseline justify-between gap-2 px-1 pb-2 text-sm">
          <span class="font-semibold">{{ $t('goals.details.accounts.countedToward', { name: goal.name }) }}</span>
          <span class="text-muted-foreground text-xs">
            {{ $t('goals.details.accounts.count', { count: rows.length }, rows.length) }}
          </span>
        </div>
        <div
          v-for="row in rows"
          :key="row.accountId"
          class="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1.5 text-sm"
        >
          <AccountLogo v-if="row.account" :account="row.account" class="size-5 rounded-full" />
          <span v-else class="bg-muted size-5 rounded-full" />
          <div class="min-w-0">
            <div :class="cn('truncate', !row.account && 'text-muted-foreground')">
              {{ row.account?.name ?? $t('goals.details.accounts.unavailableAccount') }}
            </div>
            <div
              :class="
                cn('text-xs', rowCaption({ row }).isShort ? 'text-warning-text' : 'text-muted-foreground truncate')
              "
            >
              {{ rowCaption({ row }).text }}
            </div>
          </div>
          <span v-if="row.counted === null" class="text-muted-foreground text-xs whitespace-nowrap">
            {{ $t('goals.details.accounts.balanceUnavailable') }}
          </span>
          <span v-else class="font-semibold whitespace-nowrap tabular-nums">
            {{
              formatRowAmount({
                row,
                formatted: formatAmount({ amount: row.counted }),
                currencyCode: goal.currencyCode,
              })
            }}
          </span>
        </div>
        <div
          v-if="progress"
          class="mt-1 flex items-baseline justify-between gap-2 border-t px-1 pt-2 text-sm font-semibold tabular-nums"
        >
          <span>{{ $t('goals.details.accounts.totalCounted') }}</span>
          <span>
            {{ formatAmount({ amount: progress.saved }) }}
            <span class="text-muted-foreground ml-1 font-medium">{{ progress.percent }}%</span>
          </span>
        </div>
      </template>
    </ResponsiveHoverCard>

    <span class="text-muted-foreground ml-auto text-xs">{{ $t('goals.details.accounts.readOnlyHint') }}</span>
  </div>
</template>
