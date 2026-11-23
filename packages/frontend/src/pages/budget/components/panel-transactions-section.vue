<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import TransactionRecordSkeleton from '@/components/transactions-list/transaction-record-skeleton.vue';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { useCategoriesStore } from '@/stores';
import type { BudgetPlanLineTransactions, BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { ArrowRightIcon } from '@lucide/vue';
import { format, parseISO, subDays } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

import { type PanelContext, amountToneClass } from '../helpers';
import { expandCategoryIds } from '../line-categories';

const SKELETON_ROWS = 3;

const props = defineProps<{
  context: PanelContext;
  line: BudgetPlanPeriodViewLine;
  accountIds: string[];
  data?: BudgetPlanLineTransactions;
  isLoading: boolean;
}>();

const { formatBaseCurrency } = useFormatCurrency();
const { formattedCategories } = storeToRefs(useCategoriesStore());

const remaining = computed(() => (props.data ? props.data.total - props.data.transactions.length : 0));

// The records filters only approximate the fold: they miss its transfer and refund rules.
const seeAllLink = computed(() => ({
  name: ROUTES_NAMES.transactions,
  query: {
    categoryIds: expandCategoryIds({ categoryIds: props.line.categoryIds, categories: formattedCategories.value }),
    accountIds: props.accountIds,
    start: props.context.period.startDate,
    // `endDate` is exclusive; the records filter reads `end` as an inclusive day.
    end: format(subDays(parseISO(props.context.period.endDate), 1), 'yyyy-MM-dd'),
  },
}));
</script>

<template>
  <div v-if="isLoading" class="grid gap-2" aria-hidden="true">
    <TransactionRecordSkeleton v-for="index in SKELETON_ROWS" :key="index" compact />
  </div>

  <p v-else-if="!data?.total" class="text-muted-foreground text-sm">
    {{ $t('budgetPlans.panel.lineTransactions.empty') }}
  </p>

  <div v-else class="grid gap-3 text-sm">
    <div class="flex min-w-0 items-center justify-between gap-2">
      <span class="bg-muted shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
        {{ $t('budgetPlans.panel.transactionCount', { count: data.total }) }}
      </span>
      <span :class="cn('font-semibold tabular-nums', amountToneClass({ amount: line.activity }))">
        {{ formatBaseCurrency(line.activity) }}
      </span>
    </div>

    <TransactionsList :transactions="data.transactions" :paginate="false" raw-list disable-grouping compact />

    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span v-if="remaining > 0" class="text-muted-foreground">
        {{ $t('budgetPlans.panel.lineTransactions.more', { count: remaining }) }}
      </span>
      <Button variant="link" size="sm" class="ml-auto px-0" as-child>
        <RouterLink :to="seeAllLink">
          {{ $t('budgetPlans.panel.lineTransactions.seeAll') }}
          <ArrowRightIcon class="size-4" />
        </RouterLink>
      </Button>
    </div>
  </div>
</template>
